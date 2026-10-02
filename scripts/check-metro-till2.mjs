/**
 * Do METRO's till payments reach the bank account, or not?
 *
 * Nine METRO bills were settled at the till — cash, girocard, VISA, AMEX,
 * Mastercard. Whether the two September ones are still owed turns entirely on
 * what the other seven did, so each is checked for a bank row of the same
 * amount within a fortnight, under any counterparty.
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
  .select('id, date, direction, counterparty, amount_cents, description').order('id').range(p * 500, p * 500 + 499));
const bills = await page(p => db.from('bills')
  .select('id, supplier_name, invoice_number, invoice_date, gross_amount, payment_method').order('id').range(p * 500, p * 500 + 499));

const till = bills.filter(b => /metro/i.test(b.supplier_name ?? '')
  && /\bbar\b|girocard|visa|mastercard|amex|karte/i.test(b.payment_method ?? ''))
  .sort((a, z) => a.invoice_date < z.invoice_date ? -1 : 1);

for (const b of till) {
  const cents = Math.round(Number(b.gross_amount) * 100);
  const near = tx.filter(t => Math.abs(t.amount_cents) === cents && t.direction !== 'in'
    && t.date >= b.invoice_date
    && (new Date(t.date) - new Date(b.invoice_date)) / 86400000 <= 14);
  console.log(`${d(b.invoice_date)} ${eur(b.gross_amount).padStart(9)} € [${(b.payment_method ?? '').padEnd(14)}] -> ${near.length ? '' : 'NOTHING in the bank within 14 days'}`);
  for (const t of near) console.log(`      ${d(t.date)} ${t.counterparty} — ${(t.description ?? '').slice(0, 70)}`);
}

/* Card spending that does reach the account names the card on the booking. */
console.log('\nHow a card payment looks when it DOES hit this account:');
for (const t of tx.filter(t => /debitk\.|elv\d|kartenzahlung/i.test(t.description ?? '')).slice(0, 6))
  console.log(`  ${d(t.date)} ${eur(-Math.abs(t.amount_cents) / 100).padStart(9)} € ${(t.counterparty ?? '').slice(0, 40)} — ${(t.description ?? '').slice(0, 55)}`);

const metroCard = tx.filter(t => /metro/i.test(`${t.counterparty ?? ''} ${t.description ?? ''}`)
  && /debitk\.|elv\d|kartenzahlung/i.test(t.description ?? ''));
console.log(`\nMETRO card bookings in this account, ever: ${metroCard.length}`);
for (const t of metroCard) console.log(`  ${d(t.date)} ${eur(-Math.abs(t.amount_cents) / 100)} € — ${(t.description ?? '').slice(0, 70)}`);
