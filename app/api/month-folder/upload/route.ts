import { NextRequest, NextResponse } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { itemFor } from '@/lib/month-folder';
import { parsePaypalStatement } from '@/lib/paypal-statement';
import { importNexiPdf } from '@/lib/nexi-import';
import { parseAmexStatement, type AmexStatement } from '@/lib/amex-statement';
import { linkAmexStatement } from '@/lib/amex-import';
import { unzipSync } from 'fflate';
import { parseTgtgStatement } from '@/lib/tgtg-statement';
import { importTgtgMonth } from '@/lib/tgtg-import';

export const maxDuration = 60;

/**
 * Filing a monthly statement against its month.
 *
 * The write goes through the server for the same reason every other write to
 * cashflow-files does: the bucket and the table are closed to the browser
 * client, and an upload from the page was refused outright with "new row
 * violates row-level security policy". Loosening that to let one page write
 * directly would be the wrong way round — this is the pattern the rest of the
 * app already uses.
 */

const MONTH = /^\d{4}-\d{2}$/;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const kind = String(form?.get('kind') ?? '');
  const month = String(form?.get('month') ?? '');

  if (!(file instanceof File)) return NextResponse.json({ error: 'Keine Datei.' }, { status: 400 });
  if (!MONTH.test(month)) return NextResponse.json({ error: 'month muss 2026-09 sein.' }, { status: 400 });

  /* Only a kind the manifest declares: a typo would otherwise file a document
     under a position nothing ever looks at. */
  const item = itemFor(kind);
  if (!item) return NextResponse.json({ error: `Unbekannte Position "${kind}".` }, { status: 400 });
  if (item.source !== 'uploaded') {
    return NextResponse.json({ error: `${item.label} wird automatisch gesammelt.` }, { status: 400 });
  }

  /**
   * A zip is opened here, not filed as it is.
   *
   * The page unpacks zips in the browser, but fourteen of October's Wolt zips
   * arrived before it did and sat in the folder as zips — nothing in them could
   * be printed or read. So the server unpacks too, and each PDF inside is filed
   * on its own, exactly as if it had been dropped one by one.
   */
  if (/\.zip$/i.test(file.name)) {
    if (!item.multi) return NextResponse.json({ error: `${item.label} nimmt nur einzelne Dateien.` }, { status: 400 });
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const filed: string[] = [], failed: string[] = [];
    for (const [name, bytes] of Object.entries(entries)) {
      if (name.startsWith('__MACOSX/') || !/\.pdf$/i.test(name)) continue;
      const pdf = new File([bytes as BlobPart], name.split('/').pop() ?? name, { type: 'application/pdf' });
      const res = await fileDocument(pdf, kind, month, item);
      (res.ok ? filed : failed).push(pdf.name);
    }
    return NextResponse.json({ ok: failed.length === 0, unpacked: filed, failed });
  }

  const res = await fileDocument(file, kind, month, item);
  return NextResponse.json(res.body, { status: res.status });
}

