import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { fileBill, findDuplicate, isBillDocument } from '@/lib/inbound-bills';
import { extractFromAttachment } from '@/lib/bill-extract';

export const maxDuration = 60;

/**
 * A document the email import set aside as not a bill.
 *   { action: 'import' }  — file it as a bill after all (the reading was wrong)
 *   { action: 'dismiss' } — take it off the list; the file is kept
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action } = await req.json().catch(() => ({}));
  const admin = getSupabaseAdmin();

  const { data: doc, error } = await admin.from('inbound_skipped').select('*').eq('id', id).single();
  if (error || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (doc.status !== 'skipped') return NextResponse.json({ error: `Already ${doc.status}` }, { status: 409 });

  if (action === 'dismiss') {
    await admin.from('inbound_skipped').update({ status: 'dismissed' }).eq('id', id);
    return NextResponse.json({ ok: true });
  }

  if (action !== 'import') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  let extracted = (doc.extracted ?? {}) as Record<string, unknown>;

  /**
   * A document whose reading failed has nothing to file.
   *
   * On 20.10 the API credit ran out mid-morning and five bills — three FFD
   * invoices among them — were kept as "failed" with only the error. Importing
   * one of those as it stood made a bill with no supplier, no date and no
   * amount. So it is read again first, and filed only if it turns out to be
   * a bill.
   */
  if (doc.document_type === 'failed' || doc.document_type === 'unrecognised') {
    const { data: file, error: dlErr } = await admin.storage.from('bills').download(doc.file_path);
    if (dlErr || !file) return NextResponse.json({ error: `File not found: ${dlErr?.message ?? doc.file_path}` }, { status: 404 });
    const name = String(doc.file_name ?? 'document.pdf');
    try {
      extracted = await extractFromAttachment({
        Name: name,
        Content: Buffer.from(await file.arrayBuffer()).toString('base64'),
        ContentType: file.type || (/\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'application/pdf'),
      });
    } catch (e) {
      return NextResponse.json({ error: `Could not be read again: ${(e as Error).message}` }, { status: 502 });
    }
    if (!isBillDocument(extracted)) {
      /* Read properly this time, and not a bill: keep it listed under what it is. */
      await admin.from('inbound_skipped').update({
        document_type: String(extracted.document_type ?? 'other'),
        supplier_name: (extracted.supplier_name as string | null) ?? null,
        gross_amount: typeof extracted.gross_amount === 'number' ? extracted.gross_amount : null,
        extracted,
      }).eq('id', id);
      return NextResponse.json({ ok: true, message: `Read again: this is a ${extracted.document_type}, not a bill — kept under Not imported.` });
    }
  }

  const duplicate = await findDuplicate(extracted);
  if (duplicate) {
    return NextResponse.json({ error: 'This invoice is already on file — not imported again.' }, { status: 409 });
  }

  // Imported by hand, so it has been looked at: straight into Pending
  const billId = await fileBill(doc.file_path, extracted, { isNew: false });
  await admin.from('inbound_skipped').update({ status: 'imported', bill_id: billId }).eq('id', id);
  return NextResponse.json({
    ok: true,
    billId,
    message: billId ? null : 'Stored, but this counterparty pays us — no payable was created.',
  });
}
