/**
 * The two small METRO bills, hunted across the whole ledger.
 *
 * Both were settled at the till rather than by invoice — one in cash, one on
 * the girocard — so neither would appear under METRO's own counterparty. The
 * question is whether the money shows anywhere in the bank at all, and how
 * METRO's other till payments behaved, since those are the precedent.
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

const tx = await page(p => db.from('cashflow_transactions')
  .select('id, date, direction, counterparty, amount_cents, description')
  .order('id').range(p * 500, p * 500 + 499));
const bills = await page(p => db.from('bills')
  .select('id, supplier_name, invoice_number, invoice_date, gross_amount, payment_method')
  .order('id').range(p * 500, p * 500 + 499));
const links = await page(p => db.from('transaction_bill_links')
  .select('transaction_id, bill_id').order('transaction_id').range(p * 500, p * 500 + 499));
const linkedTx = new Set(links.map(l => l.transaction_id));

console.log(`ledger: ${tx.length} transactions\n`);

/* Does the exact amount exist anywhere, under any name? */
for (const cents of [2814, 17033]) {
  const hits = tx.filter(t => Math.abs(t.amount_cents) === cents);
  console.log(`${eur(cents / 100)} € anywhere in the bank: ${hits.length} hit(s)`);
  for (const t of hits)
    console.log(`   ${d(t.date)} ${t.direction} ${t.counterparty} — ${(t.description ?? '').slice(0, 70)}`);
}

/* How every other METRO till payment ended up — the precedent that decides it. */
console.log('\nMETRO bills settled at the till');
const till = bills.filter(b => /metro/i.test(b.supplier_name ?? '')
  && /bar|girocard|visa|mastercard|amex|karte/i.test(b.payment_method ?? ''));
const billLinked = new Set(links.map(l => l.bill_id));
for (const b of till.sort((a, z) => a.invoice_date < z.invoice_date ? -1 : 1)) {
  const state = billLinked.has(b.id) ? 'linked to a bank row' : 'no bank row';
  console.log(`  ${d(b.invoice_date)} ${eur(b.gross_amount).padStart(9)} € [${(b.payment_method ?? '').padEnd(14)}] ${state}`);
}

/* Card and cash spending leaves the account in its own way, if at all. */
console.log('\nSeptember bank rows that look like card/cash activity');
for (const t of tx.filter(t => t.date >= '2026-09-01' && t.date <= '2026-09-30'
  && /karte|girocard|bargeld|auszahlung|kartenzahlung|visa|master/i.test(`${t.counterparty ?? ''} ${t.description ?? ''}`)))
  console.log(`  ${d(t.date)} ${eur((t.direction === 'in' ? 1 : -1) * Math.abs(t.amount_cents) / 100).padStart(10)} € ${t.counterparty} — ${(t.description ?? '').slice(0, 60)}`);

/* Anything in September the ledger still cannot explain. */
console.log('\nUnlinked September outgoings under 400 € (where a small bill could hide)');
for (const t of tx.filter(t => t.date >= '2026-09-01' && t.date <= '2026-10-05'
  && t.direction !== 'in' && Math.abs(t.amount_cents) <= 40000 && !linkedTx.has(t.id)))
  console.log(`  ${d(t.date)} ${eur(-Math.abs(t.amount_cents) / 100).padStart(10)} € ${t.counterparty} — ${(t.description ?? '').slice(0, 60)}`);
