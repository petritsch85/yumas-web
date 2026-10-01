/**
 * Moves "zahlbar sofort" bills onto a fortnight.
 *
 * A supplier asking to be paid at once is stating a preference, not a
 * deadline, and the house rule is now fourteen days from the invoice date
 * rather than seven. This restates the bills already on file.
 *
 * Only bills whose terms contain the word "sofort" are touched, and only where
 * the due date they carry is consistent with having been derived from it —
 * the invoice date itself, or a week after. A bill whose supplier printed a
 * real deadline is left exactly as it is: "14 Tage (bis 08.10.2026) ohne
 * Abzug" is a fortnight the supplier chose, not one we assumed.
 *
 *   node scripts/restate-sofort-due-dates.mjs --dry
 *   node scripts/restate-sofort-due-dates.mjs
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SOFORT_DAYS = 14;
/** The word itself. "ohne Abzug" is about discount, not timing. */
const SOFORT = /\bsofort/i;
/** Lags that can only have come from the old assumption. */
const DERIVED_LAGS = new Set([0, 7]);

const addDays = (iso, days) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const lagOf = b => (b.invoice_date && b.due_date)
  ? Math.round((new Date(b.due_date) - new Date(b.invoice_date)) / 86400000) : null;

const dry = process.argv.includes('--dry');
const pageAll = async build => { const o = []; for (let p = 0; ; p++) { const { data, error } = await build(p); if (error) throw error; o.push(...data); if (data.length < 500) return o; } };

const bills = await pageAll(p => db.from('bills')
  .select('id, supplier_name, invoice_number, invoice_date, due_date, due_date_source, payment_method')
  .order('id').range(p * 500, p * 500 + 499));

const touch = bills.filter(b =>
  SOFORT.test(b.payment_method ?? '') && b.invoice_date && DERIVED_LAGS.has(lagOf(b)));
const skipped = bills.filter(b =>
  SOFORT.test(b.payment_method ?? '') && !touch.includes(b));

console.log(`${bills.length} bills · ${touch.length} to restate${dry ? ' (dry run)' : ''}\n`);
const bySupplier = {};
for (const b of touch) {
  const k = (b.supplier_name ?? '—').slice(0, 30);
  (bySupplier[k] ??= []).push(b);
}
for (const [s, v] of Object.entries(bySupplier).sort((a, z) => z[1].length - a[1].length)) {
  const e = v[0];
  console.log(`  ${String(v.length).padStart(3)}x  ${s.padEnd(32)} e.g. ${e.invoice_date} ${e.due_date} -> ${addDays(e.invoice_date, SOFORT_DAYS)}`);
}
if (skipped.length) {
  console.log(`\n${skipped.length} bill(s) say sofort but carry a date we did not derive — left alone:`);
  for (const b of skipped.slice(0, 10))
    console.log(`   ${(b.supplier_name ?? '').slice(0, 28).padEnd(30)} ${b.invoice_date} -> ${b.due_date} (+${lagOf(b)}d)`);
}

if (dry) { console.log('\n(dry run — nothing written)'); process.exit(0); }

let done = 0;
for (const b of touch) {
  const { error } = await db.from('bills')
    .update({ due_date: addDays(b.invoice_date, SOFORT_DAYS), due_date_source: 'stated-term' })
    .eq('id', b.id);
  if (error) console.error(`  FAILED ${b.invoice_number}: ${error.message}`);
  else done++;
}
console.log(`\nrestated ${done} bill(s) to invoice date + ${SOFORT_DAYS} days`);
