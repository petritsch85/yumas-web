/**
 * Total staff cost for a month, on the month the cost belongs to.
 *
 * Wages go out in two tranches — an Abschlag around the 25th of the month, the
 * balance once the Abrechnung is done the following month — so what leaves the
 * account in a month is never that month's wage bill. Nearly every narrative
 * names its own period ("Abschlag fuer 07/2026", "Lohn-/Gehaltzahlung 7/2026",
 * "LOHNST JUL.26", "BEITRAG 0726 - 0726"), and that is what makes the accrual
 * view possible rather than guesswork.
 *
 * Four funds are the exception. BARMER, DAK, BKK firmus and hkk have no SEPA
 * mandate, so they are paid by hand and their narrative carries only the
 * Betriebsnummer. Those are assigned by payment date and reported separately,
 * because that assignment is a judgement and should not hide inside a total.
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
const MONTHS = ['2026-06', '2026-07', '2026-08'];
const NAMED = { jan: 1, feb: 2, mrz: 3, mär: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12 };

const tx = await page(p => db.from('cashflow_transactions')
  .select('id, date, direction, counterparty, amount_cents, description, category')
  .order('id').range(p * 500, p * 500 + 499));
const out = tx.filter(t => t.direction !== 'in');
const amt = t => Math.abs(t.amount_cents) / 100;
const key = (m, y) => `${y}-${String(m).padStart(2, '0')}`;

/** The period a wage payment is for, read from the bank narrative. */
function wagePeriod(desc) {
  const s = desc ?? '';
  let m;
  if ((m = s.match(/Abschlag\s+f(?:ue|ü)r\s+(\d{1,2})\/(\d{4})/i))) return key(+m[1], m[2]);
  if ((m = s.match(/Lohn-?\s*\/?\s*Gehalt[sz]?ahlung\s+(\d{1,2})\/(\d{4})/i))) return key(+m[1], m[2]);
  if ((m = s.match(/Gehalt\s+Yumas\s+(\d{1,2})\/(\d{4})/i))) return key(+m[1], m[2]);
  if ((m = s.match(/Vorschuss\s+Gehalt\s+([A-Za-zä]+)\s+(\d{4})/i))) {
    const n = NAMED[m[1].slice(0, 3).toLowerCase()];
    return n ? key(n, m[2]) : null;
  }
  if ((m = s.match(/Vorschuss\s+(\d{1,2})\/(\d{2})\b/i))) return key(+m[1], `20${m[2]}`);
  /* One employee is settled separately: "Finale Zahlung Gehalt 03/2026". */
  if ((m = s.match(/Finale?\s+Zahlung\s+Gehalt\s+(\d{1,2})\/(\d{2,4})/i)))
    return key(+m[1], m[2].length === 2 ? `20${m[2]}` : m[2]);
  return null;
}

/** Whether a wage payment is the advance or the balancing run. */
const isAbschlag = d => /Abschlag|Vorschuss/i.test(d ?? '');

/* ---- wages ------------------------------------------------------------- */
const WAGE = /Lohn-?\s*\/?\s*Gehalt|Abschlag\s+f(?:ue|ü)r|Gehalt\s+Yumas|Vorschuss|Finale?\s+Zahlung\s+Gehalt/i;
/* The BG's annual advance is also a "Vorschuss", and a property company's
   Abschlagszahlung is rent that was filed under Personnel. Neither is a wage. */
const NOT_WAGE = /wohninvest|sparkasse|kfz|stadtkasse|gemeinschaftskasse|berufsgenossenschaft/i;
const wages = out.filter(t => WAGE.test(t.description ?? '')
  && !NOT_WAGE.test(t.counterparty ?? '')
  && t.category === 'C - Personnel');

/* ---- contributions ----------------------------------------------------- */
/** Funds whose narrative states the period they cover. */
const STATED = /aok|techniker krankenkasse|ikk |meine krankenkasse|knappschaft/i;
/** Paid by hand, period not stated — assigned by payment date. */
const MANUAL = /barmer|dak-|bkk |hkk /i;

function statedPeriod(desc) {
  const s = desc ?? '';
  let m;
  if ((m = s.match(/BEITRAG\s+(\d{2})(\d{2})\s*-/i))) return key(+m[1], `20${m[2]}`);
  if ((m = s.match(/Beitr(?:ae|ä)ge\s+(\d{1,2})\/(\d{2})\b/i))) return key(+m[1], `20${m[2]}`);
  if ((m = s.match(/Beitr(?:ae|ä)ge\s+\d{2}\.(\d{2})\.(\d{4})/i))) return key(+m[1], m[2]);
  return null;
}

/* ---- payroll tax ------------------------------------------------------- */
function lohnsteuerPeriod(desc) {
  const m = (desc ?? '').match(/LOHNST\s+([A-Z]{3})\.?\s*(\d{2})/i);
  if (!m) return null;
  const n = NAMED[m[1].toLowerCase()];
  return n ? key(n, `20${m[2]}`) : null;
}

/* ---- assemble ---------------------------------------------------------- */
const rows = {};
const take = (month, bucket, t) => {
  /* '?' is kept deliberately: a payment whose period cannot be read must be
     reported, not dropped, or the total silently understates. */
  if (month !== '?' && !MONTHS.includes(month)) return;
  ((rows[month] ??= {})[bucket] ??= []).push(t);
};

