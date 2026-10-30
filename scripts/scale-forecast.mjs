/**
 * Raise or lower one restaurant's forecast for one shift and month by a single
 * factor, so its average per shift lands on a target — every day by the same
 * percentage, keeping the weekday pattern.
 *
 *   node scripts/scale-forecast.mjs Westend lunch 2026-11 1778.73
 *   node scripts/scale-forecast.mjs Westend dinner 2026-11 total=40500
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const [store, shift, month, target] = process.argv.slice(2);
/* "total=40500" aims at the month's forecast total instead of an average —
   for when reported sales (an invoiced event) already sit in the month. */
const byTotal = /^total=/.test(target ?? '');
const TARGET = Number(String(target).replace(/^total=/, ''));
if (!store || !['lunch', 'dinner'].includes(shift) || !/^\d{4}-\d{2}$/.test(month ?? '') || !(TARGET > 0)) {
  console.log('Aufruf: node scripts/scale-forecast.mjs <Restaurant> <lunch|dinner> <YYYY-MM> <Ziel Ø je Schicht>');
  process.exit(1);
}
const [y, m] = month.split('-').map(Number);
const end = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;

const { data: loc } = await db.from('locations').select('id').eq('name', store).single();
const { data: rows } = await db.from('sales_forecasts').select('id,net_total')
  .eq('location_id', loc.id).eq('shift_type', shift).gte('forecast_date', `${month}-01`).lte('forecast_date', end);
const total = rows.reduce((t, r) => t + Number(r.net_total), 0);
const factor = byTotal ? TARGET / total : TARGET / (total / rows.length);
console.log(`${store} ${shift} ${month}: vorher ${total.toFixed(2)} € / ${rows.length} Schichten = Ø ${(total / rows.length).toFixed(2)} · Faktor ${((factor - 1) * 100).toFixed(2)} %`);

let after = 0;
for (const r of rows) {
  const v = Math.round(Number(r.net_total) * factor * 100) / 100;
  after += v;
  const { error } = await db.from('sales_forecasts')
    .update({ net_total: v, source: `forecast ${month} · ${shift} scaled to Ø ${TARGET.toFixed(0)} per shift` }).eq('id', r.id);
  if (error) { console.log(error.message); process.exit(1); }
}
console.log(`nachher ${after.toFixed(2)} € = Ø ${(after / rows.length).toFixed(2)}`);
