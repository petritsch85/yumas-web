/**
 * Read every Too Good To Go statement on file and file its bag sales.
 *
 * TGTG's monthly invoice PDF carries the statement on its first page, so the
 * bills already hold the months before anyone filed one in Monatsabschluss.
 * Both are read; where a month has both, the Monatsabschluss copy wins.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/import-tgtg.mts           → shows
 *   npx tsx --tsconfig tsconfig.json scripts/import-tgtg.mts --apply   → writes
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const { getSupabaseAdmin } = await import('../lib/supabase-admin');
const { parseTgtgStatement } = await import('../lib/tgtg-statement');
const { importTgtgMonth } = await import('../lib/tgtg-import');
const { extractText, getDocumentProxy } = await import('unpdf');
const db = getSupabaseAdmin();
const apply = process.argv.includes('--apply');

const read = async (bucket: string, path: string) => {
  const { data: f } = await db.storage.from(bucket).download(path);
  if (!f) return null;
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(await f.arrayBuffer())), { mergePages: true });
  return parseTgtgStatement(String(text));
};

const found = new Map<string, { source: string; st: ReturnType<typeof parseTgtgStatement> }>();
const { data: bills } = await db.from('bills').select('invoice_number,file_path').ilike('supplier_name', '%too good%').not('file_path', 'is', null);
for (const b of bills ?? []) {
  const st = await read('bills', b.file_path as string);
  if (st?.month && st.lines.length) found.set(st.month, { source: `bill ${b.invoice_number}`, st });
}
const { data: docs } = await db.from('month_documents').select('filename,file_path,bucket').eq('kind', 'toogoodtogo');
for (const d of docs ?? []) {
  const st = await read((d.bucket as string) || 'cashflow-files', d.file_path as string);
  if (st?.month && st.lines.length) found.set(st.month, { source: d.filename as string, st });
}

for (const [month, { source, st }] of [...found.entries()].sort()) {
  const gross = st.lines.reduce((t, l) => t + l.gross, 0), net = st.lines.reduce((t, l) => t + l.net, 0);
  const bags = st.lines.reduce((t, l) => t + l.bags, 0);
  const per = Object.entries(st.lines.reduce<Record<string, number>>((m, l) => ({ ...m, [`${l.store} ${l.shift}`]: (m[`${l.store} ${l.shift}`] ?? 0) + l.net }), {}))
    .map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · ');
  console.log(`${month}  ${String(bags).padStart(4)} Tüten  brutto ${gross.toFixed(2).padStart(8)}  netto ${net.toFixed(2).padStart(8)}  (${source})  ${per}`);
  if (apply) {
    const r = await importTgtgMonth(db, month, st.lines, source);
    console.log(`          → ${r.rows} Tageszeilen${r.unknown.length ? ` · unbekannt: ${r.unknown.join(', ')}` : ''}`);
  }
}
if (!apply) console.log('\nProbelauf — mit --apply schreiben.');
