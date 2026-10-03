/**
 * The remaining three landlords: counterparties, monthly bills, and the links.
 *
 * Wohnraum's payments fell close enough to the first of the month that the date
 * alone said which month they paid for. These three do not: Patricia pays twice
 * in some months and not at all in others, and Strabag pays mid-month. So the
 * month is not read off the payment date here. The payments are taken in order,
 * oldest settling the oldest month, anchored on what the user stated — the last
 * payment is September's rent for Patricia and Strabag, and October's for Laura
 * Klein, who is one month further ahead.
 *
 * October is written for all three so the P&L carries the cost in the month it
 * belongs to, but left unlinked for Patricia and Strabag, who have not paid it.
 *
 *   node scripts/create-rent-bills-2.mjs --dry
 *   node scripts/create-rent-bills-2.mjs
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
const VAT = 19;

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
                '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const lastDay = month => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

const LANDLORDS = [
  {
    counterparty: 'Laura Klein',
    keywords: ['Laura Klein'],
    rent: 1666.00,
    /* The 29.09. payment is October's, so every month through October is paid. */
    through: '2026-10',
    /* Nothing is withheld here; payments and rent agree to the cent. */
    skip: [],
  },
  {
    counterparty: 'Patricia Wohninveste KVG',
    keywords: ['Patricia Wohninveste'],
    rent: 6665.78,
    through: '2026-09',          // October not paid yet
    /* The 5.000 € Abschlagszahlung is disputed and settles no month. */
    skip: [t => Math.abs(t.amount_cents) === 500000],
  },
  {
    counterparty: 'Strabag Real Estate GmbH',
    keywords: ['Strabag Real Estate'],
    rent: 16532.66,
    through: '2026-09',          // October due next week
    skip: [],
  },
];

const tx = await page(p => db.from('cashflow_transactions')
  .select('id, date, direction, counterparty, amount_cents, description, category, bill_id')
  .order('id').range(p * 500, p * 500 + 499));

for (const L of LANDLORDS) {
  console.log(`\n=== ${L.counterparty} — rent ${eur(L.rent)} € brutto, VAT ${VAT}%`);

  if (!dry) {
    const { data: have } = await db.from('counterparties').select('id').eq('name', L.counterparty).maybeSingle();
    if (!have) {
      const { error } = await db.from('counterparties').insert({
        name: L.counterparty, category: 'C - Rent', default_vat_rate: VAT, keywords: L.keywords,
        notes: 'Vermieter. Stellt keine monatliche Rechnung; die Belege im System sind Ersatzbelege '
             + 'aus den Zahlungen. Massgeblich fuer den Vorsteuerabzug ist der Mietvertrag.',
      });
      if (error) console.error(`  counterparty FAILED: ${error.message}`);
      else console.log('  counterparty created');
    } else console.log('  counterparty already exists');
  }

  /* Every month up to and including the last one that has been paid for. */
  const months = MONTHS.filter(m => m <= L.through);
  const pays = tx
    .filter(t => t.counterparty === L.counterparty && t.direction !== 'in' && t.category === 'C - Rent')
    .filter(t => !L.skip.some(fn => fn(t)))
    .sort((a, b) => a.date < b.date ? -1 : 1);

  /* The last payment settles the last paid month, so the run is anchored at the
     end and any surplus falls off the front — it predates the year we hold. */
  const spare = pays.slice(0, Math.max(0, pays.length - months.length));
  const used  = pays.slice(Math.max(0, pays.length - months.length));

  const net = Math.round(L.rent / (1 + VAT / 100) * 100) / 100;
  const vat = Math.round((L.rent - net) * 100) / 100;

  for (const [i, month] of MONTHS.filter(m => m <= '2026-10').entries()) {
    void i;
    const number = `Miete ${month}`;
    const pay = used[months.indexOf(month)];
    const short = pay ? Math.round((L.rent - Math.abs(pay.amount_cents) / 100) * 100) / 100 : 0;

    console.log(`  ${number}  net ${eur(net).padStart(9)}  brutto ${eur(L.rent).padStart(10)}`
      + (pay ? `  <- paid ${pay.date} ${eur(Math.abs(pay.amount_cents) / 100)}${short ? `  SHORT ${eur(short)} €` : ''}`
             : '  (not paid yet)'));
    if (dry) continue;

    const { data: exists } = await db.from('bills').select('id')
      .eq('supplier_name', L.counterparty).eq('invoice_number', number).maybeSingle();
    let billId = exists?.id;
    if (!billId) {
      const { data: made, error } = await db.from('bills').insert({
        supplier_name: L.counterparty, invoice_number: number,
        invoice_date: `${month}-01`, due_date: `${month}-01`, due_date_source: 'stated-term',
        net_amount: net, vat_amount: vat, gross_amount: L.rent, currency: 'EUR',
        category: 'Rent', status: pay ? 'paid' : 'to_be_paid',
        payment_method: 'Überweisung', period_type: 'month',
        period_start: `${month}-01`, period_end: lastDay(month),
        notes: 'Ersatzbeleg — kein Originalbeleg. Automatisch aus der Zahlung erzeugt, damit die '
             + 'Miete in der GuV erscheint. Fuer den Vorsteuerabzug ist der Mietvertrag massgeblich.',
      }).select('id').single();
      if (error) { console.error(`     FAILED: ${error.message}`); continue; }
      billId = made.id;
    }
    if (pay && !pay.bill_id) {
      const { error } = await db.from('cashflow_transactions').update({ bill_id: billId }).eq('id', pay.id);
      if (error) console.error(`     link FAILED: ${error.message}`);
    }
  }

  for (const t of spare)
    console.log(`  !! payment ${t.date} ${eur(Math.abs(t.amount_cents) / 100)} € left unlinked — more payments than months`);
  for (const t of tx.filter(t => t.counterparty === L.counterparty && L.skip.some(fn => fn(t))))
    console.log(`  -- payment ${t.date} ${eur(Math.abs(t.amount_cents) / 100)} € deliberately not linked (disputed)`);
}

if (dry) console.log('\n(dry run — nothing written)');
