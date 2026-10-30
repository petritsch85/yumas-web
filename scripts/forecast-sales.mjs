/**
 * Write the sales forecast for a month into sales_forecasts.
 *
 * Per restaurant, weekday and shift the base is the trimmed mean of the
 * reported net sales (all channels, as the daily sheet adds them) over the
 * base window, the best and worst day dropped. A median would drop event
 * nights altogether; a plain mean lets one booking set the level. The base is
 * then moved by a seasonal factor and, for the last week of the month, a
 * second one — both read from last year's sales and set in DRIVERS below.
 * Shifts closed by the opening pattern get nothing.
 *
 * The same method and numbers as output/Yumas_Forecast_November_2026.xlsx.
 *
 *   node scripts/forecast-sales.mjs            → shows
 *   node scripts/forecast-sales.mjs --apply    → writes (replaces the month)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const apply = process.argv.includes('--apply');

const MONTH = '2026-11';
const BASE_FROM = '2026-09-01', BASE_TO = '2026-10-26';   // 27.–29.10. not fully reported yet
const LAST_WEEK_FROM = '2026-11-23';
const DRIVERS = {
  /* Nov vs. Sep–Okt per open day: 2025 −5,5 %; October carries the Buchmesse. */
  Westend:  { season: -0.05, lastWeek: -0.05 },
  /* +9,7 % (2024) and +20,5 % (2025); last week −23 % / −19 %. */
  Eschborn: { season:  0.10, lastWeek: -0.15 },
  /* Opened Aug 2025, last year still ramping up; last week −24 %, half weight. */
  Taunus:   { season:  0.00, lastWeek: -0.15 },
};
const [MY, MM] = MONTH.split('-').map(Number);
const MONTH_END = `${MONTH}-${String(new Date(Date.UTC(MY, MM, 0)).getUTCDate()).padStart(2, '0')}`;
const SOURCE = 'forecast 2026-11 · trimmed mean 01.09.–26.10.2026 · seasonality 2024/25';

