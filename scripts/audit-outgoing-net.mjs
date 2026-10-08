/**
 * Does every outgoing bill really carry its NET in net_total?
 *
 * The daily and monthly sales views both read net_total and label the row
 * "Net sales", so a bill whose net_total actually holds the gross overstates
 * the day, the month and every margin beneath it.
 *
 * A blended rate proves nothing — a catering bill is food at 7 % and drinks at
 * 19 %, so anything between the two is ordinary. What the table has to satisfy
 * is its own arithmetic:
 *
 *   net_food + net_drinks        = net_total
 *   net_total + vat_7 + vat_19   = gross_total
 *   gross_total + tips           = total_payable
 *
 * A bill where the VAT is zero and the gross equals the net LOOKS like one
 * where nothing was split out — but it is also exactly what a genuinely
 * zero-rated invoice looks like, and those exist here: Orion Engineered
 * Carbons is billed at 0 %. The two are indistinguishable from the figures
 * alone, so they are reported apart from the errors rather than as errors.
 */

/** Customers we invoice without VAT. Their net and gross are the same figure. */
const ZERO_RATED = [/orion engineered carbons/i];
const zeroRated = name => ZERO_RATED.some(re => re.test(String(name ?? '')));
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const page = async b => { const o = []; for (let p = 0; ; p++) { const { data, error } = await b(p); if (error) throw error; o.push(...data); if (data.length < 1000) return o; } };

const bills = await page(p => db.from('outgoing_bills')
  .select('id,invoice_number,invoice_date,event_date,customer_name,issuing_location,paid_in_store,'
        + 'net_food,net_drinks,net_total,vat_7,vat_19,gross_total,tips,total_payable')
  .order('event_date').range(p * 1000, p * 1000 + 999));

const n = v => Number(v ?? 0);
const eur = v => n(v).toFixed(2).padStart(9);
const near = (a, b) => Math.abs(n(a) - n(b)) < 0.015;

const problems = [];
const zero = [];
for (const b of bills) {
  const vat = n(b.vat_7) + n(b.vat_19);
  const flags = [];

  /* No VAT at all. Either nothing was split out — then net_total is a gross
     and the sales figures are too high — or the invoice really is zero-rated,
     which is right and needs no action. The figures cannot tell them apart. */
  if (vat < 0.005 && n(b.net_total) > 0 && near(b.net_total, b.gross_total)) {
    if (zeroRated(b.customer_name)) { zero.push(b); continue; }
    flags.push('KEINE USt ausgewiesen — net_total könnte der Bruttobetrag sein');
  }
  if (!near(n(b.net_food) + n(b.net_drinks), b.net_total) && (n(b.net_food) + n(b.net_drinks)) > 0) {
    flags.push(`net_food+net_drinks ${eur(n(b.net_food) + n(b.net_drinks)).trim()} ≠ net_total ${eur(b.net_total).trim()}`);
  }
  if (n(b.gross_total) > 0 && !near(n(b.net_total) + vat, b.gross_total)) {
    flags.push(`net+USt ${eur(n(b.net_total) + vat).trim()} ≠ gross_total ${eur(b.gross_total).trim()}`);
  }
  if (flags.length) problems.push({ b, vat, flags });
}

console.log(`${bills.length} Ausgangsrechnungen geprüft · ${problems.length} fehlerhaft\n`);
for (const p of problems) {
  console.log(`${p.b.event_date ?? p.b.invoice_date}  ${p.b.invoice_number ?? '—'} · ${String(p.b.customer_name ?? '—').slice(0, 36)} · ${p.b.issuing_location ?? '—'}`);
  console.log(`   netto ${eur(p.b.net_total)} (Speisen ${eur(p.b.net_food)} + Getränke ${eur(p.b.net_drinks)})`
    + `  USt ${eur(p.vat)}  brutto ${eur(p.b.gross_total)}  zahlbar ${eur(p.b.total_payable)}`
    + `${p.b.paid_in_store ? '  [im Haus bezahlt — nicht in den Umsatzansichten]' : ''}`);
  for (const f of p.flags) console.log(`   → ${f}`);
  console.log('');
}

if (zero.length) {
  console.log(`${zero.length} Rechnung(en) ohne USt, weil der Kunde mit 0 % fakturiert wird — netto = brutto, korrekt:`);
  for (const b of zero) {
    console.log(`   ${b.event_date ?? b.invoice_date}  ${b.invoice_number ?? '—'} · ${String(b.customer_name ?? '—').slice(0, 36)} · ${eur(b.net_total)} €`);
  }
  console.log('');
}

const inPl = bills.filter(b => b.paid_in_store === false
  && !(b.invoice_number ?? '').toUpperCase().startsWith('BB'));
const sum = f => inPl.reduce((t, b) => t + n(b[f]), 0);
console.log(`In den Umsatzansichten: ${inPl.length} Rechnungen`);
console.log(`  Summe net_total   ${eur(sum('net_total'))} €`);
console.log(`  Summe gross_total ${eur(sum('gross_total'))} €`);
const bad = problems.filter(p => p.flags[0]?.startsWith("KEINE USt")
  && p.b.paid_in_store === false && !(p.b.invoice_number ?? '').toUpperCase().startsWith('BB'));
console.log(`  davon ohne USt-Aufteilung: ${bad.length} · ${eur(bad.reduce((t, p) => t + n(p.b.net_total), 0))} € zu hoch ausgewiesen`);
