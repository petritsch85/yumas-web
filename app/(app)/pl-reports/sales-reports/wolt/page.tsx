'use client';

/**
 * Wolt — raw five-day periods.
 *
 * Wolt settles in five-day blocks that line up with no calendar week or month,
 * so this page shows each period exactly as the invoice states it, before any
 * slicing into days or shifts. It is the reference you check when a figure in
 * the Sales Report P&L looks wrong.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { MapPin, Loader2, AlertCircle, Receipt } from 'lucide-react';

interface WoltPeriod {
  id:                       string;
  location_id:              string;
  invoice_number:           string;
  invoice_date:             string;
  period_start:             string;
  period_end:               string;
  restaurant:               string | null;
  net_sales_pre_commission: number;
  commission:               number;
  net_sales_pre_ads:        number;
  reported_endbetrag:       number;
  advertising:              number;
  ad_campaign:              number | null;
  net_sales_final:          number;
  contract:                 'self_billing' | 'self_delivery' | null;
  check_ok:                 boolean;
  source_files:             { name: string; kind: string }[] | null;
}

interface WoltShiftSale {
  id:          string;
  period_id:   string;
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

const fmt = (n: number) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2026-08-21" → "21.08.2026" */
const de = (iso: string) => iso.split('-').reverse().join('.');

