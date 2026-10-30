/**
 * Add a Too Good To Go estimate to a month's sales forecast.
 *
 * TGTG reports only after the month, so the forecast has to carry an estimate:
 * per restaurant and shift, the average month of the last three on file,
 * spread evenly over the forecast's open days of that shift — the same way the
 * statement itself is spread once it arrives. A row already carrying the
 * estimate is left alone, so running this twice adds nothing.
 *
 *   node scripts/forecast-tgtg.mjs 2026-11            → shows
 *   node scripts/forecast-tgtg.mjs 2026-11 --apply    → writes
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const month = process.argv[2];
const apply = process.argv.includes('--apply');
const [y, mo] = month.split('-').map(Number);
const end = `${month}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
const TAG = ' + TGTG est.';

const { data: locs } = await db.from('locations').select('id,name');
const name = id => locs.find(l => l.id === id)?.name ?? id;

/* The last three months on file, before the forecast month. */
const { data: tg } = await db.from('tgtg_sales').select('location_id,shift,net,month').lt('month', `${month}-01`);
const months = [...new Set((tg ?? []).map(r => r.month))].sort().slice(-3);
const avg = {};
for (const r of tg ?? []) if (months.includes(r.month)) avg[`${r.location_id}|${r.shift}`] = (avg[`${r.location_id}|${r.shift}`] ?? 0) + Number(r.net) / months.length;
console.log(`Basis: ${months.map(m => m.slice(0, 7)).join(', ')}`);

const { data: fc } = await db.from('sales_forecasts').select('id,location_id,shift_type,net_total,source').gte('forecast_date', `${month}-01`).lte('forecast_date', end);
let total = 0;
for (const [key, monthly] of Object.entries(avg)) {
  const [loc, sh] = key.split('|');
  const rows = (fc ?? []).filter(r => r.location_id === loc && r.shift_type === sh);
  if (!rows.length) { console.log(`  ${name(loc).padEnd(9)} ${sh.padEnd(6)} ${monthly.toFixed(0).padStart(5)} € — keine Prognosetage, übersprungen`); continue; }
  const per = monthly / rows.length;
  const todo = rows.filter(r => !String(r.source ?? '').includes(TAG));
  console.log(`  ${name(loc).padEnd(9)} ${sh.padEnd(6)} ${monthly.toFixed(0).padStart(5)} € über ${rows.length} Tage (${per.toFixed(2)} €/Tag)${todo.length < rows.length ? ` · ${rows.length - todo.length} schon enthalten` : ''}`);
  total += per * todo.length;
  if (!apply) continue;
  for (const r of todo) {
    const { error } = await db.from('sales_forecasts')
      .update({ net_total: Math.round((Number(r.net_total) + per) * 100) / 100, source: String(r.source ?? '') + TAG }).eq('id', r.id);
    if (error) { console.log(error.message); process.exit(1); }
  }
}
console.log(`\nTGTG-Schätzung ${month}: +${total.toFixed(0)} €${apply ? ' geschrieben' : ' (Probelauf — mit --apply schreiben)'}`);
