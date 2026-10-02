/**
 * The social-insurance and payroll-tax side, in full.
 *
 * Wages name their period in the narrative, so they attribute cleanly. The
 * contributions are messier: each fund words its reference differently, some
 * state a date range, some a month, some only a customer number. They have to
 * be read before they can be assigned to June, July or August.
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

const tx = await page(p => db.from('cashflow_transactions')
  .select('id, date, direction, counterparty, amount_cents, description, category')
  .order('id').range(p * 500, p * 500 + 499));
const out = tx.filter(t => t.direction !== 'in' && t.date >= '2026-05-15' && t.date <= '2026-10-02');
const amt = t => Math.abs(t.amount_cents) / 100;

const FUNDS = /aok|techniker krankenkasse|barmer|dak-|ikk |bkk |hkk |knappschaft|meine krankenkasse|berufsgenossenschaft/i;
const TAX = /^FA /i;

console.log('=== HEALTH / SOCIAL INSURANCE FUNDS');
for (const t of out.filter(t => FUNDS.test(t.counterparty ?? '')).sort((a, z) => a.date < z.date ? -1 : 1))
  console.log(`${t.date} ${eur(amt(t)).padStart(11)} €  ${(t.counterparty ?? '').slice(0, 34).padEnd(36)}\n     ${(t.description ?? '').slice(0, 150)}`);

console.log('\n=== PAYROLL TAX (Finanzamt)');
for (const t of out.filter(t => TAX.test(t.counterparty ?? '')).sort((a, z) => a.date < z.date ? -1 : 1))
  console.log(`${t.date} ${eur(amt(t)).padStart(11)} €\n     ${(t.description ?? '').slice(0, 220)}`);

console.log('\n=== PAYROLL SOFTWARE / RECRUITMENT');
for (const t of out.filter(t => /vertical cloud|gastromatic|indeed/i.test(`${t.counterparty ?? ''} ${t.description ?? ''}`)).sort((a, z) => a.date < z.date ? -1 : 1))
  console.log(`${t.date} ${eur(amt(t)).padStart(10)} €  ${(t.counterparty ?? '').slice(0, 30).padEnd(32)} ${(t.description ?? '').slice(0, 60)}`);

/* Items the keyword sweep caught that are not staff cost, listed so the
   exclusion is visible rather than silent. */
console.log('\n=== CAUGHT BY KEYWORD BUT NOT STAFF COST');
const NOT = /wohninvest|sparkasse|lidl|toom|kreissl|bundeskasse|stadtkasse|gemeinschaftskasse|schlusseldienst|schmitt|getraenke|liederbach|eschborn\/\//i;
for (const t of out.filter(t => NOT.test(t.counterparty ?? '') && (t.category === 'C - Personnel' || /kasse/i.test(t.counterparty ?? ''))).sort((a, z) => a.date < z.date ? -1 : 1))
  console.log(`${t.date} ${eur(amt(t)).padStart(10)} €  ${(t.counterparty ?? '').slice(0, 40).padEnd(42)} [${t.category}] ${(t.description ?? '').slice(0, 45)}`);
