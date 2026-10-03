/**
 * The sub-tenant in the central kitchen, and her rent set against ours.
 *
 * Joana Pizarro sub-lets part of the Kelkheim kitchen, the premises Laura Klein
 * lets to us, and pays 257,00 € a month. That income belongs against the rent
 * it offsets, not in sales — so each month is written as a credit in the Rent
 * category, and the P&L rent line, which simply sums the net of its bills,
 * nets it off without needing to know anything new.
 *
 * She appears twice in the ledger and the two must not be confused. As a
 * sub-tenant she pays us; as "Nata Haus" she invoices us for pastries, and one
 * of those purchases had already been categorised as rent. Counterparty
 * keywords match on a plain substring, so "Joana Pizarro" would have caught
 * Nata Haus too — the tenancy is keyed on her full legal name instead.
 *
 * She pays late and catches up in pairs, so the date says nothing about which
 * month a payment settles. Each payment settles the oldest month still open.
 *
 *   node scripts/create-subrent-bills.mjs --dry
 *   node scripts/create-subrent-bills.mjs
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
const dry = process.argv.includes('--dry');

const TENANT = 'Joana Pizarro (Untermiete ZK)';
const RENT = 257.00, VAT = 19;
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
                '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const lastDay = m => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };

const tx = await page(p => db.from('cashflow_transactions')
  .select('id, date, direction, counterparty, amount_cents, description, category, category_manual, bill_id')
  .order('id').range(p * 500, p * 500 + 499));

/* Her rent arriving: money in, 257,00 €, under either spelling of her name. */
const rentIn = tx.filter(t => t.direction === 'in'
  && Math.abs(t.amount_cents) === Math.round(RENT * 100)
  && /pizarro/i.test(t.counterparty ?? ''))
  .sort((a, b) => a.date < b.date ? -1 : 1);

/* What she invoices us for is a different relationship entirely. */
const nataHaus = tx.filter(t => t.direction !== 'in' && /nata haus/i.test(t.counterparty ?? ''));

console.log(`sub-rent received: ${rentIn.length} payments of ${eur(RENT)} €`);
console.log(`Nata Haus purchases (not rent): ${nataHaus.length}`);
for (const t of nataHaus) console.log(`   ${t.date} ${eur(Math.abs(t.amount_cents) / 100).padStart(8)} € [${t.category}] "${(t.description ?? '').slice(0, 34)}"`);

if (!dry) {
  for (const [name, category, keywords, notes] of [
    [TENANT, 'C - Rent', ['JOANA LE DE ALMEIDA DA NOBREGA PIZARRO'],
      'Untermieterin in der Zentralkueche Kelkheim. Zahlt 257,00 EUR brutto monatlich. '
      + 'Die Einnahme wird in der GuV gegen die Miete an Laura Klein gerechnet. '
      + 'Nicht zu verwechseln mit "Joana Pizarro - Nata Haus", von der wir Ware beziehen.'],
    ['Joana Pizarro - Nata Haus', 'C - Suppliers', ['Nata Haus'],
      'Lieferantin (Pasteis de Nata). Nicht die Untermiete — dafuer siehe ' + TENANT + '.'],
  ]) {
    const { data: have } = await db.from('counterparties').select('id').eq('name', name).maybeSingle();
    if (have) { console.log(`counterparty "${name}" already exists`); continue; }
    const { error } = await db.from('counterparties').insert({
      name, category, keywords, notes,
      ...(category === 'C - Rent' ? { default_vat_rate: VAT } : {}),
    });
    console.log(error ? `counterparty "${name}" FAILED: ${error.message}` : `counterparty "${name}" created`);
  }

  /* Her rent was booked as sales; it belongs against rent. The Nata Haus
     purchase of 14.09. had been filed as rent and is a supply. */
  for (const t of rentIn.filter(t => t.category !== 'C - Rent')) {
    await db.from('cashflow_transactions')
      .update({ category: 'C - Rent', sales_type: 'Other', category_manual: true }).eq('id', t.id);
  }
  for (const t of nataHaus.filter(t => t.category !== 'C - Suppliers')) {
    await db.from('cashflow_transactions')
      .update({ category: 'C - Suppliers', category_manual: true }).eq('id', t.id);
  }
  console.log(`recategorised ${rentIn.filter(t => t.category !== 'C - Rent').length} rent receipts`
    + ` and ${nataHaus.filter(t => t.category !== 'C - Suppliers').length} Nata Haus purchases`);
}

/* A credit, so the rent line nets it off by simply summing what it holds. */
const net = -(Math.round(RENT / (1 + VAT / 100) * 100) / 100);
const vat = Math.round((-RENT - net) * 100) / 100;

console.log(`\nmonthly credit: net ${eur(net)} + VAT ${eur(vat)} = ${eur(-RENT)}\n`);

for (const [i, month] of MONTHS.entries()) {
  const pay = rentIn[i];                       // oldest payment settles oldest month
  const number = `Untermiete ${month}`;
  console.log(`  ${number}  ${eur(net).padStart(9)} net` + (pay ? `  <- received ${pay.date}` : '  (not received yet)'));
  if (dry) continue;

  const { data: exists } = await db.from('bills').select('id')
    .eq('supplier_name', TENANT).eq('invoice_number', number).maybeSingle();
  let billId = exists?.id;
  if (!billId) {
    const { data: made, error } = await db.from('bills').insert({
      supplier_name: TENANT, invoice_number: number,
      invoice_date: `${month}-01`, due_date: `${month}-01`, due_date_source: 'stated-term',
      net_amount: net, vat_amount: vat, gross_amount: -RENT, currency: 'EUR',
      category: 'Rent',
      /* Never 'to_be_paid': a credit must not join the payment run. */
      status: pay ? 'paid' : 'pending',
      payment_method: 'Überweisung', period_type: 'month',
      period_start: `${month}-01`, period_end: lastDay(month),
      notes: 'Untermiete Zentralkueche — Einnahme, als Gutschrift gegen die Mietaufwendungen '
           + 'gebucht. Ersatzbeleg aus der Zahlung; massgeblich ist der Untermietvertrag.',
    }).select('id').single();
    if (error) { console.error(`     FAILED: ${error.message}`); continue; }
    billId = made.id;
  }
  if (pay && !pay.bill_id) {
    const { error } = await db.from('cashflow_transactions').update({ bill_id: billId }).eq('id', pay.id);
    if (error) console.error(`     link FAILED: ${error.message}`);
  }
}

if (dry) console.log('\n(dry run — nothing written)');
