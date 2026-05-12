'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { ShoppingBag, ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Location = { id: string; name: string };

type ProductRow = {
  id:              string;
  shift_report_id: string;
  product_name:    string;
  quantity:        number;
  gross_sales:     number;
  // joined from shift_reports
  report_date:     string;
  shift_type:      'lunch' | 'dinner' | null;
  location_id:     string;
};

type SortKey = 'product_name' | 'quantity' | 'gross_sales';
type SortDir = 'asc' | 'desc';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);

const fmtDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isoMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function isoLastMonthRange(): [string, string] {
  const d = new Date();
  const firstThisMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const lastDay  = new Date(firstThisMonth.getTime() - 86400000);
  const firstDay = new Date(lastDay.getFullYear(), lastDay.getMonth(), 1);
  const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  return [fmt(firstDay), fmt(lastDay)];
}
function isoWeekAgo() {
  const d = new Date(Date.now() - 7 * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const PRESETS = [
  { label: 'Last 7 days',   range: () => [isoWeekAgo(), isoToday()] as [string,string] },
  { label: 'This month',    range: () => [isoMonthStart(), isoToday()] as [string,string] },
  { label: 'Last month',    range: isoLastMonthRange },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProductDetailsPage() {
  const today      = isoToday();
  const monthStart = isoMonthStart();

  const [locationId,  setLocationId]  = useState<string>('');
  const [shiftFilter, setShiftFilter] = useState<'all' | 'lunch' | 'dinner'>('all');
  const [dateFrom,    setDateFrom]    = useState(monthStart);
  const [dateTo,      setDateTo]      = useState(today);
  const [groupBy,     setGroupBy]     = useState<'aggregate' | 'shift'>('aggregate');
  const [sortKey,     setSortKey]     = useState<SortKey>('gross_sales');
  const [sortDir,     setSortDir]     = useState<SortDir>('desc');

  // ── Locations ──────────────────────────────────────────────────────────────

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['locations-active'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name, type').eq('is_active', true).order('name');
      return ((data ?? []) as any[]).filter(l => l.type === 'restaurant').map(({ id, name }) => ({ id, name }));
    },
  });

  // ── Product data ───────────────────────────────────────────────────────────

  const { data: rows = [], isLoading } = useQuery<ProductRow[]>({
    queryKey: ['shift-report-products', locationId, dateFrom, dateTo, shiftFilter],
    enabled: !!locationId,
    queryFn: async () => {
      let q = supabase
        .from('shift_report_products')
        .select(`
          id, shift_report_id, product_name, quantity, gross_sales,
          shift_reports!inner(report_date, shift_type, location_id)
        `)
        .eq('shift_reports.location_id', locationId)
        .gte('shift_reports.report_date', dateFrom)
        .lte('shift_reports.report_date', dateTo)
        .order('product_name');

      if (shiftFilter !== 'all') {
        q = q.eq('shift_reports.shift_type', shiftFilter);
      }

      const { data, error } = await q;
      if (error) throw error;

      return ((data ?? []) as any[]).map((r) => ({
        id:              r.id,
        shift_report_id: r.shift_report_id,
        product_name:    r.product_name,
        quantity:        r.quantity,
        gross_sales:     r.gross_sales,
        report_date:     r.shift_reports.report_date,
        shift_type:      r.shift_reports.shift_type,
        location_id:     r.shift_reports.location_id,
      }));
    },
  });

  // ── Aggregation ────────────────────────────────────────────────────────────

  const aggregated = useMemo(() => {
    const map = new Map<string, { quantity: number; gross_sales: number }>();
    for (const r of rows) {
      const existing = map.get(r.product_name);
      if (existing) {
        existing.quantity   += r.quantity;
        existing.gross_sales += r.gross_sales;
      } else {
        map.set(r.product_name, { quantity: r.quantity, gross_sales: r.gross_sales });
      }
    }
    return Array.from(map.entries()).map(([product_name, vals]) => ({ product_name, ...vals }));
  }, [rows]);

  // ── Shift groups (for "By Shift" view) ────────────────────────────────────

  const shiftGroups = useMemo(() => {
    const map = new Map<string, { date: string; shiftType: string | null; products: ProductRow[] }>();
    for (const r of rows) {
      if (!map.has(r.shift_report_id)) {
        map.set(r.shift_report_id, { date: r.report_date, shiftType: r.shift_type, products: [] });
      }
      map.get(r.shift_report_id)!.products.push(r);
    }
    return Array.from(map.entries())
      .map(([id, g]) => ({ id, ...g }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [rows]);

  // ── Sorting ────────────────────────────────────────────────────────────────

  const sorted = useMemo(() => {
    const arr = [...aggregated];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return arr;
  }, [aggregated, sortKey, sortDir]);

  const totals = useMemo(() => ({
    quantity:   rows.reduce((s, r) => s + r.quantity, 0),
    gross_sales: rows.reduce((s, r) => s + r.gross_sales, 0),
  }), [rows]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k
      ? (sortDir === 'asc' ? <ChevronUp size={12} className="text-white" /> : <ChevronDown size={12} className="text-white" />)
      : <ChevronsUpDown size={12} className="text-white/40" />;

  const shiftBadge = (t: string | null) => t === 'lunch'
    ? <span className="inline-flex items-center px-2 py-0.5 bg-amber-400/20 text-amber-200 text-xs font-medium rounded-full">🌤 Lunch</span>
    : <span className="inline-flex items-center px-2 py-0.5 bg-white/15 text-white/80 text-xs font-medium rounded-full">🌙 Dinner</span>;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#1B5E20]/10 flex items-center justify-center flex-shrink-0">
          <ShoppingBag size={20} className="text-[#1B5E20]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Details</h1>
          <p className="text-sm text-gray-500 mt-0.5">Products sold per shift — aggregated by day, week or month</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">

          {/* Location */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Location</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            >
              <option value="">— Select —</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          {/* Shift type */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Shift</label>
            <select
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value as any)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            >
              <option value="all">All shifts</option>
              <option value="lunch">Lunch only</option>
              <option value="dinner">Dinner only</option>
            </select>
          </div>

          {/* Date from */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
          </div>

          {/* Date to */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
          </div>
        </div>

        {/* Presets */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <span className="text-xs text-gray-400">Quick:</span>
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => { const [f,t] = p.range(); setDateFrom(f); setDateTo(t); }}
              className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-[#1B5E20] hover:text-[#1B5E20] transition-colors">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
          {(['aggregate', 'shift'] as const).map(g => (
            <button key={g} onClick={() => setGroupBy(g)}
              className={`px-4 py-2 transition-colors ${groupBy === g ? 'bg-[#1B5E20] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
              {g === 'aggregate' ? 'Aggregated' : 'By Shift'}
            </button>
          ))}
        </div>
        {rows.length > 0 && (
          <span className="text-xs text-gray-400">
            {groupBy === 'aggregate'
              ? `${sorted.length} products across ${shiftGroups.length} shift${shiftGroups.length !== 1 ? 's' : ''}`
              : `${shiftGroups.length} shift${shiftGroups.length !== 1 ? 's' : ''}`}
          </span>
        )}
      </div>

      {/* Content */}
      {!locationId ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center text-gray-400">
          <ShoppingBag size={32} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm font-medium">Select a location to view product details</p>
        </div>
      ) : isLoading ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center text-gray-400 text-sm">
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center text-gray-400">
          <p className="text-sm font-medium">No product data for this selection</p>
          <p className="text-xs mt-1">Import shift reports via Sales Reports → Upload to populate this page</p>
        </div>
      ) : groupBy === 'aggregate' ? (

        /* ── Aggregated view ── */
        <div className="rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[#1B5E20]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wide w-12 border-r border-white/10">#</th>
                <th className="px-4 py-3 text-left border-r border-white/10">
                  <button onClick={() => handleSort('product_name')} className="flex items-center gap-1 text-xs font-semibold text-white/70 uppercase tracking-wide hover:text-white">
                    Product <SortIcon k="product_name" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right border-r border-white/10">
                  <button onClick={() => handleSort('quantity')} className="flex items-center gap-1 text-xs font-semibold text-white/70 uppercase tracking-wide hover:text-white ml-auto">
                    Qty <SortIcon k="quantity" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right border-r border-white/10">
                  <button onClick={() => handleSort('gross_sales')} className="flex items-center gap-1 text-xs font-semibold text-white/70 uppercase tracking-wide hover:text-white ml-auto">
                    Gross Sales <SortIcon k="gross_sales" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-white/70 uppercase tracking-wide">Share</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr key={row.product_name}
                  className={`border-b border-gray-200 hover:bg-[#1B5E20]/5 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>
                  <td className="px-4 py-2.5 text-xs text-gray-400 font-mono border-r border-gray-200">{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800 border-r border-gray-200">{row.product_name}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 border-r border-gray-200 tabular-nums">
                    {new Intl.NumberFormat('de-DE').format(row.quantity)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-800 border-r border-gray-200 tabular-nums">{fmt(row.gross_sales)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span className="inline-block min-w-[48px] text-xs font-medium text-[#1B5E20]">
                      {totals.gross_sales > 0 ? ((row.gross_sales / totals.gross_sales) * 100).toFixed(1) + ' %' : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[#1B5E20]/10 border-t-2 border-[#1B5E20]/30">
                <td className="px-4 py-3 border-r border-gray-200" />
                <td className="px-4 py-3 text-xs font-bold text-gray-700 uppercase tracking-wide border-r border-gray-200">Total</td>
                <td className="px-4 py-3 text-right font-bold text-gray-800 border-r border-gray-200 tabular-nums">
                  {new Intl.NumberFormat('de-DE').format(totals.quantity)}
                </td>
                <td className="px-4 py-3 text-right font-bold text-[#1B5E20] text-base border-r border-gray-200 tabular-nums">{fmt(totals.gross_sales)}</td>
                <td className="px-4 py-3 text-right text-xs font-bold text-gray-500">100 %</td>
              </tr>
            </tfoot>
          </table>
        </div>

      ) : (

        /* ── By-shift view ── */
        <div className="space-y-4">
          {shiftGroups.map(group => {
            const groupTotal = group.products.reduce((s, r) => s + r.gross_sales, 0);
            const byRevenue  = [...group.products].sort((a, b) => b.gross_sales - a.gross_sales);
            return (
              <div key={group.id} className="rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-[#1B5E20]">
                  <span className="text-sm font-semibold text-white">{fmtDate(group.date)}</span>
                  {shiftBadge(group.shiftType)}
                  <span className="ml-auto text-sm font-bold text-white">{fmt(groupTotal)}</span>
                </div>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b-2 border-gray-200">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-r border-gray-200">Product</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide border-r border-gray-200">Qty</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Gross Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byRevenue.map((r, i) => (
                      <tr key={r.id}
                        className={`border-b border-gray-200 hover:bg-[#1B5E20]/5 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>
                        <td className="px-4 py-2 text-gray-800 border-r border-gray-200">{r.product_name}</td>
                        <td className="px-4 py-2 text-right text-gray-600 border-r border-gray-200 tabular-nums">
                          {new Intl.NumberFormat('de-DE').format(r.quantity)}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-gray-800 tabular-nums">{fmt(r.gross_sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
