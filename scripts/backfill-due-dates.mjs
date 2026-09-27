/**
 * Gives every bill a due date.
 *
 * 42% of bills carried none, so they showed no deadline and dropped out of
 * every payment run. Almost all of them can be worked out — but a date worked
 * out is not a date the supplier printed, so each one records where it came
 * from in due_date_source and the Bills page shows the difference.
 *
 * The cascade, strongest evidence first:
 *
 *   printed        a date on the document itself
 *   stated-term    a condition on it: "14 Tage netto", "Zahlbar sofort" (+7)
 *   settlement     the Skonto line names the day the debit falls
 *   prepaid        Vorkasse: the invoice date
 *   settled        already collected when issued: the invoice date
 *   supplier-term  the term this supplier prints on its OTHER invoices
 *   bank-history   this supplier prints nothing anywhere, but collects on a
 *                  regular rhythm — FFD's 141 debits all land at +13/+14 days
 *   default        nothing known at all: invoice date + 14
 *
 * Observed payment lag is used only for `bank-history`, and only where the
 * supplier states no term anywhere. It measures when a bill WAS paid, not when
 * it was owed: Werz settles at +32 days in the bank but prints "innerhalb von
 * 14 Tagen netto", and 14 is the real deadline.
 *
 *   node scripts/backfill-due-dates.mjs --dry     # report, change nothing
 *   node scripts/backfill-due-dates.mjs           # write
 *   node scripts/backfill-due-dates.mjs --dry ffd # one supplier
 *
 * Run supabase/add_bill_due_date_source.sql first.
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

/* Kept in step with lib/payment-terms.ts by hand: this runs outside the
   Next.js build and cannot import the TypeScript module. */
const SOFORT_DAYS = 7, DEFAULT_DAYS = 14;
const D = String.raw`(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})`;
const PRINTED_DUE = [
  new RegExp(String.raw`f[äa]llig(?:keit)?(?:s(?:datum|tag))?\s*(?:am|:|ist)?\s*${D}`, 'i'),
  new RegExp(String.raw`zahlbar\s*(?:bis|bis\s*zum|am)\s*${D}`, 'i'),
  new RegExp(String.raw`zahlungsziel\s*:?\s*${D}`, 'i'),
  new RegExp(String.raw`zahlung\s*bis\s*(?:zum\s*)?${D}`, 'i'),
  new RegExp(String.raw`valuta\s*:?\s*${D}`, 'i'),
  new RegExp(String.raw`(?:due\s*date|payment\s*due|due\s*on|pay\s*by)\s*:?\s*${D}`, 'i'),
];
const IMMEDIATE = /\bsofort\b|netto\s*kasse|ohne\s*abzug|immediate|upon\s*receipt|due\s*on\s*receipt|payable\s*(?:immediately|on\s*receipt)/i;
const PREPAID = /vorkasse|vorauskasse|payment\s*in\s*advance|prepaid/i;
const SETTLED = /(?:betrag\s*)?dankend\s*erhalten|bereits\s*(?:bezahlt|beglichen)|bezahlt\s*(?:per|mit)|paid\s*(?:in\s*full|via|by)|zahlung\s*erfolgt|wurde\s*abgebucht/i;

function netDays(text) {
  if (!text) return null;
  const m = text.match(/(?:innerhalb\s*(?:von\s*)?)?(\d{1,3})\s*(?:kalender)?tage?n?\b|\bnetto\s*(\d{1,3})\b|\bnet\s*(\d{1,3})\b/i);
  const n = m ? Number(m[1] ?? m[2] ?? m[3]) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 180 ? n : null;
}
function readPaymentTerms(text) {
  const flat = (text ?? '').replace(/\s+/g, ' ');
  if (!flat) return null;
  for (const re of PRINTED_DUE) {
    const m = flat.match(re);
    if (!m) continue;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return { source: 'printed', days: null, date: `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` };
  }
  const d = netDays(flat);
  if (d != null) return { source: 'stated-term', days: d };
  if (IMMEDIATE.test(flat)) return { source: 'stated-term', days: SOFORT_DAYS };
  if (PREPAID.test(flat)) return { source: 'prepaid', days: 0 };
  if (SETTLED.test(flat)) return { source: 'settled', days: 0 };
  return null;
}
const addDays = (iso, days) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const median = xs => xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null;

/* A run of 450 bills is a few thousand network calls; one flaky DNS lookup
   should not end it. */