for (const t of wages) {
  const p = wagePeriod(t.description);
  if (p) take(p, isAbschlag(t.description) ? 'Abschlag (1st tranche)' : 'Abrechnung (2nd tranche)', t);
  else take('?', 'wage, period not stated', t);
}
for (const t of out.filter(t => STATED.test(t.counterparty ?? '') && !/berufsgenossenschaft/i.test(t.counterparty ?? ''))) {
  const p = statedPeriod(t.description);
  if (p) take(p, 'Krankenkassen (period stated)', t);
}
for (const t of out.filter(t => MANUAL.test(t.counterparty ?? '')))
  take(t.date.slice(0, 7), 'Krankenkassen (manual, by payment date)', t);
for (const t of out.filter(t => /^FA /i.test(t.counterparty ?? ''))) {
  const p = lohnsteuerPeriod(t.description);
  if (p) take(p, 'Lohnsteuer', t);
}
for (const t of out.filter(t => /vertical cloud|indeed/i.test(t.counterparty ?? '')))
  take(t.date.slice(0, 7), 'Payroll software & recruitment', t);
for (const t of out.filter(t => /berufsgenossenschaft/i.test(t.counterparty ?? '')))
  take(t.date.slice(0, 7), 'Berufsgenossenschaft (annual advance)', t);

const ORDER = ['Abschlag (1st tranche)', 'Abrechnung (2nd tranche)', 'Krankenkassen (period stated)',
  'Krankenkassen (manual, by payment date)', 'Lohnsteuer', 'Berufsgenossenschaft (annual advance)',
  'Payroll software & recruitment'];
const CORE = new Set(ORDER.slice(0, 5));

const grand = {};
for (const month of MONTHS) {
  const b = rows[month] ?? {};
  console.log(`\n=== ${month}`);
  let core = 0, wider = 0;
  for (const name of ORDER) {
    const v = b[name]; if (!v?.length) continue;
    const s = v.reduce((a, t) => a + amt(t), 0);
    if (CORE.has(name)) core += s; wider += s;
    console.log(`  ${name.padEnd(42)} ${String(v.length).padStart(3)}x ${eur(s).padStart(12)} €`);
    (grand[name] ??= 0); grand[name] += s;
  }
  console.log(`  ${'—'.repeat(42)}`);
  console.log(`  ${'STAFF COST (wages, KK, Lohnsteuer)'.padEnd(42)}     ${eur(core).padStart(12)} €`);
  console.log(`  ${'including BG advance + software/recruitment'.padEnd(42)}     ${eur(wider).padStart(12)} €`);
}

console.log('\n=== JUNE + JULY + AUGUST');
let core = 0, wider = 0;
for (const name of ORDER) {
  if (!grand[name]) continue;
  if (CORE.has(name)) core += grand[name]; wider += grand[name];
  console.log(`  ${name.padEnd(42)} ${eur(grand[name]).padStart(13)} €`);
}
console.log(`  ${'—'.repeat(56)}`);
console.log(`  ${'STAFF COST, three months'.padEnd(42)} ${eur(core).padStart(13)} €`);
console.log(`  ${'including BG + software/recruitment'.padEnd(42)} ${eur(wider).padStart(13)} €`);

const stray = (rows['?']?.['wage, period not stated'] ?? [])
  .filter(t => t.date >= '2026-06-01' && t.date <= '2026-09-30');
console.log(`\nWage payments in Jun–Sep whose narrative names no period: ${stray.length}`
  + (stray.length ? ` (${eur(stray.reduce((s, t) => s + amt(t), 0))} €)` : ''));
for (const t of stray) console.log(`  ${t.date} ${eur(amt(t)).padStart(9)} € ${(t.counterparty ?? '').slice(0, 32).padEnd(34)} "${(t.description ?? '').slice(0, 46)}"`);

/* The four funds that state no period decide ~7.100 € between July and August,
   so the swing is shown rather than buried in a single number. */
console.log('\nManual funds (BARMER, DAK, BKK firmus, hkk) — payment dates:');
for (const t of out.filter(t => MANUAL.test(t.counterparty ?? '') && t.date >= '2026-06-01' && t.date <= '2026-09-30')
  .sort((a, z) => a.date < z.date ? -1 : 1))
  console.log(`  ${t.date} ${eur(amt(t)).padStart(9)} € ${(t.counterparty ?? '').slice(0, 24)}`);

/* Cross-check: every C - Personnel euro should be accounted for or named. */
console.log('\nReconciliation — all C - Personnel cash out, by payment month:');
for (const m of ['2026-06', '2026-07', '2026-08', '2026-09']) {
  const all = out.filter(t => t.category === 'C - Personnel' && t.date.startsWith(m));
  const counted = all.filter(t => WAGE.test(t.description ?? '') && !NOT_WAGE.test(t.counterparty ?? ''));
  const missed = all.filter(t => !counted.includes(t));
  console.log(`  ${m}  total ${eur(all.reduce((s, t) => s + amt(t), 0)).padStart(11)} €`
    + ` · recognised as wages ${eur(counted.reduce((s, t) => s + amt(t), 0)).padStart(11)} €`
    + ` · other ${eur(missed.reduce((s, t) => s + amt(t), 0)).padStart(10)} €`);
  for (const t of missed) console.log(`        ${t.date} ${eur(amt(t)).padStart(9)} € ${(t.counterparty ?? '').slice(0, 30).padEnd(32)} "${(t.description ?? '').slice(0, 40)}"`);
}
