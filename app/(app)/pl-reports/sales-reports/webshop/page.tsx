'use client';

/**
 * Webshop — raw orders from our own shop.
 *
 * Take-away at every restaurant, delivery at Eschborn. This page shows the
 * orders as exported, before anything is rolled into the P&L, so a figure in
 * the Sales Report can always be traced back to the orders behind it.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { MapPin, Loader2, ShoppingBag, Bike, Package } from 'lucide-react';

interface WebshopOrderRow {
  id:             string;
  location_id:    string;
  order_number:   string;
  venue:          string | null;
  sale_date:      string;
  shift:          'lunch' | 'dinner';
  fulfilled_at:   string | null;
  order_type:     'pickup' | 'delivery';
  status:         string | null;
  payment_status: string | null;
  counts:         boolean;
  items:          string | null;
  net_cents:      number;
  gross_cents:    number;
  tip_cents:      number;
}

const eur = (cents: number) =>
  (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2026-08-21" → "21.08.2026" */
const de = (iso: string) => iso.split('-').reverse().join('.');

/** "2026-08-21T19:56:00" → "19:56" */
const hhmm = (ts: string | null) => (ts ? ts.slice(11, 16) : '—');

const PAGE = 200;

export default function WebshopPage() {
  const [locationId, setLocationId] = useState('');
  const [showSkipped, setShowSkipped] = useState(false);
  const [page, setPage] = useState(0);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-webshop'],
    queryFn: async () => {
      const { data } = await supabase
        .from('locations').select('id, name, type').eq('is_active', true).order('name');
      return ((data ?? []) as { id: string; name: string; type: string }[])
        .filter(l => l.type === 'restaurant')
        .map(({ id, name }) => ({ id, name }));
    },
  });

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['webshop-orders', locationId],
    queryFn: async () => {
      // PostgREST caps a response at 1000 rows, and the shop will pass that.
      const all: WebshopOrderRow[] = [];
      for (let p = 0; ; p++) {
        let q = supabase.from('webshop_orders').select('*')
          .order('fulfilled_at', { ascending: false })
          .range(p * 1000, (p + 1) * 1000 - 1);
        if (locationId) q = q.eq('location_id', locationId);
        const { data, error } = await q;
        if (error) throw error;
        if (!data?.length) break;
        all.push(...(data as WebshopOrderRow[]));
        if (data.length < 1000) break;
      }
      return all;
    },
  });

  const locationName = useMemo(() => {
    const m = new Map(locations.map(l => [l.id, l.name]));
    return (id: string) => m.get(id) ?? '—';
  }, [locations]);

  const visible = useMemo(
    () => (showSkipped ? orders : orders.filter(o => o.counts)),
    [orders, showSkipped],
  );
  const pageRows = visible.slice(page * PAGE, (page + 1) * PAGE);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE));

  /** Net sales per location per shift — what the P&L reads. */
  const byLocation = useMemo(() => {
    const m = new Map<string, { lunch: { n: number; net: number }; dinner: { n: number; net: number } }>();
    for (const o of orders) {
      if (!o.counts) continue;
      const cur = m.get(o.location_id) ?? { lunch: { n: 0, net: 0 }, dinner: { n: 0, net: 0 } };
      cur[o.shift].n   += 1;
      cur[o.shift].net += o.net_cents;
      m.set(o.location_id, cur);
    }
    return [...m.entries()].sort((a, b) => locationName(a[0]).localeCompare(locationName(b[0])));
  }, [orders, locationName]);

  const counted = orders.filter(o => o.counts);
  /** The span the figures cover, so the totals are not mistaken for a period. */
  const dateRange = useMemo(() => {
    if (counted.length === 0) return null;
    const dates = counted.map(o => o.sale_date).sort();
    return `${de(dates[0])} – ${de(dates[dates.length - 1])}`;
  }, [counted]);
  const skipped = orders.length - counted.length;
  const netTotal = counted.reduce((s, o) => s + o.net_cents, 0);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900">Webshop</h1>
      <p className="text-sm text-gray-500 mb-5">
        Orders from our own shop — take-away everywhere, delivery at Eschborn
      </p>

      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-1.5">
          <MapPin size={13} className="text-gray-400" />
          <select
            value={locationId}
            onChange={e => { setLocationId(e.target.value); setPage(0); }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 cursor-pointer"
          >
            <option value="">All locations</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showSkipped}
            onChange={e => { setShowSkipped(e.target.checked); setPage(0); }}
            className="w-3.5 h-3.5 accent-[#1B5E20]" />
          Show unpaid / unfinished orders ({skipped})
        </label>
      </div>

      {/* ── Net sales per location and shift ── */}
      <h2 className="text-lg font-bold text-gray-900 mb-1">Net sales by location &amp; shift</h2>
      <p className="text-sm text-gray-500 mb-3">
        Every order imported{dateRange && ` · ${dateRange}`} · paid and completed only · tips excluded
      </p>
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs font-bold text-gray-500 uppercase tracking-wider">
              <th className="px-4 pt-2.5 pb-1 text-left" rowSpan={2}>Location</th>
              <th className="px-2.5 pt-2.5 pb-1 text-center border-l border-gray-200" colSpan={2}>☀️ Lunch</th>
              <th className="px-2.5 pt-2.5 pb-1 text-center border-l border-gray-200" colSpan={2}>🌙 Dinner</th>
              <th className="px-2.5 pt-2.5 pb-1 text-center border-l border-gray-200" colSpan={2}>Both shifts</th>
            </tr>
            <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              <th className="px-2.5 pb-2 text-right border-l border-gray-200">Orders</th>
              <th className="px-2.5 pb-2 text-right">Net sales €</th>
              <th className="px-2.5 pb-2 text-right border-l border-gray-200">Orders</th>
              <th className="px-2.5 pb-2 text-right">Net sales €</th>
              <th className="px-2.5 pb-2 text-right border-l border-gray-200">Orders</th>
              <th className="px-4   pb-2 text-right">Net sales €</th>
            </tr>
          </thead>
          <tbody>
            {byLocation.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">
                <ShoppingBag size={26} className="mx-auto mb-2 text-gray-200" />
                No webshop orders yet — import the export from Sales Reports → Upload → Webshop
              </td></tr>
            )}
            {byLocation.map(([id, v]) => (
              <tr key={id} className="border-b border-gray-50 hover:bg-gray-50/60">
                <td className="px-4 py-2.5 font-semibold text-gray-800">{locationName(id)}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-400 border-l border-gray-100">{v.lunch.n || '—'}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-700">{eur(v.lunch.net)}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-400 border-l border-gray-100">{v.dinner.n || '—'}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-700">{eur(v.dinner.net)}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums text-gray-500 border-l border-gray-100">{v.lunch.n + v.dinner.n}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-bold text-gray-900">{eur(v.lunch.net + v.dinner.net)}</td>
              </tr>
            ))}
          </tbody>
          {byLocation.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 font-bold text-gray-900 border-t border-gray-200">
                <td className="px-4 py-2.5">All locations</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums border-l border-gray-200">{byLocation.reduce((s, [, v]) => s + v.lunch.n, 0)}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums">{eur(byLocation.reduce((s, [, v]) => s + v.lunch.net, 0))}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums border-l border-gray-200">{byLocation.reduce((s, [, v]) => s + v.dinner.n, 0)}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums">{eur(byLocation.reduce((s, [, v]) => s + v.dinner.net, 0))}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums border-l border-gray-200">{counted.length}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{eur(netTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── The orders themselves ── */}
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Orders</h2>
          <p className="text-sm text-gray-500">{visible.length} shown</p>
        </div>
        {pageCount > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40">Previous</button>
            <span className="text-gray-500">Page {page + 1} of {pageCount}</span>
            <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}
              className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40">Next</button>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-2.5 text-left">Ordered for</th>
              <th className="px-2.5 py-2.5 text-left">Location</th>
              <th className="px-2.5 py-2.5 text-left">Type</th>
              <th className="px-2.5 py-2.5 text-left">Items</th>
              <th className="px-2.5 py-2.5 text-right">Netto</th>
              <th className="px-4 py-2.5 text-right">Brutto</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                <Loader2 size={20} className="mx-auto animate-spin" />
              </td></tr>
            )}
            {!isLoading && pageRows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">No orders</td></tr>
            )}
            {pageRows.map(o => (
              <tr key={o.id} className={`border-b border-gray-50 hover:bg-gray-50/60 ${o.counts ? '' : 'bg-amber-50/40'}`}>
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className="font-semibold text-gray-800">{de(o.sale_date)}</span>
                  <span className="text-gray-400"> {hhmm(o.fulfilled_at)}</span>
                  <span className="ml-1.5">{o.shift === 'lunch' ? '☀️' : '🌙'}</span>
                  {!o.counts && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">
                      {o.payment_status === 'unpaid' ? 'unpaid' : o.status}
                    </span>
                  )}
                  <span className="block text-[10px] text-gray-300">{o.order_number}</span>
                </td>
                <td className="px-2.5 py-2 whitespace-nowrap text-gray-600">{locationName(o.location_id)}</td>
                <td className="px-2.5 py-2 whitespace-nowrap text-gray-500">
                  {o.order_type === 'delivery'
                    ? <span className="inline-flex items-center gap-1"><Bike size={12} /> Lieferung</span>
                    : <span className="inline-flex items-center gap-1"><Package size={12} /> Abholung</span>}
                </td>
                <td className="px-2.5 py-2 text-gray-600 text-[11px] leading-tight">{o.items}</td>
                <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-gray-900">{eur(o.net_cents)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                  {eur(o.gross_cents)}
                  {o.tip_cents > 0 && (
                    <span className="block text-[10px] text-gray-300">inkl. {eur(o.tip_cents)} Trinkgeld</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 mb-8 text-xs text-gray-400">
        Netto excludes VAT and tips; Brutto is what the customer paid, tip included. An order is counted
        as a sale only when it is completed and paid. The shift comes from the time the order was handed
        over, so a lunchtime pre-order collected in the evening belongs to dinner.
      </p>
    </div>
  );
}