async function retry(what, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await what(); } catch (e) {
      last = e;
      await new Promise(r => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args.find(a => !a.startsWith('--'));

const pageAll = async build => { const o = []; for (let p = 0; ; p++) { const { data, error } = await build(p); if (error) throw error; o.push(...data); if (data.length < 500) return o; } };

const bills = await pageAll(p => db.from('bills')
  .select('id, supplier_name, invoice_number, invoice_date, due_date, payment_method, settlement_date, file_path')
  /* Ordered by id, not invoice_date: paging with range() over a column that
     repeats gives no stable order, so rows sharing a date can be handed out
     twice or skipped entirely — which is how two bills survived the first run
     still without a due date. */
  .order('id').range(p * 500, p * 500 + 499));
const allTx = await pageAll(p => db.from('cashflow_transactions').select('id, date, bill_id').range(p * 500, p * 500 + 499));
const links = await pageAll(p => db.from('transaction_bill_links').select('transaction_id, bill_id').range(p * 500, p * 500 + 499));
const txDate = new Map(allTx.map(t => [t.id, t.date]));
const paidOn = new Map();
for (const t of allTx) if (t.bill_id) paidOn.set(t.bill_id, t.date);
for (const l of links) if (txDate.has(l.transaction_id)) paidOn.set(l.bill_id, txDate.get(l.transaction_id));

/* What each supplier's OTHER invoices say, and how it actually collects. */
const profile = new Map();
for (const b of bills) {
  const k = b.supplier_name ?? '—';
  const p = profile.get(k) ?? { statedLags: [], bankLags: [] };
  if (b.due_date && b.invoice_date) {
    const n = Math.round((new Date(b.due_date) - new Date(b.invoice_date)) / 86400000);
    if (n >= 0 && n <= 180) p.statedLags.push(n);
  }
  if (b.invoice_date && paidOn.has(b.id)) {
    const n = Math.round((new Date(paidOn.get(b.id)) - new Date(b.invoice_date)) / 86400000);
    if (n >= -5 && n <= 120) p.bankLags.push(n);
  }
  profile.set(k, p);
}

let todo = bills.filter(b => !b.due_date && b.invoice_date);
if (only) todo = todo.filter(b => (b.supplier_name ?? '').toLowerCase().includes(only.toLowerCase()));
console.log(`${todo.length} bill(s) without a due date${dry ? ' (dry run)' : ''}\n`);

const tally = {};
const failures = [];
let done = 0;

for (const b of todo) {
  const sup = b.supplier_name ?? '—';
  const p = profile.get(sup) ?? { statedLags: [], bankLags: [] };
  let source = null, due = null;

  // 1–5: whatever the document itself says.
  if (b.file_path) {
    try {
      const { data: f, error } = await retry(() => db.storage.from('bills').download(b.file_path));
      if (error) throw new Error(error.message);
      const pdf = await getDocumentProxy(new Uint8Array(await f.arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: true });
      const t = readPaymentTerms(text);
      if (t) { source = t.source; due = t.date ?? addDays(b.invoice_date, t.days); }
    } catch (e) { failures.push(`${sup} ${b.invoice_number}: ${e.message}`); }
  }

  // The Skonto line already told us the exact day the debit falls.
  if (!due && b.settlement_date) { source = 'settlement'; due = b.settlement_date; }

  // 6: the term this supplier prints on its other invoices.
  if (!due && p.statedLags.length >= 3) { source = 'supplier-term'; due = addDays(b.invoice_date, median(p.statedLags)); }

  // 7: it states nothing anywhere, but its debits are regular.
  if (!due && p.statedLags.length === 0 && p.bankLags.length >= 5) {
    const lags = [...p.bankLags].sort((a, x) => a - x);
    const spread = lags[Math.floor(lags.length * 0.9)] - lags[Math.floor(lags.length * 0.1)];
    if (spread <= 10) { source = 'bank-history'; due = addDays(b.invoice_date, Math.max(0, median(lags))); }
  }

  // 8: nothing known.
  if (!due) { source = 'default'; due = addDays(b.invoice_date, DEFAULT_DAYS); }

  tally[source] = (tally[source] ?? 0) + 1;
  if (!dry) {
    const { error } = await retry(() => db.from('bills').update({ due_date: due, due_date_source: source }).eq('id', b.id));
    if (error) failures.push(`${sup} ${b.invoice_number}: write failed ${error.message}`);
  }
  if (++done % 50 === 0) console.log(`  … ${done}/${todo.length}`);
}

console.log('\nRESULT');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1]))
  console.log('  ', k.padEnd(14), String(v).padStart(4));
console.log('  ', 'TOTAL'.padEnd(14), String(done).padStart(4));
if (failures.length) {
  console.log(`\n${failures.length} problem(s):`);
  for (const f of failures.slice(0, 20)) console.log('   ', f);
}
