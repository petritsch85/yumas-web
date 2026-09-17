'use client';

/**
 * Lieferando — raw weekly statements.
 *
 * Lieferando settles Sunday to Saturday, one PDF a week. This page shows each
 * week exactly as the statement states it — order value, every fee, the payout
 * — before it is cut into days and shifts. The reference to check when a
 * figure in the Sales Report P&L looks wrong.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { MapPin, Loader2, AlertCircle, Receipt } from 'lucide-react';

interface LieferandoPeriod {
  id:              string;
  location_id:     string;
  invoice_number:  string;
  invoice_date:    string;
  period_start:    string;
  period_end:      string;
  restaurant:      string | null;
  order_count:     number;
  order_value_gross: number;
  net_sales_pre_commission: number;
  vat_rate_assumed: number;
  service_fee_rate: number | null;
  service_fee:     number;
  admin_fee:       number;
  top_rank:        number;
  other_fees:      number;
  refunds:         number;
  commission:      number;
  net_sales_pre_ads: number;
  advertising:     number;
  net_sales_final: number;
  fees_net:        number;
  fees_vat:        number;
  invoice_gross:   number;
  tips:            number;
  payout:          number | null;
  check_ok:        boolean;
}

interface LieferandoShiftSale {
  id:          string;
  sale_date:   string;
  shift:       'lunch' | 'dinner';
  orders:      number;
  gross:       number;
  net_sales:   number;
  refund_est:  number;
  commission:  number;
  net_pre_ads: number;
  advertising_est: number;
  net_final:   number;
}

interface LieferandoOrderRow {
  id:           string;
  order_number: string;
  ordered_at:   string;
  sale_date:    string;
  shift:        'lunch' | 'dinner';
  gross:        number;
  tip:          number;
}

const fmt = (n: number) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const de  = (iso: string) => iso.split('-').reverse().join('.');
const pct = (n: number) => `${(n * 100).toFixed(1).replace('.', ',')}%`;

export default function LieferandoPage() {
  const [locationId, setLocationId] = useState<string>('');

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-lieferando'],
    queryFn: async () => {
      const { data } = await supabase
        .from('locations').select('id, name, type').eq('is_active', true).order('name');
      return ((data ?? []) as { id: string; name: string; type: string }[])
        .filter(l => l.type === 'restaurant')
        .map(({ id, name }) => ({ id, name }));
    },
  });

  const { data: periods = [], isLoading, error } = useQuery({
    queryKey: ['lieferando-periods', locationId],
    queryFn: async () => {
      let q = supabase.from('lieferando_periods').select('*').order('period_start', { ascending: false });
      if (locationId) q = q.eq('location_id', locationId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as LieferandoPeriod[];
    },
  });

  const { data: shifts = [] } = useQuery({
    queryKey: ['lieferando-shift-sales', locationId],
    queryFn: async () => {
      let q = supabase.from('lieferando_shift_sales').select('*')
        .order('sale_date', { ascending: false }).order('shift');
      if (locationId) q = q.eq('location_id', locationId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as LieferandoShiftSale[];
    },
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['lieferando-orders', locationId],
    queryFn: async () => {
      let q = supabase.from('lieferando_orders')
        .select('id,order_number,ordered_at,sale_date,shift,gross,tip')
        .order('ordered_at', { ascending: false }).limit(1000);
      if (locationId) q = q.eq('location_id', locationId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as LieferandoOrderRow[];
    },
  });

  const days = useMemo(() => {
    const byDate = new Map<string, { date: string; lunch?: LieferandoShiftSale; dinner?: LieferandoShiftSale }>();
    for (const s of shifts) {
      const d = byDate.get(s.sale_date) ?? { date: s.sale_date };
      if (s.shift === 'lunch') d.lunch = s; else d.dinner = s;
      byDate.set(s.sale_date, d);
    }
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [shifts]);

  const totals = useMemo(() => periods.reduce(
    (acc, p) => ({
      orders: acc.orders + Number(p.order_count),
      gross:  acc.gross  + Number(p.order_value_gross),
      pre:    acc.pre    + Number(p.net_sales_pre_commission),
      ref:    acc.ref    + Number(p.refunds),
      com:    acc.com    + Number(p.commission),
      post:   acc.post   + Number(p.net_sales_pre_ads),
      ads:    acc.ads    + Number(p.advertising),
      fin:    acc.fin    + Number(p.net_sales_final),
      tips:   acc.tips   + Number(p.tips),
      inv:    acc.inv    + Number(p.invoice_gross),
      payout: acc.payout + Number(p.payout ?? 0),
    }),
    { orders: 0, gross: 0, pre: 0, ref: 0, com: 0, post: 0, ads: 0, fin: 0, tips: 0, inv: 0, payout: 0 },
  ), [periods]);

  const failing = periods.filter(p => !p.check_ok).length;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900">Lieferando</h1>
      <p className="text-sm text-gray-500 mb-5">
        Raw weekly statements, exactly as Lieferando invoices them
      </p>

      <div className="flex items-center gap-1.5 mb-4">
        <MapPin size={13} className="text-gray-400" />
        <select
          value={locationId}
          onChange={e => setLocationId(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 cursor-pointer"
        >
          <option value="">All locations</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      {failing > 0 && (
        <div className="flex items-start gap-2 p-3 mb-4 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertCircle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            {failing} week{failing === 1 ? '' : 's'} where order value plus tips less the invoice does
            not match the payout. Check those before using the figures.
          </p>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-2.5 text-left">Week</th>
                <th className="px-3 py-2.5 text-left">Invoice</th>
                <th className="px-2.5 py-2.5 text-right">Orders</th>
                <th className="px-2.5 py-2.5 text-right">
                  Order value
                  <span className="block font-normal normal-case tracking-normal text-[10px] text-gray-400">gross</span>
                </th>
                <th className="px-2.5 py-2.5 text-right">Net sales · pre com, Ads</th>
                <th className="px-2.5 py-2.5 text-right">
                  Service fee
                  <span className="block font-normal normal-case tracking-normal text-[10px] text-gray-400">14%</span>
                </th>
                <th className="px-2.5 py-2.5 text-right">
                  Admin fee
                  <span className="block font-normal normal-case tracking-normal text-[10px] text-gray-400">per order</span>
                </th>
                <th className="px-2.5 py-2.5 text-right">Commission</th>
                <th className="px-2.5 py-2.5 text-right">Net sales · pre Ads</th>
                <th className="px-2.5 py-2.5 text-right">
                  Advertising
                  <span className="block font-normal normal-case tracking-normal text-[10px] text-gray-400">TopRank</span>
                </th>
                <th className="px-2.5 py-2.5 text-right">Net sales</th>
                <th className="px-2.5 py-2.5 text-right">
                  Invoice
                  <span className="block font-normal normal-case tracking-normal text-[10px] text-gray-400">incl. 19% VAT</span>
                </th>
                <th className="px-2.5 py-2.5 text-right">Tips</th>
                <th className="px-2 py-2.5 text-center">Check</th>
                <th className="px-4 py-2.5 text-right">
                  Paid out
                  <span className="block font-normal normal-case tracking-normal text-[10px] text-gray-400">to the bank</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={15} className="px-4 py-10 text-center text-gray-400">
                  <Loader2 size={20} className="mx-auto animate-spin" />
                </td></tr>
              )}
              {error && !isLoading && (
                <tr><td colSpan={15} className="px-4 py-10 text-center text-sm text-red-600">
                  {(error as Error).message}
                </td></tr>
              )}
              {!isLoading && !error && periods.length === 0 && (
                <tr><td colSpan={15} className="px-4 py-12 text-center text-sm text-gray-400">
                  <Receipt size={28} className="mx-auto mb-2 text-gray-200" />
                  No Lieferando weeks yet — upload a statement from Sales Reports → Upload → Lieferando
                </td></tr>
              )}
              {periods.map(p => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-4 py-2.5 whitespace-nowrap font-semibold text-gray-800">
                    {de(p.period_start)} – {de(p.period_end)}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] leading-tight text-gray-400">
                    {p.invoice_number}
                    <span className="block text-gray-300">{de(p.invoice_date)}</span>
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-500">{p.order_count}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-400">{fmt(Number(p.order_value_gross))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums font-semibold text-gray-900">
                    {fmt(Number(p.net_sales_pre_commission) - Number(p.refunds))}
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-500">−{fmt(Number(p.service_fee))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-500">−{fmt(Number(p.admin_fee))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-600">−{fmt(Number(p.commission))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-700">{fmt(Number(p.net_sales_pre_ads))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-600">−{fmt(Number(p.advertising))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums font-bold text-gray-900">{fmt(Number(p.net_sales_final))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-400">{fmt(Number(p.invoice_gross))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-400">{Number(p.tips) > 0 ? fmt(Number(p.tips)) : '—'}</td>
                  <td className="px-2 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${p.check_ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {p.check_ok ? '✓' : '✗'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-blue-700">
                    {p.payout != null ? fmt(Number(p.payout)) : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            {periods.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-bold text-gray-900 border-t border-gray-200">
                  <td className="px-4 py-2.5" colSpan={2}>{periods.length} week{periods.length === 1 ? '' : 's'}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{totals.orders}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-500">{fmt(totals.gross)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmt(totals.pre - totals.ref)}</td>
                  <td colSpan={2} />
                  <td className="px-2.5 py-2.5 text-right tabular-nums">−{fmt(totals.com)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmt(totals.post)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">−{fmt(totals.ads)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmt(totals.fin)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-500">{fmt(totals.inv)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-500">{fmt(totals.tips)}</td>
                  <td />
                  <td className="px-4 py-2.5 text-right tabular-nums text-blue-700">{fmt(totals.payout)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Order value is what customers paid, including VAT. Lieferando states no VAT split, so net sales
        take the whole order value at <strong>7%</strong> — the rate on delivered food, and the rate Wolt
        reports on Eschborn&apos;s orders. Fees are net; Lieferando adds 19% VAT on the invoice, which we
        reclaim. Commission is the service fee plus the per-order admin fee; TopRank is paid ranking, so it
        counts as advertising. The payout is order value plus tips less the invoice, which is the check.
        {periods.length > 0 && totals.pre > 0 && (
          <> Over these weeks commission ran at <strong>{pct(totals.com / totals.pre)}</strong> of net sales
          and advertising at <strong>{pct(totals.ads / totals.pre)}</strong>.</>
        )}
      </p>

      {/* ── Day & shift breakdown ── */}
      <h2 className="mt-8 text-lg font-bold text-gray-900">By day &amp; shift</h2>
      <p className="text-sm text-gray-500 mb-4">
        Cut from the order times on the statement · lunch to 14:30, everything after counts as dinner
      </p>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-2.5 text-left">Day</th>
                <th className="px-3 py-2.5 text-left">Shift</th>
                <th className="px-2.5 py-2.5 text-right">Orders</th>
                <th className="px-2.5 py-2.5 text-right">Net sales · pre refunds</th>
                <th className="px-2.5 py-2.5 text-right">Refunds</th>
                <th className="px-2.5 py-2.5 text-right">Net sales · pre com, Ads</th>
                <th className="px-2.5 py-2.5 text-right">Commission</th>
                <th className="px-2.5 py-2.5 text-right">Net · pre Ads</th>
                <th className="px-2.5 py-2.5 text-right">Advertising</th>
                <th className="px-2.5 py-2.5 text-right">Net sales</th>
              </tr>
            </thead>
            <tbody>
              {days.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-gray-400">
                  No daily breakdown yet
                </td></tr>
              )}
              {days.map(d => (
                ([d.lunch, d.dinner].filter(Boolean) as LieferandoShiftSale[]).map((r, i) => (
                  <tr key={r.id} className={`hover:bg-gray-50/60 ${i === 1 ? 'border-b border-gray-100' : 'border-b border-gray-50'}`}>
                    <td className="px-4 py-2 whitespace-nowrap font-semibold text-gray-800">{i === 0 ? de(d.date) : ''}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.shift === 'lunch' ? '☀️ Lunch' : '🌙 Dinner'}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-gray-400">{r.orders}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-gray-700">{fmt(Number(r.net_sales))}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-gray-400">{fmt(Number(r.refund_est))}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-gray-700">{fmt(Number(r.net_sales) + Number(r.refund_est))}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-gray-600">−{fmt(Number(r.commission))}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-gray-700">{fmt(Number(r.net_pre_ads))}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-gray-400">−{fmt(Number(r.advertising_est))}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums font-bold text-gray-900">{fmt(Number(r.net_final))}</td>
                  </tr>
                ))
              ))}
            </tbody>
            {shifts.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-bold text-gray-900 border-t border-gray-200">
                  <td className="px-4 py-2.5" colSpan={2}>{days.length} day{days.length === 1 ? '' : 's'}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{shifts.reduce((s, r) => s + r.orders, 0)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmt(shifts.reduce((s, r) => s + Number(r.net_sales), 0))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmt(shifts.reduce((s, r) => s + Number(r.refund_est), 0))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmt(shifts.reduce((s, r) => s + Number(r.net_sales) + Number(r.refund_est), 0))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">−{fmt(shifts.reduce((s, r) => s + Number(r.commission), 0))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmt(shifts.reduce((s, r) => s + Number(r.net_pre_ads), 0))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">−{fmt(shifts.reduce((s, r) => s + Number(r.advertising_est), 0))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmt(shifts.reduce((s, r) => s + Number(r.net_final), 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Commission is allocated to each order from the 14% rate and the fixed admin fee; TopRank is a
        flat amount per order. Both are then tied to the statement totals to the cent.
      </p>

      {/* ── Orders ── */}
      <h2 className="mt-8 text-lg font-bold text-gray-900">Orders</h2>
      <p className="text-sm text-gray-500 mb-3">Every order on the statements, newest first</p>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-2.5 text-left">Ordered</th>
              <th className="px-2.5 py-2.5 text-left">Order #</th>
              <th className="px-2.5 py-2.5 text-left">Shift</th>
              <th className="px-2.5 py-2.5 text-right">Gross €</th>
              <th className="px-4 py-2.5 text-right">Tip €</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">No orders yet</td></tr>
            )}
            {orders.map(o => (
              <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                <td className="px-4 py-2 whitespace-nowrap text-gray-700">
                  {de(o.sale_date)} {o.ordered_at.slice(11, 16)}
                </td>
                <td className="px-2.5 py-2 font-mono text-xs text-gray-500">{o.order_number}</td>
                <td className="px-2.5 py-2 text-gray-500">{o.shift === 'lunch' ? '☀️ Lunch' : '🌙 Dinner'}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-gray-800">{fmt(Number(o.gross))}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-400">{Number(o.tip) > 0 ? fmt(Number(o.tip)) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mb-8" />
    </div>
  );
}
