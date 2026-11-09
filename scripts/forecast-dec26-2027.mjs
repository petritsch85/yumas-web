/**
 * Sales forecast for December 2026 and the whole of 2027, per restaurant,
 * day and shift, into sales_forecasts.
 *
 * value = base × season × growth × special day
 *
 *  base     Trimmed mean (best and worst day dropped) of reported net sales,
 *           all channels as the daily sheet adds them, per weekday and shift,
 *           01.09.–31.10.2026. Same as the November forecast.
 *  season   The store's own monthly pattern, from its Z-reports: each month's
 *           trimmed mean per open shift, against the year's average, divided by
 *           Sep–Oct's. Eschborn averages two years (Nov 2024–Oct 2026); Westend
 *           and Taunus have one (Nov 2025–Oct 2026), and Taunus' is halved
 *           towards 1 because the store was still finding its level. Capped at
 *           0.6–1.6 so one month of events cannot set a whole year.
 *  growth   2027 only, on top of today's run-rate: Westend +2 %, Eschborn +5 %,
 *           Taunus +15 % (agreed 09.11.2026).
 *  special  Days around Christmas and New Year take last year's ratio of that
 *           date to an ordinary day of its weekday; holiday dinners and bridge
 *           lunches take 2026's. Where a store has no history for a day, the
 *           Westend ratio stands in, and 31 Dec lunch, never opened before,
 *           takes half a normal lunch.
 *
 * Closures and the weekly opening pattern decide which shifts get a figure.
 *
 *   node scripts/forecast-dec26-2027.mjs            → shows
 *   node scripts/forecast-dec26-2027.mjs --apply    → writes (replaces 01.12.2026–31.12.2027)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const apply = process.argv.includes('--apply');

const FROM = '2026-12-01', TO = '2027-12-31';
const BASE_FROM = '2026-09-01', BASE_TO = '2026-10-31';
const GROWTH_2027 = { Westend: 0.02, Eschborn: 0.05, Taunus: 0.15 };
const SEASON_WINDOWS = { Eschborn: [['2024-11', '2025-10'], ['2025-11', '2026-10']], Westend: [['2025-11', '2026-10']], Taunus: [['2025-11', '2026-10']] };
const SEASON_DAMP = { Taunus: 0.5 };
/* Months left out of the season. Eschborn, March 2026: about a dozen lunches of
   2.400–2.800 € while the dinners fell away — events or a lunch/dinner split,
   not a season. March 2025 was an ordinary month and stands alone. */
const SEASON_SKIP = { Eschborn: ['2026-03'] };
const SOURCE = 'forecast 12/2026–2027 · trimmed mean 09–10/2026 · own seasonality · growth W+2% E+5% T+15%';

