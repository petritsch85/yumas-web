/**
 * Does every bill dated in the month actually reach a line of the P&L?
 *
 * The P&L reads bills by category, and a category no line claims is dropped in
 * silence — which is how 6.853 € of Labour sat in the books and in no row of
 * the report. Nothing warns about it, because from the report's side there is
 * nothing to warn about: the bill simply never arrives.
 *
 * So this works the other way round. Take every bill of the month, apply the
 * same rules the page applies, and name the ones that land nowhere.
 *
 *   node scripts/audit-pl-coverage.mjs 2026-09
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const page = async b => { const o = []; for (let p = 0; ; p++) { const { data, error } = await b(p); if (error) throw error; o.push(...data); if (data.length < 1000) return o; } };

const month = process.argv.find(a => /^\d{4}-\d{2}$/.test(a)) ?? '2026-09';

/* Copied from app/(app)/pl-reports/sales-reports/page.tsx. If a category is
   added there and not here this audit goes quiet about it, so they are listed
   plainly rather than imported — the point is to notice a divergence. */
const COGS = { 'Food Cost': 'Food Cost', 'Drinks Cost': 'Drinks Cost', 'Packaging': 'Packaging' };
const STAFF_CATEGORY = 'Labour';
const SGA = {
  'Rent': 'Rent',
  'Utilities': 'Utilities & energy', 'Fuel & Energy': 'Utilities & energy', 'Fuel Cost': 'Utilities & energy',
  'Software & Technology': 'Software & technology',
  'Delivery Platform Fees': 'Delivery platform fees',
  'Cleaning Services': 'Cleaning & hygiene',
  'Marketing': 'Marketing',
  'Repairs & Maintenance': 'Repairs & maintenance',
  'Other': 'Other operating costs',
};
const PAYMENT_PROVIDER = /\bnexi\b|\bpaypal\b|american\s+express|\bamex\b/i;

const [y, m] = month.split('-').map(Number);
const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;

const bills = await page(p => db.from('bills')
  .select('id,supplier_name,invoice_number,invoice_date,category,net_amount,gross_amount,status,notes')
  .gte('invoice_date', `${month}-01`).lte('invoice_date', to)
  .range(p * 1000, p * 1000 + 999));

const eur = v => Number(v ?? 0).toFixed(2).padStart(10);
const lineFor = b => {
  const c = String(b.category ?? '');
  /* The page skips a payment provider's own bill, because its cost is already
     counted from the provider's statement. Not lost — counted elsewhere. */
  if (PAYMENT_PROVIDER.test(String(b.supplier_name ?? ''))) return 'Payment provider fees (aus Abrechnung)';
  if (COGS[c]) return `COGS · ${COGS[c]}`;
  if (c === STAFF_CATEGORY) return 'Staff costs';
  if (SGA[c]) return `SG&A · ${SGA[c]}`;
  return null;
};

const shown = new Map();
const missing = [];
for (const b of bills) {
  const where = lineFor(b);
  if (!where) { missing.push(b); continue; }
  const cur = shown.get(where) ?? { n: 0, net: 0 };
  cur.n++; cur.net += Number(b.net_amount ?? 0);
  shown.set(where, cur);
}

console.log(`\nEINGANGSRECHNUNGEN MIT RECHNUNGSDATUM IN ${month}\n`);
console.log(`${bills.length} Rechnungen · ${bills.length - missing.length} in der GuV sichtbar · ${missing.length} nirgends\n`);

console.log('Wo sie landen:');
for (const [k, v] of [...shown.entries()].sort((a, z) => z[1].net - a[1].net)) {
  console.log(`  ${eur(v.net)} €  ${String(v.n).padStart(4)}x  ${k}`);
}
const shownNet = [...shown.values()].reduce((t, v) => t + v.net, 0);
console.log(`  ${eur(shownNet)} €  ${String(bills.length - missing.length).padStart(4)}x  SUMME`);

if (!missing.length) {
  console.log('\n✔ Keine Rechnung faellt aus der GuV heraus.');
} else {
  console.log(`\n✘ ${missing.length} Rechnung(en) erscheinen in KEINER Zeile — ${eur(missing.reduce((t, b) => t + Number(b.net_amount ?? 0), 0)).trim()} € netto:\n`);
  const byCat = new Map();
  for (const b of missing) {
    const k = b.category ?? '(keine Kategorie)';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(b);
  }
  for (const [cat, rows] of [...byCat.entries()].sort((a, z) => z[1].length - a[1].length)) {
    console.log(`  Kategorie "${cat}" — ${rows.length} Rechnung(en), ${eur(rows.reduce((t, b) => t + Number(b.net_amount ?? 0), 0)).trim()} €`);
    for (const b of rows) {
      console.log(`     ${b.invoice_date}  ${eur(b.net_amount)} €  ${String(b.supplier_name ?? '—').slice(0, 40).padEnd(40)} ${b.invoice_number ?? '—'}`);
    }
  }
}

/**
 * The second way a bill goes missing: a placeholder standing over it.
 *
 * An entered figure replaces what the bills say for that line and month rather
 * than adding to it — right when nothing was invoiced, wrong once something is.
 * The bill is then in the system, in a category the P&L knows, and still not in
 * the number anybody reads.
 */
const SGA_PLACEHOLDER = { 'utilities|2026-09': 5000 };
const PLACEHOLDER_CATEGORIES = {
  utilities: ['Utilities', 'Fuel & Energy', 'Fuel Cost'],
  rent: ['Rent'], software: ['Software & Technology'], marketing: ['Marketing'],
  cleaning: ['Cleaning Services'], repairs: ['Repairs & Maintenance'], other: ['Other'],
};
for (const [key, value] of Object.entries(SGA_PLACEHOLDER)) {
  const [line, mon] = key.split('|');
  if (mon !== month) continue;
  const cats = PLACEHOLDER_CATEGORIES[line] ?? [];
  const hidden = bills.filter(b => cats.includes(String(b.category ?? '')));
  if (!hidden.length) continue;
  const net = hidden.reduce((t, b) => t + Number(b.net_amount ?? 0), 0);
  console.log(`\n⚠  Platzhalter "${line}" = ${eur(value).trim()} € verdeckt ${hidden.length} echte Rechnung(en) über ${eur(net).trim()} €:`);
  for (const b of hidden) {
    console.log(`     ${b.invoice_date}  ${eur(b.net_amount)} €  ${String(b.supplier_name ?? '—').slice(0, 40)}`);
  }
  console.log(`   → Der Platzhalter ersetzt die Rechnungen, er kommt nicht dazu. Entfernen, sobald die Rechnungen vollstaendig sind.`);
}

/* A category the page does not know about is the failure mode here, so say
   which ones exist in the month and which of those no line claims. */
const unknown = [...new Set(bills.map(b => b.category ?? '(keine Kategorie)'))]
  .filter(c => !COGS[c] && c !== STAFF_CATEGORY && !SGA[c]);
if (unknown.length) console.log(`\nKategorien ohne Zeile in der GuV: ${unknown.join(', ')}`);
