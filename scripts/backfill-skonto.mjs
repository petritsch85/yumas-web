/**
 * Reads the Skonto settlement line out of bills already on file.
 *
 * Bills ingested before settlement_amount existed kept only their gross, so
 * none of them could be found in the bank — a supplier taking Skonto never
 * debits the gross. This re-reads the stored PDFs and fills in what the
 * invoice printed.
 *
 *   node scripts/backfill-skonto.mjs             # every bill without a settlement
 *   node scripts/backfill-skonto.mjs leleithner  # only suppliers matching that
 *   node scripts/backfill-skonto.mjs --dry       # report, change nothing
 *
 * Run supabase/add_bill_settlement.sql first.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { extractText, getDocumentProxy } from 'unpdf';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/* Kept in step with lib/skonto.ts by hand — this script runs outside the
   Next.js build, so it cannot import the TypeScript module directly. */
const parseAmount = raw => {
  const s = String(raw).trim();
  return s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/\.(?=\d{3}\b)/g, ''));
};
const SKONTO = /abz(?:ü|ue|u)glich\s+([\d.,]+)\s*%\s*(?:\/|von|:)?\s*([\d.,]+)\s*(?:EUR|€)?\s*Skonto\s*=\s*([\d.,]+)\s*(?:EUR|€)/i;
const DEBIT_DATE = /\bam\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b[^.]{0,40}?(?:per\s+)?Lastschrift/i;

function parseSettlement(text, gross) {
  const m = text.match(SKONTO);
  if (!m) return null;
  const percent = parseAmount(m[1]), discount = parseAmount(m[2]), amount = parseAmount(m[3]);
  if (![percent, discount, amount].every(n => Number.isFinite(n) && n >= 0) || amount <= 0) return null;
  if (typeof gross === 'number' && gross > 0) {
    if (amount > gross + 0.01) return null;
    if (amount < gross * 0.85) return null;
    if (Math.abs(gross - discount - amount) > 0.02) return null;
  }
  const d = text.match(DEBIT_DATE);
  let date = null;
  if (d) {
    const year = d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
    date = `${year}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
  }
  return { amount, discount, percent, date };
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const supplier = args.find(a => !a.startsWith('--'));

/* Supabase caps a select at 1000 rows, so a book of a thousand-odd bills is
   silently cut short without paging through it. */
const PAGE = 500;
const bills = [];
for (let page = 0; ; page++) {
  let q = db.from('bills')
    .select('id, supplier_name, invoice_number, gross_amount, file_path, settlement_amount')
    .is('settlement_amount', null)
    .not('file_path', 'is', null)
    .order('invoice_date')
    .range(page * PAGE, (page + 1) * PAGE - 1);
  if (supplier) q = q.ilike('supplier_name', `%${supplier}%`);
  const { data, error } = await q;
  if (error) { console.error(error.message); process.exit(1); }
  bills.push(...data);
  if (data.length < PAGE) break;
}
console.log(`${bills.length} bill(s) to read${dry ? ' (dry run)' : ''}\n`);

let filled = 0, none = 0, failed = 0;
for (const b of bills) {
  const label = `${(b.supplier_name ?? '').slice(0, 24).padEnd(24)} ${String(b.invoice_number ?? '—').padEnd(11)}`;
  try {
    const { data: file, error: dlErr } = await db.storage.from('bills').download(b.file_path);
    if (dlErr) throw new Error(dlErr.message);
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    const s = parseSettlement(text, Number(b.gross_amount));
    if (!s) { none++; continue; }
    console.log(`${label} gross ${String(b.gross_amount).padStart(8)} -> collects ${s.amount.toFixed(2).padStart(8)} (${s.percent}% / ${s.discount.toFixed(2)})${s.date ? ' on ' + s.date : ''}`);
    if (!dry) {
      const { error: upErr } = await db.from('bills').update({
        settlement_amount: s.amount,
        settlement_date:   s.date,
        discount_amount:   s.discount,
        discount_percent:  s.percent,
      }).eq('id', b.id);
      if (upErr) throw new Error(upErr.message);
    }
    filled++;
  } catch (e) {
    failed++;
    console.log(`${label} FAILED: ${e.message}`);
  }
}
console.log(`\n${filled} filled · ${none} state no discount · ${failed} unreadable`);
