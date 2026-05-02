'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { MapPin, BarChart3, Loader2 } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Location = { id: string; name: string };

type ShiftRow     = { report_date: string; shift_type: 'lunch' | 'dinner' | null; net_total: number };
type DeliveryRow  = { report_date: string; shift_type: 'lunch' | 'dinner' | null; net_revenue: number };
type BillRow      = { event_date: string | null; shift_type: 'lunch' | 'dinner' | null; net_total: number };

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CUR_YEAR = new Date().getFullYear();

function isoWeek(dateStr: string): number {
  const d      = new Date(dateStr + 'T12:00:00Z');
  const jan4   = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const start1 = new Date(jan4);
  start1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  return Math.floor((d.getTime() - start1.getTime()) / (7 * 86400000)) + 1;
}

function weekYear(dateStr: string): number {
  const wk = isoWeek(dateStr);
  const m  = new Date(dateStr + 'T12:00:00Z').getUTCMonth();
  const y  = new Date(dateStr + 'T12:00:00Z').getUTCFullYear();
  if (m === 0  && wk > 50) return y - 1;
  if (m === 11 && wk < 5)  return y + 1;
  return y;
}

const fmt = (n: number) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const [locationId, setLocationId] = useState('');
  const [view,       setView]       = useState<'weekly' | 'monthly'>('weekly');
  const [year,       setYear]       = useState(CUR_YEAR);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-active'],
    queryFn: async () => {
      const { data } = await supabase
        .from('locations').select('id,name').eq('is_active', true).order('name');
      return (data ?? []) as Location[];
    },
  });

  const location = locations.find(l => l.id === locationId) ?? null;

  const { data: shifts = [], isLoading: loadingShifts } = useQuery({
    queryKey: ['stats-shifts', locationId, year],
    enabled:  !!locationId,
    queryFn: async () => {
      const { data } = await supabase
        .from('shift_reports')
        .select('report_date,shift_type,net_total')
        .eq('location_id', locationId)
        .gte('report_date', `${year}-01-01`)
        .lte('report_date', `${year}-12-31`);
      return (data ?? []) as ShiftRow[];
    },
  });

  const { data: deliveries = [], isLoading: loadingDel } = useQuery({
    queryKey: ['stats-deliveries', locationId, year],
    enabled:  !!locationId,
    queryFn: async () => {
      const { data } = await supabase
        .from('delivery_reports')
        .select('report_date,shift_type,net_revenue')
        .eq('location_id', locationId)
        .gte('report_date', `${year}-01-01`)
        .lte('report_date', `${year}-12-31`);
      return (data ?? []) as DeliveryRow[];
    },
  });

  const { data: bills = [], isLoading: loadingBills } = useQuery({
    queryKey: ['stats-bills', location?.name, year],
    enabled:  !!location,
    queryFn: async () => {
      const { data } = await supabase
        .from('outgoing_bills')
        .select('event_date,shift_type,net_total')
        .eq('issuing_location', location!.name)
        .gte('event_date', `${year}-01-01`)
        .lte('event_date', `${year}-12-31`);
      return (data ?? []) as BillRow[];
    },
  });

  const isLoading = loadingShifts || loadingDel || loadingBills;

  // ── Aggregation ───────────────────────────────────────────────────────────

  const { lunchMap, dinnerMap, cols } = useMemo(() => {
    const lunchMap:  Record<string, number> = {};
    const dinnerMap: Record<string, number> = {};

    const key = (date: string) =>
      view === 'monthly'
        ? date.slice(0, 7)
        : `${weekYear(date)}-W${String(isoWeek(date)).padStart(2, '0')}`;

    // POS (Orderbird)
    for (const s of shifts) {
      const k = key(s.report_date);
      if (s.shift_type === 'lunch') lunchMap[k]  = (lunchMap[k]  ?? 0) + s.net_total;
      else                          dinnerMap[k] = (dinnerMap[k] ?? 0) + s.net_total;
    }

    // Delivery (Simply)
    for (const d of deliveries) {
      const k = key(d.report_date);
      if (d.shift_type === 'lunch' || d.shift_type == null)
        lunchMap[k]  = (lunchMap[k]  ?? 0) + d.net_revenue;
      else
        dinnerMap[k] = (dinnerMap[k] ?? 0) + d.net_revenue;
    }

    // Bills
    for (const b of bills) {
      if (!b.event_date) continue;
      const k = key(b.event_date);
      if (b.shift_type === 'lunch')  lunchMap[k]  = (lunchMap[k]  ?? 0) + b.net_total;
      if (b.shift_type === 'dinner') dinnerMap[k] = (dinnerMap[k] ?? 0) + b.net_total;
    }

    // Build ordered column list
    let cols: { key: string; label: string }[];

    if (view === 'monthly') {
      cols = MONTHS.map((m, i) => ({
        key:   `${year}-${String(i + 1).padStart(2, '0')}`,
        label: m,
      }));
    } else {
      // Collect all ISO weeks belonging to `year`
      const seen = new Set<string>();
      const ordered: { key: string; label: string }[] = [];
      const d = new Date(Date.UTC(year, 0, 1));
      const end = new Date(Date.UTC(year, 11, 31));
      while (d <= end) {
        const ds = d.toISOString().slice(0, 10);
        if (weekYear(ds) === year) {
          const wk = isoWeek(ds);
          const k  = `${year}-W${String(wk).padStart(2, '0')}`;
          if (!seen.has(k)) {
            seen.add(k);
            ordered.push({ key: k, label: `CW${String(wk).padStart(2, '0')}` });
          }
        }
        d.setUTCDate(d.getUTCDate() + 1);
      }
      cols = ordered;
    }

    return { lunchMap, dinnerMap, cols };
  }, [shifts, deliveries, bills, view, year]);

  const lunchTotal  = Object.values(lunchMap).reduce( (s, v) => s + v, 0);
  const dinnerTotal = Object.values(dinnerMap).reduce((s, v) => s + v, 0);
  const grandTotal  = lunchTotal + dinnerTotal;

  // ── Render ────────────────────────────────────────────────────────────────

  const Cell = ({ value }: { value: number }) =>
    value > 0
      ? <span className="font-semibold" style={{ color: '#1B5E20' }}>{fmt(value)}</span>
      : <span className="text-gray-300">—</span>;

  const TotalCell = ({ value }: { value: number }) =>
    value > 0
      ? <span className="font-bold" style={{ color: '#1B5E20' }}>{fmt(value)}</span>
      : <span className="text-gray-300">—</span>;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Stats</h1>
        <p className="text-sm text-gray-500 mt-0.5">Revenue overview by week or month</p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">

        {/* Location */}
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
          <MapPin size={14} className="text-gray-400 flex-shrink-0" />
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="text-sm font-medium text-gray-700 focus:outline-none bg-transparent"
          >
            <option value="">Select location</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>

        {/* Year */}
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
        >
          {[CUR_YEAR - 2, CUR_YEAR - 1, CUR_YEAR, CUR_YEAR + 1].map(y =>
            <option key={y} value={y}>{y}</option>
          )}
        </select>

        {/* Weekly / Monthly toggle */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-white">
          {(['weekly', 'monthly'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 text-sm font-semibold transition-colors ${
                view === v
                  ? 'bg-[#1B5E20] text-white'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {v === 'weekly' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>

        {isLoading && locationId && (
          <Loader2 size={16} className="text-gray-400 animate-spin" />
        )}
      </div>

      {/* Empty state */}
      {!locationId ? (
        <div className="flex flex-col items-center justify-center h-48 border border-dashed border-gray-200 rounded-xl gap-3">
          <BarChart3 size={32} className="text-gray-200" />
          <p className="text-sm text-gray-400">Select a location to view stats</p>
        </div>
      ) : (

        /* Table */
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">

              {/* Header row */}
              <thead>
                <tr style={{ backgroundColor: '#0f172a' }}>
                  <th
                    className="sticky left-0 z-10 px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap"
                    style={{ backgroundColor: '#0f172a', minWidth: 180 }}
                  >
                    Metric / {view === 'weekly' ? 'Week' : 'Month'} · {year}
                  </th>
                  {cols.map(col => (
                    <th
                      key={col.key}
                      className="px-2 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap"
                      style={{ minWidth: view === 'weekly' ? 64 : 72 }}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th
                    className="px-3 py-3 text-right text-xs font-semibold text-amber-400 uppercase tracking-wider whitespace-nowrap border-l border-white/10"
                    style={{ minWidth: 80 }}
                  >
                    Total
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">

                {/* Total Lunch */}
                <tr className="hover:bg-green-50/40 transition-colors" style={{ backgroundColor: '#f0fdf4' }}>
                  <td
                    className="sticky left-0 z-10 px-4 py-3 font-bold whitespace-nowrap border-r border-gray-100"
                    style={{ backgroundColor: '#f0fdf4', color: '#1B5E20' }}
                  >
                    ☀️ Total Lunch
                  </td>
                  {cols.map(col => (
                    <td key={col.key} className="px-2 py-3 text-right tabular-nums">
                      <Cell value={lunchMap[col.key] ?? 0} />
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right tabular-nums border-l border-gray-200">
                    <TotalCell value={lunchTotal} />
                  </td>
                </tr>

                {/* Total Dinner */}
                <tr className="hover:bg-green-50/40 transition-colors" style={{ backgroundColor: '#f0fdf4' }}>
                  <td
                    className="sticky left-0 z-10 px-4 py-3 font-bold whitespace-nowrap border-r border-gray-100"
                    style={{ backgroundColor: '#f0fdf4', color: '#1B5E20' }}
                  >
                    🌙 Total Dinner
                  </td>
                  {cols.map(col => (
                    <td key={col.key} className="px-2 py-3 text-right tabular-nums">
                      <Cell value={dinnerMap[col.key] ?? 0} />
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right tabular-nums border-l border-gray-200">
                    <TotalCell value={dinnerTotal} />
                  </td>
                </tr>

                {/* Grand Total */}
                <tr style={{ backgroundColor: '#f0fdf4' }} className="border-t-2 border-gray-200">
                  <td
                    className="sticky left-0 z-10 px-4 py-3 font-bold whitespace-nowrap border-r border-gray-200"
                    style={{ backgroundColor: '#f0fdf4', color: '#1B5E20' }}
                  >
                    ∑ Total
                  </td>
                  {cols.map(col => {
                    const v = (lunchMap[col.key] ?? 0) + (dinnerMap[col.key] ?? 0);
                    return (
                      <td key={col.key} className="px-2 py-3 text-right tabular-nums">
                        <TotalCell value={v} />
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-right tabular-nums border-l border-gray-200">
                    <TotalCell value={grandTotal} />
                  </td>
                </tr>

              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
