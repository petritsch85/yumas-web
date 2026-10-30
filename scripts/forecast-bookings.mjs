/**
 * Lift a restaurant's forecast where the OpenTable book already says the night
 * will be strong.
 *
 * A night is worth roughly what a quiet night of that weekday brings in — the
 * walk-ins and the handful of tables every night has — plus what the bookings
 * beyond that handful bring. So:
 *
 *   booked night = median sales of that weekday & shift
 *                  + (booked covers − NORMAL_COVERS) × VALUE_PER_COVER
 *
 * and the forecast becomes the larger of that and what it already was. A thin
 * book never lowers a forecast: most tables are still booked in the last week,
 * and many never book at all.
 *
 * Calibrated on Eschborn, Sep–Oct 2026, where the book and the till overlap:
 * 08.09. (68 covers) took 8.289 €, 22.09. (52) 6.892 €, against a Tuesday
 * median of about 3.850 € — some 60 € per cover beyond the quiet night; the
 * EY training group on 07.10. (95 covers) only about 35 €. 45 € sits between.
 *
 *   node scripts/forecast-bookings.mjs Eschborn 2026-11           → shows
 *   node scripts/forecast-bookings.mjs Eschborn 2026-11 --apply   → writes
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const [store, month] = process.argv.slice(2);
const apply = process.argv.includes('--apply');
const NORMAL_COVERS = 10;     // booked covers an ordinary night already has
const VALUE_PER_COVER = 45;   // net € per booked cover beyond those
const BASE_FROM = '2026-09-01', BASE_TO = '2026-10-26';

const page = async b => { const o = []; for (let p = 0; ; p++) { const { data, error } = await b(p); if (error) throw error; o.push(...data); if (data.length < 1000) return o; } };
const dow = d => new Date(d + 'T12:00:00Z').getUTCDay();
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const median = a => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const [y, mo] = month.split('-').map(Number);
const end = `${month}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;

const { data: loc } = await db.from('locations').select('id,name').eq('name', store).single();

/* Reported sales per date and shift over the base window — the daily sheet's channels. */
const day = {};
const add = (d, sh, v) => { if (d && (sh === 'lunch' || sh === 'dinner') && isFinite(v)) day[`${d}|${sh}`] = (day[`${d}|${sh}`] ?? 0) + v; };
for (const r of await page(p => db.from('shift_reports').select('report_date,shift_type,net_total').eq('location_id', loc.id).gte('report_date', BASE_FROM).lte('report_date', BASE_TO).range(p * 1000, p * 1000 + 999))) add(r.report_date, r.shift_type, Number(r.net_total ?? 0));
for (const r of await page(p => db.from('webshop_orders').select('sale_date,shift,net_cents').eq('location_id', loc.id).eq('counts', true).gte('sale_date', BASE_FROM).lte('sale_date', BASE_TO).range(p * 1000, p * 1000 + 999))) add(r.sale_date, r.shift, r.net_cents / 100);
for (const r of await page(p => db.from('wolt_shift_sales').select('sale_date,shift,net_final').eq('location_id', loc.id).gte('sale_date', BASE_FROM).lte('sale_date', BASE_TO).range(p * 1000, p * 1000 + 999))) add(r.sale_date, r.shift, Number(r.net_final ?? 0));
for (const r of await page(p => db.from('lieferando_shift_sales').select('sale_date,shift,net_final').eq('location_id', loc.id).gte('sale_date', BASE_FROM).lte('sale_date', BASE_TO).range(p * 1000, p * 1000 + 999))) add(r.sale_date, r.shift, Number(r.net_final ?? 0));
const { data: bills } = await db.from('outgoing_bills').select('event_date,shift_type,net_total,invoice_number').eq('issuing_location', loc.name).eq('paid_in_store', false).gte('event_date', BASE_FROM).lte('event_date', BASE_TO);
for (const b of bills ?? []) if (!/^BB/i.test(b.invoice_number ?? '')) add(b.event_date, b.shift_type, Number(b.net_total ?? 0));
const quiet = (sh, w) => median(Object.entries(day).filter(([k, v]) => k.endsWith('|' + sh) && dow(k.slice(0, 10)) === w && v > 0).map(([, v]) => v));

/* The book: every reservation that still counts. */
const { data: book } = await db.from('opentable_bookings').select('visit_date,shift,party_size,guest_name,status,counts')
  .eq('location_id', loc.id).eq('counts', true).gte('visit_date', `${month}-01`).lte('visit_date', end);
const booked = {};
for (const r of book ?? []) {
  const k = `${r.visit_date}|${r.shift}`;
  booked[k] ??= { covers: 0, names: [] };
  booked[k].covers += Number(r.party_size ?? 0);
  if (r.party_size >= 15) booked[k].names.push(`${r.guest_name} (${r.party_size}${/nicht/i.test(r.status ?? '') ? ', unbestätigt' : ''})`);
}

const { data: fc } = await db.from('sales_forecasts').select('id,forecast_date,shift_type,net_total').eq('location_id', loc.id).gte('forecast_date', `${month}-01`).lte('forecast_date', end);
const fcBy = Object.fromEntries((fc ?? []).map(r => [`${r.forecast_date}|${r.shift_type}`, r]));

let before = 0, after = 0;
for (const [k, b] of Object.entries(booked).sort()) {
  const [d, sh] = k.split('|');
  const f = fcBy[k];
  const q = quiet(sh, dow(d));
  const fromBook = q + Math.max(0, b.covers - NORMAL_COVERS) * VALUE_PER_COVER;
  const label = `${WD[dow(d)]} ${d.slice(8)}.${d.slice(5, 7)}. ${sh.padEnd(6)} ${String(b.covers).padStart(3)} Gäste gebucht`;
  if (!f) { console.log(`  ${label} · KEINE Prognose (Schicht laut Öffnungszeiten geschlossen?) ${b.names.join('; ')}`); continue; }
  const cur = Number(f.net_total);
  /* A book no fuller than an ordinary night's says nothing new. */
  const next = b.covers > NORMAL_COVERS ? Math.max(cur, Math.round(fromBook * 100) / 100) : cur;
  before += cur; after += next;
  console.log(`  ${label} · Prognose ${Math.round(cur).toString().padStart(5)} → ${Math.round(next).toString().padStart(5)} €${next > cur ? ' ▲' : ''}  ${b.names.join('; ')}`);
  if (apply && next > cur) {
    const { error } = await db.from('sales_forecasts').update({ net_total: next, source: `forecast ${month} · lifted by OpenTable: ${b.covers} covers booked` }).eq('id', f.id);
    if (error) { console.log(error.message); process.exit(1); }
  }
}
console.log(`\nGebuchte Abende: ${Math.round(before)} € → ${Math.round(after)} € (+${Math.round(after - before)} €)`);
if (!apply) console.log('Probelauf — mit --apply schreiben.');
