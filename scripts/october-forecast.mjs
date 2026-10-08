/**
 * What October is likely to come to, per restaurant.
 *
 * Built from the same sources the P&L's net sales row adds up — the till, the
 * webshop, Wolt, Lieferando and the catering invoices — so the forecast is
 * comparable with the months it is forecast from.
 *
 * Three things a naive version got wrong, and why it is built this way:
 *
 *   The unit is the shift, not the month. A month's shape is its trading days,
 *   and the stores keep different weeks — Eschborn never opens on a Sunday and
 *   earns a third as much on a Friday as on a Wednesday — so a flat daily
 *   average spreads an office-district Wednesday across a dead Saturday.
 *
 *   The weekday figure is a MEDIAN of the regular channels only. A mean let one
 *   catered Sunday at Taunus — 4.030 € against a till that has rung 30 € on the
 *   only Sunday it opened — stand as the Sunday rate and invent 12.000 € of
 *   sales out of three more Sundays.
 *
 *   Catering is counted from the diary, not estimated. Those invoices carry an
 *   event date, so the rest of the month's events are already known and there
 *   is no reason to guess at them.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const page = async b => { const o = []; for (let p = 0; ; p++) { const { data, error } = await b(p); if (error) { console.error(error.message); return o; } o.push(...data); if (data.length < 1000) return o; } };

const FROM = '2026-06-01';
const STORES = ['Westend', 'Eschborn', 'Taunus'];

const { data: locs } = await db.from('locations').select('id,name');
const nameOf = new Map((locs ?? []).map(l => [l.id, l.name]));
const idOf = new Map((locs ?? []).map(l => [l.name, l.id]));

/** Regular trade: date -> store -> net. Catering is kept out, deliberately. */
const regular = new Map();
/** Catering, which is diarised: date -> store -> net. */
const catering = new Map();
/** Whether the till rang at all — what makes a day a trading day. */
const traded = new Map();

const put = (map, date, loc, v) => {
  const store = nameOf.get(loc);
  if (!store || !STORES.includes(store) || !Number.isFinite(v) || !v) return;
  const d = String(date).slice(0, 10);
  if (d < FROM) return;
  if (!map.has(d)) map.set(d, new Map());
  map.get(d).set(store, (map.get(d).get(store) ?? 0) + v);
};

for (const r of await page(p => db.from('shift_reports').select('location_id,report_date,net_total')
  .gte('report_date', FROM).range(p * 1000, p * 1000 + 999))) {
  put(regular, r.report_date, r.location_id, Number(r.net_total ?? 0));
  const store = nameOf.get(r.location_id);
  if (store) traded.set(`${String(r.report_date).slice(0, 10)}|${store}`, true);
}
for (const r of await page(p => db.from('webshop_orders').select('location_id,sale_date,net_cents')
  .gte('sale_date', FROM).range(p * 1000, p * 1000 + 999))) put(regular, r.sale_date, r.location_id, Number(r.net_cents ?? 0) / 100);
for (const r of await page(p => db.from('wolt_shift_sales').select('location_id,sale_date,net_final')
  .gte('sale_date', FROM).range(p * 1000, p * 1000 + 999))) put(regular, r.sale_date, r.location_id, Number(r.net_final ?? 0));
for (const r of await page(p => db.from('lieferando_shift_sales').select('location_id,sale_date,net_final')
  .gte('sale_date', FROM).range(p * 1000, p * 1000 + 999))) put(regular, r.sale_date, r.location_id, Number(r.net_final ?? 0));

const bills = await page(p => db.from('outgoing_bills')
  .select('issuing_location,event_date,net_total,paid_in_store,invoice_number')
  .gte('event_date', FROM).eq('paid_in_store', false).range(p * 1000, p * 1000 + 999));
for (const b of bills) {
  if (String(b.invoice_number ?? '').toUpperCase().startsWith('BB')) continue;
  const id = idOf.get(b.issuing_location);
  if (id) put(catering, b.event_date, id, Number(b.net_total ?? 0));
}