export default function WoltPage() {
  const [locationId, setLocationId] = useState<string>('');

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-wolt'],
    queryFn: async () => {
      const { data } = await supabase
        .from('locations').select('id, name, type').eq('is_active', true).order('name');
      return ((data ?? []) as { id: string; name: string; type: string }[])
        .filter(l => l.type === 'restaurant')
        .map(({ id, name }) => ({ id, name }));
    },
  });

  const { data: periods = [], isLoading, error } = useQuery({
    queryKey: ['wolt-periods', locationId],
    queryFn: async () => {
      let q = supabase.from('wolt_periods').select('*').order('period_start', { ascending: false });
      if (locationId) q = q.eq('location_id', locationId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as WoltPeriod[];
    },
  });

  const { data: shifts = [] } = useQuery({
    queryKey: ['wolt-shift-sales', locationId],
    queryFn: async () => {
      let q = supabase.from('wolt_shift_sales').select('*')
        .order('sale_date', { ascending: false }).order('shift');
      if (locationId) q = q.eq('location_id', locationId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as WoltShiftSale[];
    },
  });

  /** Day rows with their two shifts, newest first. */
  const days = useMemo(() => {
    const byDate = new Map<string, { date: string; lunch?: WoltShiftSale; dinner?: WoltShiftSale }>();
    for (const s of shifts) {
      const d = byDate.get(s.sale_date) ?? { date: s.sale_date };
      if (s.shift === 'lunch') d.lunch = s; else d.dinner = s;
      byDate.set(s.sale_date, d);
    }
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [shifts]);

  const totals = useMemo(() => periods.reduce(
    (acc, p) => ({
      pre:  acc.pre  + Number(p.net_sales_pre_commission),
      com:  acc.com  + Number(p.commission),
      post: acc.post + Number(p.net_sales_pre_ads),
      ads:  acc.ads  + Number(p.advertising ?? 0),
      fin:  acc.fin  + Number(p.net_sales_final ?? 0),
    }),
    { pre: 0, com: 0, post: 0, ads: 0, fin: 0 },
  ), [periods]);

  const failing = periods.filter(p => !p.check_ok).length;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900">Wolt</h1>
      <p className="text-sm text-gray-500 mb-5">
        Raw five-day settlement periods, exactly as Wolt invoices them
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
            {failing} period{failing === 1 ? '' : 's'} where our net sales minus commission does not
            match the invoice&apos;s own Endbetrag. Check those before using the figures.
          </p>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-2.5 text-left">Period</th>
                <th className="px-4 py-2.5 text-left">Invoice</th>
                <th className="px-2.5 py-2.5 text-right">Net sales · pre com, Ads</th>
                <th className="px-2.5 py-2.5 text-right">Commission</th>
                <th className="px-2.5 py-2.5 text-right">Net sales · pre Ads</th>
                <th className="px-2.5 py-2.5 text-right">
                  Wolt&apos;s own
                  <span className="block font-normal normal-case tracking-normal text-[10px] text-gray-400">
                    Endbetrag, or payout
                  </span>
                </th>
                <th className="px-2 py-2.5 text-center">Check</th>
                <th className="px-2.5 py-2.5 text-right">Advertising</th>
                <th className="px-2.5 py-2.5 text-right">Net sales</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">
                  <Loader2 size={20} className="mx-auto animate-spin" />
                </td></tr>
              )}
              {error && !isLoading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-red-600">
                  {(error as Error).message}
                </td></tr>
              )}
              {!isLoading && !error && periods.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">
                  <Receipt size={28} className="mx-auto mb-2 text-gray-200" />
                  No Wolt periods yet — upload a document set from Sales Reports → Upload → Wolt Report
                </td></tr>
              )}
              {periods.map(p => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-4 py-2.5 whitespace-nowrap font-semibold text-gray-800">
                    {de(p.period_start)} – {de(p.period_end)}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] leading-tight text-gray-400 break-all">
                    {p.invoice_number}
                    {p.restaurant && <span className="block text-gray-300 break-normal">{p.restaurant}</span>}
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums font-semibold text-gray-900">{fmt(Number(p.net_sales_pre_commission))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-600">−{fmt(Number(p.commission))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-700">{fmt(Number(p.net_sales_pre_ads))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-400">
                    {fmt(Number(p.reported_endbetrag))}
                    {p.contract === 'self_delivery' && (
                      <span className="block text-[10px] text-gray-300">Zahlungsbetrag</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                      p.check_ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {p.check_ok ? '✓' : '✗'}
                    </span>
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-600">−{fmt(Number(p.advertising ?? 0))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums font-bold text-gray-900">{fmt(Number(p.net_sales_final ?? 0))}</td>
                </tr>
              ))}
            </tbody>
            {periods.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-bold text-gray-900 border-t border-gray-200">
                  <td className="px-4 py-2.5" colSpan={2}>
                    {periods.length} period{periods.length === 1 ? '' : 's'}
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmt(totals.pre)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">−{fmt(totals.com)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmt(totals.post)}</td>
                  <td colSpan={2} />
                  <td className="px-2.5 py-2.5 text-right tabular-nums">−{fmt(totals.ads)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmt(totals.fin)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Figures are net of VAT, taken from the Wolt self-billing invoice: subtotal (A) for net sales,
        subtotal (B) for commission. The Endbetrag is that invoice&apos;s own A − B, so the check
        confirms <strong>Net sales · pre Ads</strong>. Advertising comes on a separate Wolt invoice
        and is netted off afterwards, which is why it sits outside the check.
        Eschborn is on Wolt&apos;s self-delivery contract and has no self-billing invoice at all:
        there, net sales are the goods sold plus the delivery income you earn for delivering
        yourselves, commission is Wolt&apos;s whole fee invoice, and the check is the
        <strong> Zahlungsbetrag</strong> Wolt actually paid out.
      </p>

      {/* ── Day & shift breakdown ── */}
      <h2 className="mt-8 text-lg font-bold text-gray-900">By day &amp; shift</h2>
      <p className="text-sm text-gray-500 mb-4">
        Cut from the order times in the sales report · lunch to 14:30, everything after counts as dinner
      </p>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-2.5 text-left">Day</th>
                <th className="px-3 py-2.5 text-left">Shift</th>
                <th className="px-2.5 py-2.5 text-right">Orders</th>
                <th className="px-2.5 py-2.5 text-right">Net sales</th>
                <th className="px-2.5 py-2.5 text-right">Refunds (est.)</th>
                <th className="px-2.5 py-2.5 text-right">Commission</th>
                <th className="px-2.5 py-2.5 text-right">Net · pre Ads</th>
                <th className="px-2.5 py-2.5 text-right">Advertising (est.)</th>
                <th className="px-2.5 py-2.5 text-right">Net sales</th>
              </tr>
            </thead>
            <tbody>
              {days.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">
                  No daily breakdown yet — upload a set that includes the sales report (Umsatzbericht)
                </td></tr>
              )}
              {days.map(d => (
                ([d.lunch, d.dinner].filter(Boolean) as WoltShiftSale[]).map((r, i) => (
                  <tr key={r.id} className={`hover:bg-gray-50/60 ${i === 1 ? 'border-b border-gray-100' : 'border-b border-gray-50'}`}>
                    <td className="px-4 py-2 whitespace-nowrap font-semibold text-gray-800">
                      {i === 0 ? de(d.date) : ''}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                      {r.shift === 'lunch' ? '☀️ Lunch' : '🌙 Dinner'}
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-gray-400">{r.orders}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-gray-700">{fmt(Number(r.net_sales))}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-gray-400">{fmt(Number(r.refund_est))}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-gray-600">−{fmt(Number(r.commission))}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-gray-700">{fmt(Number(r.net_pre_ads))}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-gray-400">−{fmt(Number(r.advertising_est ?? 0))}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums font-bold text-gray-900">{fmt(Number(r.net_final ?? 0))}</td>
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
                  <td className="px-2.5 py-2.5 text-right tabular-nums">−{fmt(shifts.reduce((s, r) => s + Number(r.commission), 0))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmt(shifts.reduce((s, r) => s + Number(r.net_pre_ads), 0))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">−{fmt(shifts.reduce((s, r) => s + Number(r.advertising_est ?? 0), 0))}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{fmt(shifts.reduce((s, r) => s + Number(r.net_final ?? 0), 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="mt-3 mb-8 text-xs text-gray-400">
        Orders placed in the afternoon are evening pre-orders, so anything after 14:30 counts as dinner.
        Commission is charged per order on the gross value — 27% on Wolt+ orders, 24% otherwise —
        then reconciled to subtotal (B). Refunds are marked <strong>(est.)</strong> because Wolt reports
        them only per period: the total is exact, the split across shifts is pro-rata on net sales.
        Advertising is Wolt&apos;s &quot;Dienstleistungen und Produkte&quot; charge from the netting report,
        split the same way — so it carries the same estimate caveat, and it can include fees that are
        not advertising.
      </p>
    </div>
  );
}
