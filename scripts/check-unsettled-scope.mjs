/**
 * What "not settled from this bank account" actually covers.
 *
 * Read strictly it means every bill with no link to a cash flow — but that set
 * is mostly bills the matcher has not got to yet, and bills that are simply not
 * due. Only a few were genuinely settled elsewhere: cash at the till, or a card
 * drawn on another account. The difference between those readings is the whole
 * question, so both are counted here before anything is removed.
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

const page = async build => { const o = []; for (let p = 0; ; p++) { const { data, error } = await build(p); if (error) throw error; o.push(...data); if (data.length < 500) return o; } };
const eur = n => Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = bs => bs.reduce((s, b) => s + Number(b.gross_amount ?? 0), 0);

const bills = await page(p => db.from('bills')
  .select('id, supplier_name, invoice_number, invoice_date, due_date, gross_amount, payment_method, status')
  .order('id').range(p * 500, p * 500 + 499));
const tx = await page(p => db.from('cashflow_transactions')
  .select('id, bill_id').order('id').range(p * 500, p * 500 + 499));
const links = await page(p => db.from('transaction_bill_links')
  .select('transaction_id, bill_id').order('transaction_id').range(p * 500, p * 500 + 499));

const linked = new Set([...links.map(l => l.bill_id), ...tx.filter(t => t.bill_id).map(t => t.bill_id)]);
const open = bills.filter(b => !linked.has(b.id));

/* Paid on the spot, or on a card this account never sees. */
const TILL = /\bbar\b|bargeld|girocard|giro-?karte|visa|mastercard|amex|ec-?karte|kreditkarte|karte\b/i;
/* Collected from this account, so they belong here even when not yet matched. */
const FROM_ACCOUNT = /lastschrift|einzug|direct\s*debit|sepa|[üu]berweisung|paypal|dauerauftrag/i;

const today = '2026-10-02';
const till = open.filter(b => TILL.test(b.payment_method ?? '') && !FROM_ACCOUNT.test(b.payment_method ?? ''));
const rest = open.filter(b => !till.includes(b));
const notYetDue = rest.filter(b => (b.due_date ?? '9999') >= today);
const overdue = rest.filter(b => (b.due_date ?? '9999') < today);

console.log(`bills in the system      ${String(bills.length).padStart(5)}   ${eur(sum(bills)).padStart(13)} €`);
console.log(`  linked to a cash flow  ${String(bills.length - open.length).padStart(5)}   ${eur(sum(bills) - sum(open)).padStart(13)} €`);
console.log(`  NOT linked             ${String(open.length).padStart(5)}   ${eur(sum(open)).padStart(13)} €\n`);

console.log('The unlinked ones break down as:');
console.log(`  settled at the till / another card  ${String(till.length).padStart(4)}   ${eur(sum(till)).padStart(12)} €`);
console.log(`  not yet due                         ${String(notYetDue.length).padStart(4)}   ${eur(sum(notYetDue)).padStart(12)} €`);
console.log(`  past due, no payment found yet      ${String(overdue.length).padStart(4)}   ${eur(sum(overdue)).padStart(12)} €\n`);

console.log('Settled elsewhere — by method:');
const byMethod = {};
for (const b of till) (byMethod[(b.payment_method ?? '—')] ??= []).push(b);
for (const [m, v] of Object.entries(byMethod).sort((a, z) => sum(z[1]) - sum(a[1])))
  console.log(`  ${String(v.length).padStart(3)}x  ${m.slice(0, 30).padEnd(32)} ${eur(sum(v)).padStart(10)} €`);

console.log('\nSettled elsewhere — by supplier:');
const bySup = {};
for (const b of till) (bySup[(b.supplier_name ?? '—')] ??= []).push(b);
for (const [s, v] of Object.entries(bySup).sort((a, z) => sum(z[1]) - sum(a[1])).slice(0, 20))
  console.log(`  ${String(v.length).padStart(3)}x  ${s.slice(0, 38).padEnd(40)} ${eur(sum(v)).padStart(10)} €`);

/* The COGS line reads bills by issue date, so deleting any changes the P&L. */
console.log('\nEffect on COGS from September 2026 onward:');
for (const month of ['2026-09', '2026-10']) {
  const inMonth = bs => bs.filter(b => (b.invoice_date ?? '').startsWith(month));
  console.log(`  ${month}: all bills ${eur(sum(inMonth(bills))).padStart(11)} €`
    + ` · would lose ${eur(sum(inMonth(till))).padStart(9)} € (till)`
    + ` / ${eur(sum(inMonth(open))).padStart(10)} € (every unlinked bill)`);
}

console.log('\nPast due with no payment found — the largest, which a strict delete would also remove:');
for (const b of overdue.sort((a, z) => Number(z.gross_amount) - Number(a.gross_amount)).slice(0, 12))
  console.log(`  ${b.invoice_date} ${eur(b.gross_amount).padStart(10)} €  ${(b.supplier_name ?? '').slice(0, 38).padEnd(40)} [${b.payment_method ?? '—'}]`);
