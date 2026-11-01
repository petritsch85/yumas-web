/**
 * Put back together a Z-report split into lunch and dinner on a day one of
 * those shifts does not exist.
 *
 * A lunch left open overnight is split at 16:00 by the takings before then.
 * Taunus does not open on Monday evenings, so its Monday 12.10. — lunch left
 * open until 10:36 the next morning — came out 154 € lunch and 858 € "dinner",
 * every euro of it lunch. Where the opening pattern (or a one-off closure)
 * shuts one side, the halves are merged into the side that was open.
 *
 *   node scripts/unsplit-closed-shift.mjs           → zeigt nur
 *   node scripts/unsplit-closed-shift.mjs --apply   → schreibt
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const apply = process.argv.includes('--apply');
const r2 = n => Math.round(n * 100) / 100;
const HEAD = ['gross_total', 'gross_food', 'gross_beverages', 'net_total', 'vat_total', 'tips', 'inhouse_total', 'takeaway_total', 'cancellations_count', 'cancellations_total'];
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const { data: locs } = await db.from('locations').select('id,name');
const { data: settings } = await db.from('forecast_settings').select('location_id,shift_type,closed_weekdays');
const { data: closures } = await db.from('closure_days').select('location_id,closure_date,shift_type,kind');
const closed = (loc, date, sh) => {
  const c = (closures ?? []).filter(x => x.location_id === loc && x.closure_date === date && (x.shift_type === sh || x.shift_type === 'all'));
  if (c.some(x => x.kind === 'open')) return false;
  if (c.some(x => x.kind !== 'open')) return true;
  return (settings.find(s => s.location_id === loc && s.shift_type === sh)?.closed_weekdays ?? []).includes(DOW[new Date(date + 'T12:00:00Z').getUTCDay()]);
};

const { data: rows } = await db.from('shift_reports').select('*').like('comment', 'Split from Z%');
const byZ = new Map();
for (const r of rows) { const k = `${r.location_id}|${r.report_date}|${r.z_report_number}`; byZ.set(k, [...(byZ.get(k) ?? []), r]); }

let fixed = 0;
for (const [k, parts] of byZ) {
  const [loc, date, z] = k.split('|');
  const lunch = parts.find(p => p.shift_type === 'lunch'), dinner = parts.find(p => p.shift_type === 'dinner');
  if (!lunch || !dinner) continue;
  const keepSide = closed(loc, date, 'dinner') ? 'lunch' : closed(loc, date, 'lunch') ? 'dinner' : null;
  if (!keepSide) continue;
  const keep = keepSide === 'lunch' ? lunch : dinner, drop = keepSide === 'lunch' ? dinner : lunch;
  const head = {};
  for (const f of HEAD) head[f] = r2(Number(keep[f] ?? 0) + Number(drop[f] ?? 0));
  const times = String(keep.comment).match(/\((\d{2}:\d{2})–(\d{2}:\d{2})/);
  const comment = `Z ${z}: ${times ? `${times[1]}–${times[2]}` : ''} (${keepSide === 'lunch' ? 'Abend' : 'Mittag'} an diesem Tag geschlossen — nicht geteilt) · checked`;
  console.log(`  ${locs.find(l => l.id === loc)?.name} ${date} Z${z}: ${lunch.net_total} Mittag + ${dinner.net_total} Abend → alles ${keepSide} ${head.net_total}`);
  if (!apply) continue;
  for (const [table, key, nums] of [
    ['shift_report_categories', r => `${r.category_name}|${r.is_main_category}`, ['quantity', 'total_revenue', 'inhouse_revenue', 'takeaway_revenue']],
    ['shift_report_products', r => r.product_name, ['quantity', 'gross_sales']],
  ]) {
    const { data: D } = await db.from(table).select('*').eq('shift_report_id', drop.id);
    const { data: K } = await db.from(table).select('*').eq('shift_report_id', keep.id);
    const byKey = new Map((K ?? []).map(r => [key(r), r]));
    for (const d of D ?? []) {
      const kk = byKey.get(key(d));
      if (kk) {
        const patch = {}; for (const n of nums) patch[n] = r2(Number(kk[n] ?? 0) + Number(d[n] ?? 0));
        await db.from(table).update(patch).eq('id', kk.id);
      } else {
        await db.from(table).update({ shift_report_id: keep.id }).eq('id', d.id);
      }
    }
    await db.from(table).delete().eq('shift_report_id', drop.id);
  }
  await db.from('shift_reports').update({ ...head, comment }).eq('id', keep.id);
  await db.from('shift_reports').delete().eq('id', drop.id);
  fixed++;
}
console.log(apply ? `\n${fixed} zusammengeführt.` : '\nProbelauf — mit --apply schreiben.');
