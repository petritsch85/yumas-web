import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { buildBelegArchive } from '@/lib/datev-belege';
import type { BelegDocument } from '@/lib/datev-belege';

// The PDFs are pulled from storage, which needs the service role.
export const runtime = 'nodejs';
// A month of invoices takes a while to fetch one by one.
export const maxDuration = 60;

/**
 * Builds the Belegtransfer archive for a period.
 *
 * The PDFs live in storage under the service role, so the zip is assembled
 * here rather than in the browser: the alternative is a signed URL per
 * invoice and a hundred round trips from the client.
 *
 * Only invoices that have been reviewed go in. A pending one may still have
 * the wrong supplier or the wrong total on it, and a document sent to the
 * Steuerberater is hard to take back.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const from = p.get('from');
  const to   = p.get('to');
  if (!from || !to) {
    return NextResponse.json({ error: 'A period is required.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const [{ data: settings }, { data: bills, error }] = await Promise.all([
    admin.from('datev_settings').select('consultant_number, client_number, export_label').eq('id', 1).maybeSingle(),
    admin.from('bills')
      .select('id, supplier_name, invoice_number, invoice_date, gross_amount, net_amount, vat_amount, currency, file_path, status')
      .gte('invoice_date', from).lte('invoice_date', to)
      .neq('status', 'pending')
      .order('invoice_date'),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = bills ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No reviewed invoices in this period.' }, { status: 404 });
  }

  /* Fetch the images a handful at a time: one at a time is slow over a
     hundred invoices, and all at once exhausts the connection pool. */
  const documents: BelegDocument[] = [];
  const CHUNK = 8;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const pdfs = await Promise.all(slice.map(async b => {
      if (!b.file_path) return null;
      const { data } = await admin.storage.from('bills').download(b.file_path);
      if (!data) return null;
      return new Uint8Array(await data.arrayBuffer());
    }));
    slice.forEach((b, j) => documents.push({
      id: b.id,
      supplierName: b.supplier_name,
      invoiceNumber: b.invoice_number,
      invoiceDate: b.invoice_date,
      grossAmount: Number(b.gross_amount ?? 0),
      netAmount:   Number(b.net_amount ?? 0),
      vatAmount:   Number(b.vat_amount ?? 0),
      currency:    b.currency ?? 'EUR',
      pdf: pdfs[j],
      sourceName: b.file_path,
    }));
  }

  const archive = buildBelegArchive({
    consultantNumber: settings?.consultant_number ?? '',
    clientNumber:     settings?.client_number ?? '',
    clientName:       settings?.export_label ?? 'Yumas GmbH',
    from, to, documents,
  });

  await admin.from('datev_exports').insert({
    period_start: from, period_end: to, kind: 'documents',
    booking_count: archive.included,
    total_amount: documents.reduce((t, d) => t + Math.abs(d.grossAmount), 0),
    filename: archive.filename,
  });

  return new NextResponse(archive.bytes as BodyInit, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${archive.filename}"`,
      // So the page can say what was left out without opening the zip.
      'X-Beleg-Included': String(archive.included),
      'X-Beleg-Missing':  String(archive.missing.length),
    },
  });
}
