import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reported net sales per restaurant and day — the daily sheet's "Total net
 * sales", without any forecast: the till, the webshop, Wolt (with its monthly
 * credit spread over the month's sales), Lieferando, event invoices not
 * settled at the till, and Too Good To Go.
 *
 * Read fresh every time, because the channels arrive late — Wolt's figures
 * five days after the shift — and a day's actual keeps moving until they have.
 *
 * Keyed `${locationId}|${date}`.
 */
export async function dailySalesActuals(
  db: SupabaseClient, locations: { id: string; name: string }[], from: string, to: string,
): Promise<Record<string, number>> {
  const ids = locations.map(l => l.id);
  const out: Record<string, number> = {};
  const add = (loc: string | null | undefined, date: string | null | undefined, v: number) => {
    if (!loc || !date || !Number.isFinite(v) || v === 0) return;
    const k = `${loc}|${String(date).slice(0, 10)}`;
    out[k] = (out[k] ?? 0) + v;
  };
  const all = async <T,>(table: string, cols: string, dateCol: string, extra?: (q: any) => any): Promise<T[]> => {
    const rows: T[] = [];
    for (let p = 0; ; p++) {
      let q = db.from(table).select(cols).in('location_id', ids).gte(dateCol, from).lte(dateCol, to);
      if (extra) q = extra(q);
      const { data, error } = await q.order(dateCol).range(p * 1000, p * 1000 + 999);
      if (error || !data?.length) break;
      rows.push(...(data as T[]));
      if (data.length < 1000) break;
    }
    return rows;
  };

  type R = Record<string, any>;
  const [shifts, webshop, wolt, lieferando, tgtg] = await Promise.all([
    all<R>('shift_reports', 'location_id,report_date,net_total', 'report_date'),
    all<R>('webshop_orders', 'location_id,sale_date,net_cents', 'sale_date', q => q.eq('counts', true)),
    all<R>('wolt_shift_sales', 'location_id,sale_date,net_sales,net_final', 'sale_date'),
    all<R>('lieferando_shift_sales', 'location_id,sale_date,net_final', 'sale_date'),
    all<R>('tgtg_sales', 'location_id,sale_date,net', 'sale_date'),
  ]);
  for (const r of shifts) add(r.location_id, r.report_date, Number(r.net_total ?? 0));
  for (const r of webshop) add(r.location_id, r.sale_date, Number(r.net_cents ?? 0) / 100);
  for (const r of wolt) add(r.location_id, r.sale_date, Number(r.net_final ?? 0));
  for (const r of lieferando) add(r.location_id, r.sale_date, Number(r.net_final ?? 0));
  for (const r of tgtg) add(r.location_id, r.sale_date, Number(r.net ?? 0));

  /* Wolt+ credit: a month's income, shared over that month's Wolt sales. */
  const { data: credits } = await db.from('wolt_month_credits').select('location_id,month,net').in('location_id', ids)
    .gte('month', `${from.slice(0, 7)}-01`).lte('month', `${to.slice(0, 7)}-01`);
  for (const c of credits ?? []) {
    const mk = String(c.month).slice(0, 7);
    const rows = wolt.filter(r => r.location_id === c.location_id && String(r.sale_date).startsWith(mk));
    const base = rows.reduce((t, r) => t + Number(r.net_sales ?? 0), 0);
    if (base > 0) for (const r of rows) add(r.location_id, r.sale_date, Number(c.net) * Number(r.net_sales ?? 0) / base);
  }

  /* Event invoices, filed under the restaurant's name. */
  const idByName = new Map(locations.map(l => [l.name.toLowerCase(), l.id]));
  const { data: bills } = await db.from('outgoing_bills').select('issuing_location,event_date,net_total,invoice_number')
    .in('issuing_location', locations.map(l => l.name)).eq('paid_in_store', false).gte('event_date', from).lte('event_date', to);
  for (const b of bills ?? []) {
    if (/^BB/i.test(String(b.invoice_number ?? ''))) continue;
    add(idByName.get(String(b.issuing_location).toLowerCase()), b.event_date, Number(b.net_total ?? 0));
  }
  return out;
}
