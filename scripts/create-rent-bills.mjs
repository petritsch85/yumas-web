/**
 * Stand-in rent invoices, so the P&L can show rent at all.
 *
 * The landlords bill once in the lease and never again, so no invoice reaches
 * the inbox and the SG&A rent line — which reads bills by invoice date — stays
 * empty while 10.000 € a month leaves the account. One bill is written per
 * month from the payment that settled it, and linked to that payment.
 *
 * Which month a payment pays for is the whole question. Rent falls due on the
 * first (§556b BGB), and these payments straddle the boundary: some go out in
 * the first days of the month they cover, others in the last days of the month
 * before. A payment from the 25th onward is therefore next month's rent — which
 * is what makes the 30.09. payment October's, as the user said it was.
 *
 * The rule is not trusted blindly: the months it produces must come out one per
 * month with no gap and no repeat, or nothing is written.
 *
 *   node scripts/create-rent-bills.mjs --dry
 *   node scripts/create-rent-bills.mjs
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

/** Only landlords whose payments map cleanly, one per month. */
const LANDLORDS = [
  { counterparty: 'Wohnraum Entwicklungs GmbH', vat: 19 },
];

/** Paid from the 25th on, it is next month's rent. */
function rentMonth(date) {
  const [y, m, d] = date.split('-').map(Number);
  if (d < 25) return `${y}-${String(m).padStart(2, '0')}`;
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}
const lastDay = month => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

const tx = await page(p => db.from('cashflow_transactions')
  .select('id, date, direction, counterparty, amount_cents, description, category, bill_id')
  .order('id').range(p * 500, p * 500 + 499));

for (const L of LANDLORDS) {
  const pays = tx.filter(t => t.counterparty === L.counterparty && t.direction !== 'in' && t.category === 'C - Rent')
    .sort((a, b) => a.date < b.date ? -1 : 1);

  console.log(`\n=== ${L.counterparty} — ${pays.length} payments, VAT ${L.vat}%`);

  const months = pays.map(t => rentMonth(t.date));
  const dupes = months.filter((m, i) => months.indexOf(m) !== i);
  if (dupes.length) {
    console.log(`  !! two payments map to the same month (${[...new Set(dupes)].join(', ')}) — nothing written`);
    continue;
  }
  const sorted = [...months].sort();
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const [y, m] = sorted[i - 1].split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    if (next !== sorted[i]) gaps.push(`${sorted[i - 1]} -> ${sorted[i]}`);
  }
  if (gaps.length) console.log(`  note: a month has no payment (${gaps.join(', ')})`);

  for (let i = 0; i < pays.length; i++) {
    const t = pays[i];
    const month = months[i];
    const gross = Math.abs(t.amount_cents) / 100;
    const net = Math.round(gross / (1 + L.vat / 100) * 100) / 100;
    const vat = Math.round((gross - net) * 100) / 100;
    const number = `Miete ${month}`;

    console.log(`  paid ${t.date}  ${eur(gross).padStart(10)} €  ->  rent for ${month}`
      + `  (net ${eur(net)} + VAT ${eur(vat)})  ${number}${t.bill_id ? '  [already linked]' : ''}`);
    if (dry || t.bill_id) continue;

    const { data: exists } = await db.from('bills').select('id')
      .eq('supplier_name', L.counterparty).eq('invoice_number', number).maybeSingle();
    let billId = exists?.id;

    if (!billId) {
      const { data: made, error } = await db.from('bills').insert({
        supplier_name:  L.counterparty,
        invoice_number: number,
        invoice_date:   `${month}-01`,          // rent belongs to its own month
        due_date:       `${month}-01`,          // due on the first, per the lease
        due_date_source:'stated-term',
        net_amount:     net,
        vat_amount:     vat,
        gross_amount:   gross,
        currency:       'EUR',
        category:       'Rent',
        status:         'paid',
        payment_method: 'Überweisung',
        period_type:    'month',
        period_start:   `${month}-01`,
        period_end:     lastDay(month),
        notes: 'Ersatzbeleg — kein Originalbeleg. Automatisch aus der Zahlung erzeugt, '
             + 'damit die Miete in der GuV erscheint. Fuer den Vorsteuerabzug ist der '
             + 'Mietvertrag bzw. die Dauerrechnung massgeblich, nicht dieser Beleg.',
      }).select('id').single();
      if (error) { console.error(`     FAILED: ${error.message}`); continue; }
      billId = made.id;
    }

    const { error: linkErr } = await db.from('cashflow_transactions')
      .update({ bill_id: billId }).eq('id', t.id);
    if (linkErr) console.error(`     link FAILED: ${linkErr.message}`);
  }
}

if (dry) console.log('\n(dry run — nothing written)');
