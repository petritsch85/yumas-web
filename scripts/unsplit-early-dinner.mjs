/**
 * Undo the lunch/dinner splits that should never have been made.
 *
 * The Orderbird import split a Z-report into lunch and dinner whenever it
 * opened before 15:00 and ran into the evening — the sign of a lunch shift
 * left open. But a dinner shift opened early looks the same, and five were
 * split although lunch had already closed on its own, earlier Z-report that
 * day. The "lunch" half is the first receipts of the evening.
 *
 * Each is put back together: the lunch half's totals, categories and products
 * are added to the dinner half, the lunch half is deleted, and the split note
 * goes. Only Z-reports that were split AND have an earlier Z-report the same
 * day are touched; a genuine split (no other Z that day) is left alone.
 *
 *   node scripts/unsplit-early-dinner.mjs           → zeigt nur
 *   node scripts/unsplit-early-dinner.mjs --apply   → schreibt
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const apply = process.argv.includes('--apply');
const page = async b => { const o = []; for (let p = 0; ; p++) { const { data, error } = await b(p); if (error) throw error; o.push(...data); if (data.length < 1000) return o; } };
const r2 = n => Math.round(n * 100) / 100;

const HEAD = ['gross_total', 'gross_food', 'gross_beverages', 'net_total', 'vat_total', 'tips',
  'inhouse_total', 'takeaway_total', 'cancellations_count', 'cancellations_total'];

const { data: locs } = await db.from('locations').select('id,name');
const nameOf = new Map(locs.map(l => [l.id, l.name]));
const rows = await page(p => db.from('shift_reports').select('*').order('id').range(p * 1000, p * 1000 + 999));

const splitZ = new Map();
for (const r of rows) {
  if (!/^Split from Z/.test(String(r.comment ?? ''))) continue;
  const k = `${r.location_id}|${r.report_date}|${r.z_report_number}`;
  if (!splitZ.has(k)) splitZ.set(k, []);
  splitZ.get(k).push(r);
}

let fixed = 0;
for (const [k, parts] of splitZ) {
  const [loc, date, z] = k.split('|');
  const earlier = rows.some(r => r.location_id === loc && r.report_date === date
    && Number(r.z_report_number) < Number(z));
  if (!earlier) continue;                                   // a genuine split
  const lunch = parts.find(p => p.shift_type === 'lunch');
  const dinner = parts.find(p => p.shift_type === 'dinner');
  if (!lunch || !dinner) { console.log(`  ? ${date} Z${z}: unvollständig, übersprungen`); continue; }

  const head = {};
  for (const f of HEAD) head[f] = r2(Number(dinner[f] ?? 0) + Number(lunch[f] ?? 0));
  console.log(`  ${date} ${String(nameOf.get(loc)).padEnd(9)} Z${z}: Abend ${dinner.net_total} + "Mittag" ${lunch.net_total} → Abend ${head.net_total} netto`);
  if (!apply) continue;

  /* Categories and products: add the lunch half's line to the dinner half's
     line of the same name, or move it over where dinner has none. */
  for (const [table, key, nums] of [
    ['shift_report_categories', r => `${r.category_name}|${r.is_main_category}`, ['quantity', 'total_revenue', 'inhouse_revenue', 'takeaway_revenue']],
    ['shift_report_products', r => r.product_name, ['quantity', 'gross_sales']],
  ]) {
    const { data: L } = await db.from(table).select('*').eq('shift_report_id', lunch.id);
    const { data: D } = await db.from(table).select('*').eq('shift_report_id', dinner.id);
    const byKey = new Map((D ?? []).map(r => [key(r), r]));
    for (const l of L ?? []) {
      const d = byKey.get(key(l));
      if (d) {
        const patch = {};
        for (const n of nums) patch[n] = r2(Number(d[n] ?? 0) + Number(l[n] ?? 0));
        const { error } = await db.from(table).update(patch).eq('id', d.id);
        if (error) throw error;
      } else {
        const { error } = await db.from(table).update({ shift_report_id: dinner.id }).eq('id', l.id);
        if (error) throw error;
      }
    }
    await db.from(table).delete().eq('shift_report_id', lunch.id);
  }

  const { error: upErr } = await db.from('shift_reports').update({ ...head, comment: null }).eq('id', dinner.id);
  if (upErr) throw upErr;
  const { error: delErr } = await db.from('shift_reports').delete().eq('id', lunch.id);
  if (delErr) throw delErr;
  fixed++;
}
console.log(apply ? `\n${fixed} Z-Berichte wieder zusammengeführt.` : '\nProbelauf — mit --apply schreiben.');