/* The forecast starts the day after the last till upload, not "today": a day
   whose Z-report has not been entered would otherwise count as a day of zero. */
const lastTill = [...traded.keys()].map(k => k.split('|')[0]).sort().at(-1);
const DOW = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const dowOf = d => new Date(d + 'T12:00:00Z').getUTCDay();
const eur = v => Math.round(v).toLocaleString('de-DE').padStart(9);
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };

const octDays = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
const left = octDays.filter(d => d > lastTill);

console.log(`\nOKTOBER-PROGNOSE · Kassendaten bis ${lastTill} · ${left.length} Tage offen\n${'='.repeat(78)}`);

let gDone = 0, gFc = 0, gSep = 0;
for (const store of STORES) {
  console.log(`\n### ${store}`);
  const net = d => (regular.get(d)?.get(store) ?? 0) + (catering.get(d)?.get(store) ?? 0);

  for (const mon of ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) {
    const days = [...regular.keys()].filter(d => d.startsWith(mon) && traded.has(`${d}|${store}`));
    const sum = [...new Set([...regular.keys(), ...catering.keys()])]
      .filter(d => d.startsWith(mon)).reduce((t, d) => t + net(d), 0);
    if (!sum) { console.log(`  ${mon}        —`); continue; }
    console.log(`  ${mon}  ${eur(sum)} €  ${String(days.length).padStart(2)} Handelstage  Ø ${eur(sum / (days.length || 1))} €/Tag`);
  }

  /* Four weeks of regular trade, by weekday, median. Only days the till rang:
     a closed day is not a weak day and must not drag the rate down. */
  const window = [...regular.keys()]
    .filter(d => d >= '2026-09-10' && d <= lastTill && traded.has(`${d}|${store}`))
    .sort();
  const byDow = new Map();
  for (const d of window) {
    const k = dowOf(d);
    if (!byDow.has(k)) byDow.set(k, []);
    byDow.get(k).push(regular.get(d).get(store) ?? 0);
  }
  const rate = new Map();
  for (const [k, vs] of byDow) rate.set(k, median(vs));

  console.log(`  Median je Wochentag, nur Regelgeschäft (10.09.–${lastTill.slice(8)}.10.):`);
  console.log('    ' + [1, 2, 3, 4, 5, 6, 0]
    .map(k => `${DOW[k]} ${rate.has(k) ? Math.round(rate.get(k)).toLocaleString('de-DE') : 'zu'}`).join('  ')
    + `   (n=${[1, 2, 3, 4, 5, 6, 0].map(k => (byDow.get(k) ?? []).length).join('/')})`);

  const soFar = octDays.filter(d => d <= lastTill).reduce((t, d) => t + net(d), 0);
  const restRegular = left.reduce((t, d) => t + (rate.get(dowOf(d)) ?? 0), 0);
  const restCatering = left.reduce((t, d) => t + (catering.get(d)?.get(store) ?? 0), 0);
  const fc = soFar + restRegular + restCatering;

  console.log(`  bisher ${eur(soFar)} €  +  Regelgeschäft ${eur(restRegular)} €  +  Catering gebucht ${eur(restCatering)} €`);
  console.log(`  →  PROGNOSE OKTOBER ${eur(fc)} €`);

  const sep = octDays.map(d => d.replace('-10-', '-09-')).filter(d => d.endsWith('31') === false)
    .reduce((t, d) => t + net(d), 0);
  console.log(`     September ${eur(sep)} €  →  ${sep ? ((fc / sep - 1) * 100).toFixed(1) : '—'} %`);
  gDone += soFar; gFc += fc; gSep += sep;
}

console.log(`\n${'='.repeat(78)}`);
console.log(`GRUPPE   bisher ${eur(gDone)} €   PROGNOSE OKTOBER ${eur(gFc)} €   September ${eur(gSep)} €   ${((gFc / gSep - 1) * 100).toFixed(1)} %`);
