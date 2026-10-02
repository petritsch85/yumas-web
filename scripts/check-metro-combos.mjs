/**
 * Which unexplained METRO payments are combinations of unlinked METRO bills.
 *
 * METRO collects several invoices at once and nets off its credit notes in the
 * same debit, so a payment rarely equals any single bill. Credit notes are
 * carried as negative amounts and allowed into a combination for that reason.
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
  .select('id, supplier_name, invoice_number, invoice_date, gross_amount, payment_method').order('id').range(p * 500, p * 500 + 499)))
  .filter(b => /metro/i.test(b.supplier_name ?? ''));
const tx = (await page(p => db.from('cashflow_transactions')
  .select('id, date, direction, counterparty, amount_cents, description, bill_id').order('id').range(p * 500, p * 500 + 499)))
  .filter(t => /metro/i.test(`${t.counterparty ?? ''} ${t.description ?? ''}`));
const links = await page(p => db.from('transaction_bill_links').select('transaction_id, bill_id').order('transaction_id').range(p * 500, p * 500 + 499));

const linkedBills = new Set([...links.map(l => l.bill_id), ...tx.filter(t => t.bill_id).map(t => t.bill_id)]);
const linkedTx = new Set([...links.map(l => l.transaction_id), ...tx.filter(t => t.bill_id).map(t => t.id)]);

/* Till purchases are settled on the spot and never reach this account. */
const TILL = /\bbar\b|girocard|visa|mastercard|amex|karte/i;
const open = bills.filter(b => !linkedBills.has(b.id) && !TILL.test(b.payment_method ?? ''));
const loose = tx.filter(t => !linkedTx.has(t.id));

console.log(`unlinked bills (excluding till purchases): ${open.length}`);
console.log(`unexplained METRO payments: ${loose.length}\n`);

for (const t of loose.sort((a, b) => a.date < b.date ? -1 : 1)) {
  const target = Math.round((t.direction === 'in' ? 1 : -1) * Math.abs(t.amount_cents));
  const want = Math.abs(target);
  /* Bills that could plausibly sit in this payment: invoiced before it, and
     not so long before that a different debit would already have taken them. */
  const pool = open.filter(b => b.invoice_date <= t.date
    && (new Date(t.date) - new Date(b.invoice_date)) / 86400000 <= 45)
    .map(b => ({ b, c: Math.round(Number(b.gross_amount) * 100) }));

  let found = null;
  const walk = (i, picked, sum) => {
    if (found) return;
    if (Math.abs(sum - want) < 1 && picked.length) { found = [...picked]; return; }
    if (i >= pool.length || picked.length >= 5) return;
    walk(i + 1, [...picked, pool[i]], sum + pool[i].c);
    walk(i + 1, picked, sum);
  };
  walk(0, [], 0);

  console.log(`${d(t.date)} ${eur(target / 100).padStart(11)} €  ${(t.description ?? '').slice(0, 48)}`);
  if (!found) { console.log('      no combination of unlinked bills explains it'); continue; }
  for (const x of found)
    console.log(`      ${d(x.b.invoice_date)} ${eur(x.c / 100).padStart(10)} €  ${x.b.invoice_number}`);
}
