/**
 * Pluxee pays us; it does not invoice us.
 *
 * Guests settle with meal vouchers, Pluxee remits the face value less its
 * commission, and the document it sends is a remittance advice. Filed as a
 * supplier bill it becomes a payable that will never be paid, and the money
 * arriving is an unexplained credit. This checks how many such documents are
 * in the system, whether the matching inflows are there, and which other
 * voucher issuers are filed the same way.
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

const bills = await page(p => db.from('bills')
  .select('id, supplier_name, invoice_number, invoice_date, gross_amount, net_amount, payment_method, status, category')
  .order('id').range(p * 500, p * 500 + 499));
const tx = await page(p => db.from('cashflow_transactions')
  .select('id, date, direction, counterparty, amount_cents, description, bill_id')
  .order('id').range(p * 500, p * 500 + 499));
const links = await page(p => db.from('transaction_bill_links')
  .select('transaction_id, bill_id').order('transaction_id').range(p * 500, p * 500 + 499));
const linked = new Set([...links.map(l => l.bill_id), ...tx.filter(t => t.bill_id).map(t => t.bill_id)]);

/* The meal-voucher issuers operating in Germany. */
const ISSUERS = ['pluxee', 'sodexo', 'edenred', 'ticket restaurant', 'spendit', 'lunchit', 'hrmony', 'bonago', 'givve'];

for (const name of ISSUERS) {
  const bs = bills.filter(b => new RegExp(name, 'i').test(b.supplier_name ?? ''));
  const ts = tx.filter(t => new RegExp(name, 'i').test(`${t.counterparty ?? ''} ${t.description ?? ''}`));
  if (!bs.length && !ts.length) continue;

  const inc = ts.filter(t => t.direction === 'in');
  const out = ts.filter(t => t.direction !== 'in');
  console.log(`\n=== ${name.toUpperCase()}`);
  console.log(`  filed as bills: ${bs.length} (${eur(bs.reduce((s, b) => s + Number(b.gross_amount ?? 0), 0))} €)`
    + ` · unlinked: ${bs.filter(b => !linked.has(b.id)).length}`);
  console.log(`  money IN:  ${String(inc.length).padStart(3)}  ${eur(inc.reduce((s, t) => s + Math.abs(t.amount_cents) / 100, 0)).padStart(11)} €`);
  console.log(`  money OUT: ${String(out.length).padStart(3)}  ${eur(out.reduce((s, t) => s + Math.abs(t.amount_cents) / 100, 0)).padStart(11)} €`);

  for (const b of bs.sort((a, z) => a.invoice_date < z.invoice_date ? -1 : 1))
    console.log(`    BILL  ${d(b.invoice_date)} ${eur(b.gross_amount).padStart(10)} € net ${eur(b.net_amount ?? 0).padStart(10)} €`
      + ` [${b.category ?? '—'}] ${linked.has(b.id) ? 'linked' : 'UNLINKED'}  ${b.invoice_number}`);
  for (const t of ts.sort((a, z) => a.date < z.date ? -1 : 1))
    console.log(`    CASH  ${d(t.date)} ${eur((t.direction === 'in' ? 1 : -1) * Math.abs(t.amount_cents) / 100).padStart(10)} €`
      + ` ${t.bill_id ? 'linked' : '      '}  ${(t.description ?? '').slice(0, 60)}`);
}
