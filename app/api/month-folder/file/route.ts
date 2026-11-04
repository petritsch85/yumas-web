import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { hasOrderLists, withoutOrderLists } from '@/lib/folder-cuts';
import { woltSummaries } from '@/lib/wolt-summary';
import { lieferandoFolder } from '@/lib/lieferando-folder';

export const maxDuration = 120;

/**
 * One document of the month's print run, for "Check Out".
 *
 *   ?bucket=bills&path=bills/…         → { url }: a short-lived signed link, so
 *                                        the browser downloads straight from
 *                                        storage, whatever the file's size
 *   ?generated=wolt-summary&store=X&month=2026-09   → the summary page (PDF)
 *   ?generated=lieferando&month=2026-09             → summaries + page one of
 *                                                     each weekly statement (PDF)
 *
 * The buckets are closed to the browser, which is why it asks here.
 */
const BUCKETS = new Set(['bills', 'cashflow-files']);
const MONTH = /^\d{4}-\d{2}$/;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const admin = getSupabaseAdmin();
  const generated = q.get('generated');

  if (generated) {
    const month = q.get('month') ?? '';
    if (!MONTH.test(month)) return NextResponse.json({ error: 'month must look like 2026-09' }, { status: 400 });
    try {
      let bytes: Uint8Array | null = null;
      if (generated === 'wolt-summary') {
        const store = q.get('store') ?? '';
        bytes = (await woltSummaries(admin, month)).find(s => s.store === store)?.bytes ?? null;
      } else if (generated === 'lieferando') {
        const files = await lieferandoFolder(admin, month);
        const out = await PDFDocument.create();
        for (const f of files) {
          try {
            const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
            for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
          } catch { /* an unreadable one is listed by the browser as missing */ }
        }
        bytes = out.getPageCount() ? await out.save() : null;
      } else if (hasOrderLists(generated)) {
        const { data: doc } = await admin.from('month_documents')
          .select('file_path,bucket').eq('kind', generated).eq('month', `${month}-01`).ilike('filename', '%.pdf').limit(1).maybeSingle();
        if (doc) {
          const { data: file } = await admin.storage.from(doc.bucket || 'cashflow-files').download(doc.file_path);
          if (file) bytes = await withoutOrderLists(generated, new Uint8Array(await file.arrayBuffer()));
        }
      }
      if (!bytes) return NextResponse.json({ error: 'Nothing to build' }, { status: 404 });
      return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf' } });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
    }
  }

  const bucket = q.get('bucket') ?? '', path = q.get('path') ?? '';
  if (!BUCKETS.has(bucket) || !path || path.includes('..')) {
    return NextResponse.json({ error: 'bucket and path required' }, { status: 400 });
  }
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 600);
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'not found' }, { status: 404 });
  return NextResponse.json({ url: data.signedUrl });
}