async function fileDocument(
  file: File, kind: string, month: string, item: NonNullable<ReturnType<typeof itemFor>>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const admin = getSupabaseAdmin();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `monatsabschluss/${month}/${kind}_${Date.now()}_${safe}`;

  const { error: upErr } = await admin.storage.from('cashflow-files')
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type || 'application/octet-stream', upsert: true,
    });
  if (upErr) return { ok: false, status: 500, body: { error: `Upload: ${upErr.message}` } };

  /**
   * A position that holds one document replaces; one that holds many adds.
   *
   * A Kontoauszug uploaded twice should leave one copy in the folder. Wolt's
   * eighteen periods of four PDFs each should leave seventy-odd — so only the
   * single-document positions are cleared first, and the rest are kept unique
   * by filename so re-uploading the same file overwrites itself.
   */
  const superseded: string[] = [];
  if (!item.multi) {
    const { data: old } = await admin.from('month_documents')
      .select('file_path').eq('kind', kind).eq('month', `${month}-01`);
    for (const o of old ?? []) if (o.file_path !== path) superseded.push(o.file_path as string);
    await admin.from('month_documents').delete().eq('kind', kind).eq('month', `${month}-01`);
  } else {
    const { data: same } = await admin.from('month_documents')
      .select('file_path').eq('kind', kind).eq('month', `${month}-01`).eq('filename', file.name);
    for (const o of same ?? []) if (o.file_path !== path) superseded.push(o.file_path as string);
  }

  /**
   * Read the PayPal statement as it is filed.
   *
   * The loan repayment and the fees are deducted inside PayPal and never reach
   * the bank, so they exist only on this document. Reading them here means the
   * cash flow statement can show them without anything re-opening the PDF.
   *
   * A statement that does not balance is still filed — the Steuerberater wants
   * the document regardless — but its figures are not kept, because a figure
   * that cannot prove itself is worse than none.
   */
  const extra: Record<string, number | null> = {};

  /**
   * A Nexi statement filed here is also read here.
   *
   * It used to be filed and nothing more: the parser lived behind the upload
   * on the counterparty card, so the same PDF did two different things
   * depending on which page you dropped it on. September's statement was on
   * file, position 05 showed "vollständig", and its 1.4xx € of fees were
   * missing from the P&L — because nobody had also dropped it somewhere else.
   *
   * Filing a document and reading it should not be two jobs.
   */
  if (kind === 'nexi') {
    try {
      const res = await importNexiPdf(new Uint8Array(await file.arrayBuffer()), file.name);
      if (res.error) console.warn(`[month-folder] Nexi statement not read: ${res.error}`);
      else console.log(`[month-folder] Nexi ${res.data?.periodStart}–${res.data?.periodEnd} imported`);
    } catch (e) {
      /* The document still belongs in the folder even when the figures cannot
         be read from it. */
      console.warn('[month-folder] Nexi statement unreadable:', e);
    }
  }

  /* Too Good To Go: the bag sales on the statement are our revenue, and exist
     nowhere else — read them as the statement is filed. */
  if (kind === 'toogoodtogo') {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: true });
      const st = parseTgtgStatement(String(text));
      if (st.month && st.lines.length) {
        const r = await importTgtgMonth(admin, st.month, st.lines, file.name);
        console.log(`[month-folder] TGTG ${st.month}: ${st.lines.length} lines, ${r.gross.toFixed(2)} € gross, ${r.rows} day rows`);
      } else {
        console.warn('[month-folder] TGTG statement: no bag sales found');
      }
    } catch (e) {
      console.warn('[month-folder] TGTG statement not read:', e instanceof Error ? e.message : e);
    }
  }

  if (kind === 'paypal') {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: true });
      const s = parsePaypalStatement(text);
      if (s.balanced) {
        extra.working_capital = Math.abs(s.workingCapital);
        extra.fees = Math.abs(s.fees);
        extra.opening_balance = s.openingBalance;
        extra.closing_balance = s.closingBalance;
      } else {
        console.warn('[month-folder] PayPal statement does not balance; figures not kept');
      }
    } catch (e) {
      console.warn('[month-folder] PayPal statement unreadable:', e);
    }
  }

  /* An Amex statement is read as it is filed: its payouts are what the bank's
     Amex credits are evidence of, and its fee belongs in the P&L. Read before
     the row is written; linked after, because the links point at the row. */
  let amex: AmexStatement | null = null;
  if (kind === 'amex') {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: true });
      amex = parseAmexStatement(text);
    } catch (e) {
      console.warn('[month-folder] Amex statement not read:', e instanceof Error ? e.message : e);
    }
  }

  const row: Record<string, unknown> = {
    kind, month: `${month}-01`, filename: file.name, file_path: path,
    bucket: 'cashflow-files', byte_size: file.size, ...extra,
  };
  let { error } = await admin.from('month_documents').upsert(row, { onConflict: 'kind,month,filename' });
  if (error && /working_capital|fees|opening_balance|closing_balance/.test(error.message)) {
    /* Columns arrive with supabase/add_paypal_figures.sql. */
    const { working_capital: _w, fees: _f, opening_balance: _o, closing_balance: _c, ...basic } = row;
    void _w; void _f; void _o; void _c;
    ({ error } = await admin.from('month_documents').upsert(basic, { onConflict: 'kind,month,filename' }));
  }
  if (error) return { ok: false, status: 500, body: { error: error.message } };

  let amexResult: Awaited<ReturnType<typeof linkAmexStatement>> | null = null;
  if (amex) {
    const { data: saved } = await admin.from('month_documents').select('id')
      .eq('kind', kind).eq('month', `${month}-01`).eq('filename', file.name).maybeSingle();
    if (saved?.id) amexResult = await linkAmexStatement(admin, saved.id as string, amex);
  }

  if (superseded.length) {
    await admin.storage.from('cashflow-files').remove(superseded).catch(() => {});
  }
  return { ok: true, status: 200, body: { ok: true, filename: file.name, amex: amexResult } };
}

export async function DELETE(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind') ?? '';
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!MONTH.test(month) || !itemFor(kind)) {
    return NextResponse.json({ error: 'kind und month erforderlich.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();
  /* Every file the position holds. maybeSingle() assumed one, and on a Wolt
     position with sixty-odd it errored, came back empty, and the rows were
     deleted while the PDFs stayed behind in storage with nothing pointing at
     them. */
  const { data: rows } = await admin.from('month_documents')
    .select('file_path,bucket').eq('kind', kind).eq('month', `${month}-01`);

  const { error } = await admin.from('month_documents')
    .delete().eq('kind', kind).eq('month', `${month}-01`);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byBucket = new Map<string, string[]>();
  for (const r of rows ?? []) {
    if (!r.file_path) continue;
    const b = (r.bucket as string) || 'cashflow-files';
    byBucket.set(b, [...(byBucket.get(b) ?? []), r.file_path as string]);
  }
  for (const [b, paths] of byBucket) {
    await admin.storage.from(b).remove(paths).catch(() => {});
  }
  return NextResponse.json({ ok: true, removed: rows?.length ?? 0 });
}