const page = async b => { const o = []; for (let p = 0; ; p++) { const { data, error } = await b(p); if (error) throw error; o.push(...data); if (data.length < 1000) return o; } };
const KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const dowIdx = d => (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7;
const trimmedMean = a => { const s = [...a].sort((x, y) => x - y); const t = s.length >= 5 ? s.slice(1, -1) : s; return t.length ? t.reduce((x, y) => x + y, 0) / t.length : 0; };
/* For a month of shifts: a tenth off each end, so a party night does not set the month. */
const trim10 = a => { const s = [...a].sort((x, y) => x - y); const k = Math.floor(s.length / 10); const t = s.slice(k, s.length - k); return t.length ? t.reduce((x, y) => x + y, 0) / t.length : 0; };
const days = (a, b) => { const o = []; for (const t = new Date(a + 'T12:00:00Z'); t <= new Date(b + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1)) o.push(t.toISOString().slice(0, 10)); return o; };
const monthsOf = (a, b) => { const o = []; for (let [y, m] = a.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= b; m === 12 ? (y++, m = 1) : m++) o.push(`${y}-${String(m).padStart(2, '0')}`); return o; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const { data: locs } = await db.from('locations').select('id,name').eq('type', 'restaurant');
const { data: settings } = await db.from('forecast_settings').select('location_id,shift_type,closed_weekdays');
const { data: closures } = await db.from('closure_days').select('location_id,closure_date,shift_type,kind');

/* Z-reports since the first store opened: the history the season and special days read. */
const z = await page(p => db.from('shift_reports').select('location_id,report_date,shift_type,net_total').gte('report_date', '2024-07-01').order('report_date').range(p * 1000, p * 1000 + 999));
const zBy = {};
for (const r of z) zBy[`${r.location_id}|${r.report_date}|${r.shift_type}`] = (zBy[`${r.location_id}|${r.report_date}|${r.shift_type}`] ?? 0) + Number(r.net_total ?? 0);
const zVal = (loc, d, sh) => zBy[`${loc}|${d}|${sh}`];
/** An ordinary day of that weekday and shift around a date: the four weeks before it, trimmed. */
const normalAround = (loc, d, sh) => {
  const w = dowIdx(d), vals = [];
  for (const x of days(new Date(Date.parse(d + 'T12:00:00Z') - 35 * 864e5).toISOString().slice(0, 10), new Date(Date.parse(d + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10)))
    if (dowIdx(x) === w && zVal(loc, x, sh) > 0) vals.push(zVal(loc, x, sh));
  return vals.length >= 2 ? trimmedMean(vals) : 0;
};
const ratioOn = (loc, d, sh) => { const v = zVal(loc, d, sh), n = normalAround(loc, d, sh); return v > 0 && n > 0 ? clamp(v / n, 0.1, 3) : null; };

/** Against the weeks after a date instead: for days whose four weeks before were the Christmas break. */
const normalAfter = (loc, d, sh) => {
  const w = dowIdx(d), vals = [];
  for (const x of days('2026-01-12', '2026-02-06')) if (dowIdx(x) === w && zVal(loc, x, sh) > 0) vals.push(zVal(loc, x, sh));
  return vals.length >= 2 ? trimmedMean(vals) : 0;
};
const ratioAfter = (loc, d, sh) => { const v = zVal(loc, d, sh), n = normalAfter(loc, d, sh); return v > 0 && n > 0 ? clamp(v / n, 0.1, 3) : null; };

const westendId = locs.find(l => l.name === 'Westend')?.id;
/* The two days before Christmas carry last year's ratio date for date. */
const XMAS_MAP = { '12-22': '2025-12-22', '12-23': '2025-12-23' };
/* Between Christmas and New Year one ratio per shift, the average of last
   year's days — the weekdays fall differently each year, the quiet does not.
   31 Dec dinner keeps its own; 31 Dec lunch, never opened, takes the lunch one. */
const BETWEEN_2025 = ['2025-12-27', '2025-12-28', '2025-12-29', '2025-12-30'];
const isBetween = d => { const md = d.slice(5); return md >= '12-27' && md <= '12-30'; };
/* The first days after New Year, each from the same day last year. */
const NEWYEAR_MAP = { '2027-01-02': '2026-01-03', '2027-01-03': '2026-01-04' };
/* The first full week back (school holidays still on): the average of 05.–09.01.2026. */
const FIRST_WEEK_2026 = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'];
const isFirstWeek = d => d >= '2027-01-04' && d <= '2027-01-08';
const HOLIDAY_2026 = ['2026-05-01', '2026-05-14', '2026-06-04'];
const HOLIDAY_2027 = ['2027-03-26', '2027-05-01', '2027-05-06', '2027-05-17', '2027-05-27'];
const BRIDGE_2026 = ['2026-05-15', '2026-06-05'];
const BRIDGE_2027 = ['2027-05-07', '2027-05-28'];
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

const rows = [];
const report = [];
for (const L of locs) {
  if (!(L.name in GROWTH_2027)) continue;

  /* ── base: all channels, 01.09.–31.10.2026 ── */
  const day = {};
  const add = (d, sh, v) => { if (!d || !(sh === 'lunch' || sh === 'dinner') || !isFinite(v)) return; day[`${d}|${sh}`] = (day[`${d}|${sh}`] ?? 0) + v; };
  const range = q => q.gte('sale_date', BASE_FROM).lte('sale_date', BASE_TO);
  for (const r of z) if (r.location_id === L.id && r.report_date >= BASE_FROM && r.report_date <= BASE_TO) add(r.report_date, r.shift_type, Number(r.net_total ?? 0));
  for (const r of await page(p => range(db.from('webshop_orders').select('sale_date,shift,net_cents').eq('location_id', L.id).eq('counts', true)).range(p * 1000, p * 1000 + 999))) add(r.sale_date, r.shift, r.net_cents / 100);
  const wolt = await page(p => range(db.from('wolt_shift_sales').select('sale_date,shift,net_sales,net_final').eq('location_id', L.id)).range(p * 1000, p * 1000 + 999));
  for (const r of wolt) add(r.sale_date, r.shift, Number(r.net_final ?? 0));
  const { data: credits } = await db.from('wolt_month_credits').select('month,net').eq('location_id', L.id).in('month', ['2026-09-01', '2026-10-01']);
  for (const c of credits ?? []) {
    const inM = wolt.filter(r => r.sale_date.startsWith(c.month.slice(0, 7)));
    const b = inM.reduce((t, r) => t + Number(r.net_sales), 0);
    if (b > 0) for (const r of inM) add(r.sale_date, r.shift, Number(c.net) * Number(r.net_sales) / b);
  }
  for (const r of await page(p => range(db.from('lieferando_shift_sales').select('sale_date,shift,net_final').eq('location_id', L.id)).range(p * 1000, p * 1000 + 999))) add(r.sale_date, r.shift, Number(r.net_final ?? 0));
  const { data: bills } = await db.from('outgoing_bills').select('event_date,shift_type,net_total,invoice_number').eq('issuing_location', L.name).eq('paid_in_store', false).gte('event_date', BASE_FROM).lte('event_date', BASE_TO);
  for (const b of bills ?? []) if (!/^BB/i.test(b.invoice_number ?? '')) add(b.event_date, b.shift_type, Number(b.net_total ?? 0));
  const base = {};
  for (const sh of ['lunch', 'dinner']) for (let w = 0; w < 7; w++)
    base[`${sh}|${w}`] = trimmedMean(Object.entries(day).filter(([k, v]) => { const [d, s] = k.split('|'); return s === sh && dowIdx(d) === w && v > 0; }).map(([, v]) => v));

  /* ── season: own Z-reports, per shift and calendar month ── */
  const season = { lunch: {}, dinner: {} };
  for (const sh of ['lunch', 'dinner']) {
    const perWindow = [];
    for (const [a, b] of SEASON_WINDOWS[L.name]) {
      const idx = {};
      for (const m of monthsOf(a, b)) {
        if ((SEASON_SKIP[L.name] ?? []).includes(m)) continue;
        const v =Object.entries(zBy).filter(([k, x]) => { const [loc, d, s] = k.split('|'); return loc === L.id && s === sh && d.startsWith(m) && x > 0; }).map(([, x]) => x);
        if (v.length >= 4) idx[Number(m.slice(5))] = trim10(v);
      }
      const avg = mean(Object.values(idx));
      const ref = mean([idx[9], idx[10]].filter(Boolean));
      if (!avg || !ref) continue;
      perWindow.push(Object.fromEntries(Object.entries(idx).map(([m, v]) => [m, v / ref])));
    }
    for (let m = 1; m <= 12; m++) {
      const f = mean(perWindow.map(w => w[m]).filter(v => v != null)) ?? 1;
      const damp = SEASON_DAMP[L.name] ?? 1;
      season[sh][m] = clamp(1 + (f - 1) * damp, 0.6, 1.6);
    }
  }

  /* ── special days ── */
  /* Own history first, Westend's where the store has none, else neutral. */
  const fromDays = (srcDays, ratio, label) => {
    const own = mean(srcDays.map(x => ratio(L.id, x)).filter(v => v != null));
    if (own != null) return { f: own, why: label };
    const ws = westendId ? mean(srcDays.map(x => ratio(westendId, x)).filter(v => v != null)) : null;
    return ws != null ? { f: ws, why: `${label} (Westend's)` } : { f: 1, why: '' };
  };
  const special = (d, sh) => {
    const md = d.slice(5);
    if (XMAS_MAP[md]) return fromDays([XMAS_MAP[md]], (l, x) => ratioOn(l, x, sh), `as ${XMAS_MAP[md]}`);
    if (isBetween(d)) return fromDays(BETWEEN_2025, (l, x) => ratioOn(l, x, sh), 'between the holidays, 2025');
    if (md === '12-31') return sh === 'dinner'
      ? fromDays(['2025-12-31'], (l, x) => ratioOn(l, x, sh), 'as 2025-12-31')
      : fromDays(BETWEEN_2025, (l, x) => ratioOn(l, x, 'lunch'), '31.12 lunch, as between-holiday lunches');
    if (NEWYEAR_MAP[d]) return fromDays([NEWYEAR_MAP[d]], (l, x) => ratioAfter(l, x, sh), `as ${NEWYEAR_MAP[d]}`);
    if (isFirstWeek(d)) return fromDays(FIRST_WEEK_2026, (l, x) => ratioAfter(l, x, sh), 'first week back, 2026');
    if (HOLIDAY_2027.includes(d) && sh === 'dinner') {
      const own = mean(HOLIDAY_2026.map(h => ratioOn(L.id, h, 'dinner')).filter(v => v != null));
      return { f: own ?? 1, why: 'holiday dinner as 2026' };
    }
    if (BRIDGE_2027.includes(d) && sh === 'lunch') {
      const own = mean(BRIDGE_2026.map(h => ratioOn(L.id, h, 'lunch')).filter(v => v != null));
      return { f: own ?? 1, why: 'bridge lunch as 2026' };
    }
    return { f: 1, why: '' };
  };

  const closedPattern = (sh, d) => (settings.find(s => s.location_id === L.id && s.shift_type === sh)?.closed_weekdays ?? []).includes(KEYS[dowIdx(d)]);
  const closedOn = (sh, d) => {
    const c = closures.filter(x => x.location_id === L.id && x.closure_date === d && (x.shift_type === sh || x.shift_type === 'all'));
    if (c.some(x => x.kind === 'open')) return false;
    if (c.some(x => x.kind !== 'open')) return true;
    return closedPattern(sh, d);
  };

  const g = GROWTH_2027[L.name];
  for (const d of days(FROM, TO)) {
    for (const sh of ['lunch', 'dinner']) {
      if (closedOn(sh, d)) continue;
      const b = base[`${sh}|${dowIdx(d)}`];
      if (!(b > 0)) continue;
      const s = season[sh][Number(d.slice(5, 7))];
      const sp = special(d, sh);
      const v = b * s * (d >= '2027-01-01' ? 1 + g : 1) * sp.f;
      rows.push({ location_id: L.id, forecast_date: d, shift_type: sh, net_total: Math.round(v * 100) / 100, source: SOURCE });
      if (sp.why) report.push(`${L.name.padEnd(8)} ${d} ${sh.padEnd(6)} ×${sp.f.toFixed(2)} ${sp.why} → ${Math.round(v)}`);
    }
  }
  console.log(`\n${L.name}  base (Mon..Sun) lunch: ${[0, 1, 2, 3, 4, 5, 6].map(w => Math.round(base[`lunch|${w}`])).join(' ')} · dinner: ${[0, 1, 2, 3, 4, 5, 6].map(w => Math.round(base[`dinner|${w}`])).join(' ')}`);
  console.log(`  season lunch : ${Object.values(season.lunch).map(v => v.toFixed(2)).join(' ')}`);
  console.log(`  season dinner: ${Object.values(season.dinner).map(v => v.toFixed(2)).join(' ')}`);
}

console.log('\nSpecial days:');
for (const r of report) console.log('  ' + r);

/* Monthly totals, and last year's Z-report total of the same month for scale. */
console.log('\nMonth    ' + locs.filter(l => l.name in GROWTH_2027).map(l => l.name.padStart(18)).join('') + '         Group | last year Z (same month)');
for (const m of monthsOf('2026-12', '2027-12')) {
  const ly = `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
  let grp = 0, grpLy = 0;
  const cells = locs.filter(l => l.name in GROWTH_2027).map(l => {
    const t = rows.filter(r => r.location_id === l.id && r.forecast_date.startsWith(m)).reduce((a, r) => a + r.net_total, 0);
    const lyT = z.filter(r => r.location_id === l.id && r.report_date.startsWith(ly)).reduce((a, r) => a + Number(r.net_total), 0);
    grp += t; grpLy += lyT;
    return `${Math.round(t).toLocaleString('de-DE')} (${Math.round(lyT).toLocaleString('de-DE')})`.padStart(18);
  });
  console.log(`${m}  ${cells.join('')}  ${Math.round(grp).toLocaleString('de-DE').padStart(12)} | ${Math.round(grpLy).toLocaleString('de-DE')}`);
}
const t27 = rows.filter(r => r.forecast_date.startsWith('2027')).reduce((a, r) => a + r.net_total, 0);
console.log(`\n2027 total ${Math.round(t27).toLocaleString('de-DE')} € · ${rows.length} shifts`);

if (!apply) { console.log('\nDry run — --apply writes.'); process.exit(0); }
const { error: delErr } = await db.from('sales_forecasts').delete().gte('forecast_date', FROM).lte('forecast_date', TO);
if (delErr) { console.error(delErr.message); process.exit(1); }
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await db.from('sales_forecasts').insert(rows.slice(i, i + 500));
  if (error) { console.error(error.message); process.exit(1); }
}
console.log(`\n${rows.length} rows written.`);
