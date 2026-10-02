/**
 * Everything METRO, laid out side by side.
 *
 * METRO is paid several ways at once — a card at the till, SEPA collections,
 * and the occasional transfer — so a bill that looks unpaid may simply have
 * been settled inside a collection covering a dozen others. This prints the
 * bills, the payments, and what each payment is already carrying, so an
 * unmatched bill can be judged against the money that actually left.
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
const d = s => s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : '—';

const bills = (await page(p => db.from('bills')
  .select('id, supplier_name, invoice_number, invoice_date, due_date, gross_amount, payment_method, status')
  .order('id').range(p * 500, p * 500 + 499)))
  .filter(b => /metro/i.test(b.supplier_name ?? ''));

const tx = (await page(p => db.from('cashflow_transactions')
  .select('id, date, direction, counterparty, amount_cents, description, bill_id')
  .order('id').range(p * 500, p * 500 + 499)))
  .filter(t => /metro/i.test(`${t.counterparty ?? ''} ${t.description ?? ''}`));

const links = await page(p => db.from('transaction_bill_links')
  .select('transaction_id, bill_id').order('transaction_id').range(p * 500, p * 500 + 499));

const billIds = new Set(bills.map(b => b.id));
const byBill = new Map();     // bill -> transactions
const byTx = new Map();       // transaction -> bills
for (const l of links) {
  if (!billIds.has(l.bill_id)) continue;
  byBill.set(l.bill_id, [...(byBill.get(l.bill_id) ?? []), l.transaction_id]);
  byTx.set(l.transaction_id, [...(byTx.get(l.transaction_id) ?? []), l.bill_id]);
}
for (const t of tx) if (t.bill_id && billIds.has(t.bill_id)) {
  if (!(byBill.get(t.bill_id) ?? []).includes(t.id)) {
    byBill.set(t.bill_id, [...(byBill.get(t.bill_id) ?? []), t.id]);
    byTx.set(t.id, [...(byTx.get(t.id) ?? []), t.bill_id]);
  }
}

const signed = t => (t.direction === 'in' ? 1 : -1) * Math.abs(t.amount_cents) / 100;
const gross = b => Number(b.gross_amount);
const total = bills.reduce((s, b) => s + gross(b), 0);
const open = bills.filter(b => !byBill.has(b.id));

console.log(`METRO — ${bills.length} bills, ${eur(total)} € · ${tx.length} payments, ${eur(tx.reduce((s, t) => s + Math.abs(signed(t)), 0))} €`);
console.log(`unlinked bills: ${open.length} (${eur(open.reduce((s, b) => s + gross(b), 0))} €)\n`);

console.log('PAYMENTS');
for (const t of [...tx].sort((a, b) => a.date < b.date ? -1 : 1)) {
  const carried = (byTx.get(t.id) ?? []).map(id => bills.find(b => b.id === id)).filter(Boolean);
  const sum = carried.reduce((s, b) => s + gross(b), 0);
  const gap = Math.abs(signed(t)) - sum;
  console.log(`  ${d(t.date)}  ${eur(signed(t)).padStart(11)} €  ${String(carried.length).padStart(2)} bill(s) = ${eur(sum).padStart(10)} €  ${Math.abs(gap) < 0.005 ? 'exact' : `gap ${eur(gap)} €`}`);
}

console.log('\nUNLINKED BILLS');
for (const b of open.sort((a, z) => a.invoice_date < z.invoice_date ? -1 : 1))
  console.log(`  ${d(b.invoice_date)}  ${eur(gross(b)).padStart(10)} €  ${b.invoice_number}  [${b.payment_method ?? '—'}] ${b.status ?? ''}`);

/* Could an unlinked bill be hiding inside a payment that is already short? */
console.log('\nWHERE THE UNLINKED ONES COULD SIT');
const slack = tx.map(t => {
  const carried = (byTx.get(t.id) ?? []).map(id => bills.find(b => b.id === id)).filter(Boolean);
  return { t, gap: Math.round((Math.abs(signed(t)) - carried.reduce((s, b) => s + gross(b), 0)) * 100) / 100 };
}).filter(x => x.gap > 0.005);

for (const b of open) {
  const near = slack.filter(x => x.gap >= gross(b) - 0.005
    && new Date(x.t.date) >= new Date(b.invoice_date)
    && (new Date(x.t.date) - new Date(b.invoice_date)) / 86400000 <= 45);
  const exact = near.filter(x => Math.abs(x.gap - gross(b)) < 0.005);
  console.log(`  ${d(b.invoice_date)} ${eur(gross(b))} € ${b.invoice_number}`);
  if (!near.length) { console.log('      no later METRO payment has room for it'); continue; }
  for (const x of (exact.length ? exact : near).slice(0, 4))
    console.log(`      ${exact.length ? 'EXACTLY fills' : 'room in'} ${d(x.t.date)} ${eur(signed(x.t))} € (unexplained ${eur(x.gap)} €)`);
}