const page = async b => { const o = []; for (let p = 0; ; p++) { const { data, error } = await b(p); if (error) throw error; o.push(...data); if (data.length < 1000) return o; } };
const KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const dowIdx = d => (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7;
const trimmedMean = a => { const s = [...a].sort((x, y) => x - y); const t = s.length >= 5 ? s.slice(1, -1) : s; return t.length ? t.reduce((x, y) => x + y, 0) / t.length : 0; };

const { data: locs } = await db.from('locations').select('id,name').eq('type', 'restaurant');
const { data: settings } = await db.from('forecast_settings').select('location_id,shift_type,closed_weekdays');
const { data: closures } = await db.from('closure_days').select('location_id,closure_date,shift_type,kind').gte('closure_date', `${MONTH}-01`).lte('closure_date', MONTH_END);

const rows = [];
for (const L of locs) {
  const drv = DRIVERS[L.name];
  if (!drv) { console.log(`– ${L.name}: keine Treiber, übersprungen`); continue; }

  /* Reported net sales per date and shift — the daily sheet's channels. */
  const day = {};
  const add = (d, sh, v) => { if (!d || !(sh === 'lunch' || sh === 'dinner') || !isFinite(v)) return; day[`${d}|${sh}`] = (day[`${d}|${sh}`] ?? 0) + v; };
  const range = q => q.gte('sale_date', BASE_FROM).lte('sale_date', BASE_TO);
  for (const r of await page(p => db.from('shift_reports').select('report_date,shift_type,net_total').eq('location_id', L.id).gte('report_date', BASE_FROM).lte('report_date', BASE_TO).range(p * 1000, p * 1000 + 999))) add(r.report_date, r.shift_type, Number(r.net_total ?? 0));
  for (const r of await page(p => range(db.from('webshop_orders').select('sale_date,shift,net_cents').eq('location_id', L.id).eq('counts', true)).range(p * 1000, p * 1000 + 999))) add(r.sale_date, r.shift, r.net_cents / 100);
  const wolt = await page(p => db.from('wolt_shift_sales').select('sale_date,shift,net_sales,net_final').eq('location_id', L.id).gte('sale_date', '2026-09-01').lte('sale_date', '2026-10-31').range(p * 1000, p * 1000 + 999));
  for (const r of wolt) if (r.sale_date <= BASE_TO) add(r.sale_date, r.shift, Number(r.net_final ?? 0));
  const { data: credits } = await db.from('wolt_month_credits').select('month,net').eq('location_id', L.id).in('month', ['2026-09-01', '2026-10-01']);
  for (const c of credits ?? []) {
    const inM = wolt.filter(r => r.sale_date.startsWith(c.month.slice(0, 7)));
    const base = inM.reduce((t, r) => t + Number(r.net_sales), 0);
    if (base > 0) for (const r of inM) if (r.sale_date <= BASE_TO) add(r.sale_date, r.shift, Number(c.net) * Number(r.net_sales) / base);
  }
  for (const r of await page(p => range(db.from('lieferando_shift_sales').select('sale_date,shift,net_final').eq('location_id', L.id)).range(p * 1000, p * 1000 + 999))) add(r.sale_date, r.shift, Number(r.net_final ?? 0));
  const { data: bills } = await db.from('outgoing_bills').select('event_date,shift_type,net_total,invoice_number').eq('issuing_location', L.name).eq('paid_in_store', false).gte('event_date', BASE_FROM).lte('event_date', BASE_TO);
  for (const b of bills ?? []) if (!/^BB/i.test(b.invoice_number ?? '')) add(b.event_date, b.shift_type, Number(b.net_total ?? 0));

  const closedPattern = (sh, d) => (settings.find(s => s.location_id === L.id && s.shift_type === sh)?.closed_weekdays ?? []).includes(KEYS[dowIdx(d)]);
  const closedOn = (sh, d) => {
    const c = (closures ?? []).filter(x => x.location_id === L.id && x.closure_date === d && (x.shift_type === sh || x.shift_type === 'all'));
    if (c.some(x => x.kind === 'open')) return false;
    if (c.some(x => x.kind !== 'open')) return true;
    return closedPattern(sh, d);
  };

  const base = {};
  for (const sh of ['lunch', 'dinner']) for (let w = 0; w < 7; w++) {
    const vals = Object.entries(day).filter(([k, v]) => { const [d, s] = k.split('|'); return s === sh && dowIdx(d) === w && v > 0; }).map(([, v]) => v);
    base[`${sh}|${w}`] = trimmedMean(vals);
  }

  const [y, m] = MONTH.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let tot = 0;
  for (let d = 1; d <= days; d++) {
    const date = `${MONTH}-${String(d).padStart(2, '0')}`;
    for (const sh of ['lunch', 'dinner']) {
      if (closedOn(sh, date)) continue;
      const v = base[`${sh}|${dowIdx(date)}`] * (1 + drv.season) * (date >= LAST_WEEK_FROM ? 1 + drv.lastWeek : 1);
      if (v <= 0) continue;
      rows.push({ location_id: L.id, forecast_date: date, shift_type: sh, net_total: Math.round(v * 100) / 100, source: SOURCE });
      tot += v;
    }
  }
  console.log(`${L.name.padEnd(9)} ${Math.round(tot).toLocaleString('de-DE').padStart(8)} €  (${rows.filter(r => r.location_id === L.id).length} Schichten)`);
}
console.log(`Gruppe    ${Math.round(rows.reduce((t, r) => t + r.net_total, 0)).toLocaleString('de-DE').padStart(8)} €`);

if (!apply) { console.log('\nProbelauf — mit --apply schreiben.'); process.exit(0); }
const { error: delErr } = await db.from('sales_forecasts').delete().gte('forecast_date', `${MONTH}-01`).lte('forecast_date', MONTH_END);
if (delErr) { console.error(delErr.message); process.exit(1); }
const { error } = await db.from('sales_forecasts').insert(rows);
console.log(error ? `FEHLER: ${error.message}` : `\n${rows.length} Zeilen geschrieben.`);
