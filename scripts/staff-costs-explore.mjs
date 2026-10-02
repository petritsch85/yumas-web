/**
 * What staff money leaves the account, and which month it belongs to.
 *
 * Wages are paid in two tranches — an Abschlag before month end and the balance
 * once the Abrechnung is done — so the cash leaving in a month is not that
 * month's cost. The bank narrative usually names the period outright
 * ("Lohn-/Gehaltzahlung 8/2026", "Abschlag fuer 04/2026"), which is what makes
 * an accrual answer possible at all. This surveys the ground before counting.
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

const out = tx.filter(t => t.direction !== 'in' && t.date >= '2026-05-01' && t.date <= '2026-10-02');
const amt = t => Math.abs(t.amount_cents) / 100;

console.log('Categories on outgoing money, May–Oct:');
const byCat = {};
for (const t of out) (byCat[t.category ?? '—'] ??= []).push(t);
for (const [c, v] of Object.entries(byCat).sort((a, z) => z[1].reduce((s, t) => s + amt(t), 0) - a[1].reduce((s, t) => s + amt(t), 0)))
  console.log(`  ${String(v.length).padStart(4)}x  ${c.padEnd(18)} ${eur(v.reduce((s, t) => s + amt(t), 0)).padStart(12)} €`);

/* Everything that might be staff-related, however it is categorised. */
const STAFF = /lohn|gehalt|abschlag|abrechnung|krankenkasse|kasse|aok|barmer|dak|tk\b|ikk|bkk|hkk|knappschaft|minijob|berufsgenossenschaft|bg\s|sozialkasse|lohnsteuer|finanzamt|datev|personal|payroll|rentenversicherung|umlage/i;
const maybe = out.filter(t => STAFF.test(`${t.counterparty ?? ''} ${t.description ?? ''}`) || t.category === 'C - Personnel');

console.log(`\n${maybe.length} possibly staff-related payments. Distinct counterparties:`);
const byCp = {};
for (const t of maybe) (byCp[t.counterparty || '(no counterparty)'] ??= []).push(t);
for (const [c, v] of Object.entries(byCp).sort((a, z) => z[1].reduce((s, t) => s + amt(t), 0) - a[1].reduce((s, t) => s + amt(t), 0)))
  console.log(`  ${String(v.length).padStart(4)}x ${eur(v.reduce((s, t) => s + amt(t), 0)).padStart(11)} €  ${c.slice(0, 46).padEnd(48)} [${v[0].category}]  "${(v[0].description ?? '').slice(0, 44)}"`);

/* How often does the narrative name its period? */
const PERIOD = /(\d{1,2})\s*[\/.]\s*(20\d{2})|(\d{1,2})\s*[\/.]\s*(\d{2})\b/;
const named = maybe.filter(t => PERIOD.test(t.description ?? ''));
console.log(`\nnarratives naming a period: ${named.length} of ${maybe.length}`);
for (const t of named.slice(0, 12)) console.log(`   ${t.date} ${eur(amt(t)).padStart(9)} € "${(t.description ?? '').slice(0, 68)}"`);
