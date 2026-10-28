/**
 * Read every Amex statement already filed and tie its payouts to the bank.
 *
 * Statements uploaded from now on are linked as they are filed; this catches
 * the ones filed before that existed. Safe to run again: a payout already
 * linked to its statement is counted and left alone.
 *
 *   npx tsx scripts/link-amex-statements.mts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { extractText, getDocumentProxy } from 'unpdf';
import { parseAmexStatement } from '../lib/amex-statement';
import { linkAmexStatement } from '../lib/amex-import';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: docs, error } = await db.from('month_documents').select('*').eq('kind', 'amex').order('month');
if (error) { console.error(error.message); process.exit(1); }

for (const d of docs ?? []) {
  const { data: f } = await db.storage.from(d.bucket || 'cashflow-files').download(d.file_path);
  if (!f) { console.log(`✘ ${d.filename}: Datei nicht gefunden`); continue; }
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await f.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    const st = parseAmexStatement(text);
    const r = await linkAmexStatement(db, d.id, st);
    console.log(`${d.month.slice(0, 7)} · Händler ${st.merchantNumber} · ${st.payouts.length} Auszahlungen ${st.payoutTotal.toFixed(2)} € · Gebühr netto ${st.feesNet.toFixed(2)} €`);
    console.log(`   verknüpft ${r.linked} · schon verknüpft ${r.already}${r.unmatched.length ? ` · offen: ${r.unmatched.join('; ')}` : ''}`);
  } catch (e) {
    console.log(`✘ ${d.filename}: ${(e as Error).message}`);
  }
}
