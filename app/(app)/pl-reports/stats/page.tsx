'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { MapPin, BarChart3, Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n';

// ── Types ─────────────────────────────────────────────────────────────────────

type Location = { id: string; name: string };

type ShiftRow     = { report_date: string; shift_type: 'lunch' | 'dinner' | null; net_total: number; gross_total: number };
type DeliveryRow  = { report_date: string; shift_type: 'lunch' | 'dinner' | null; net_revenue: number; gross_revenue: number };
type BillRow      = { event_date: string | null; shift_type: 'lunch' | 'dinner' | null; net_total: number; gross_total: number };

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
  const { t } = useT();
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
        .select('report_date,shift_type,net_total,gross_total')
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
        .select('report_date,shift_type,net_revenue,gross_revenue')
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
        .select('event_date,shift_type,net_total,gross_total')
        .eq('issuing_location', location!.name)
        .gte('event_date', `${year}-01-01`)
        .lte('event_date', `${year}-12-31`);
      return (data ?? []) as BillRow[];
    },
  });

  const isLoading = loadingShifts || loadingDel || loadingBills;

  // ── Aggregation ───────────────────────────────────────────────────────────

  const {
    lunchMap, dinnerMap,
    lunchDays, dinnerDays,
    simplyGrossLunchMap, simplyGrossDinnerMap,
    totalGrossLunchMap, totalGrossDinnerMap,
    cols,
  } = useMemo(() => {
    const lunchMap:  Record<string, number> = {};
    const dinnerMap: Record<string, number> = {};

    // Gross maps for Simply as % of total
    const simplyGrossLunchMap:  Record<string, number> = {};
    const simplyGrossDinnerMap: Record<string, number> = {};
    const totalGrossLunchMap:   Record<string, number> = {};
    const totalGrossDinnerMap:  Record<string, number> = {};

    // Distinct date sets per period key, per shift type
    const lunchDates:  Record<string, Set<string>> = {};
    const dinnerDates: Record<string, Set<string>> = {};

    const key = (date: string) =>
      view === 'monthly'
        ? date.slice(0, 7)
        : `${weekYear(date)}-W${String(isoWeek(date)).padStart(2, '0')}`;

    const addLunch = (k: string, date: string, v: number) => {
      lunchMap[k] = (lunchMap[k] ?? 0) + v;
      (lunchDates[k] ??= new Set()).add(date);
    };
    const addDinner = (k: string, date: string, v: number) => {
      dinnerMap[k] = (dinnerMap[k] ?? 0) + v;
      (dinnerDates[k] ??= new Set()).add(date);
    };

    // POS (Orderbird) — net revenue + gross to total
    for (const s of shifts) {
      const k = key(s.report_date);
      if (s.shift_type === 'lunch') {
        addLunch(k, s.report_date, s.net_total);
        totalGrossLunchMap[k] = (totalGrossLunchMap[k] ?? 0) + (s.gross_total ?? 0);
      } else {
        addDinner(k, s.report_date, s.net_total);
        totalGrossDinnerMap[k] = (totalGrossDinnerMap[k] ?? 0) + (s.gross_total ?? 0);
      }
    }

    // Delivery (Simply) — net + gross tracked separately
    for (const d of deliveries) {
      const k = key(d.report_date);
      const isLunch = d.shift_type === 'lunch' || d.shift_type == null;
      if (isLunch) {
        addLunch(k, d.report_date, d.net_revenue);
        simplyGrossLunchMap[k] = (simplyGrossLunchMap[k] ?? 0) + (d.gross_revenue ?? 0);
        totalGrossLunchMap[k]  = (totalGrossLunchMap[k]  ?? 0) + (d.gross_revenue ?? 0);
      } else {
        addDinner(k, d.report_date, d.net_revenue);
        simplyGrossDinnerMap[k] = (simplyGrossDinnerMap[k] ?? 0) + (d.gross_revenue ?? 0);
        totalGrossDinnerMap[k]  = (totalGrossDinnerMap[k]  ?? 0) + (d.gross_revenue ?? 0);
      }
    }

    // Bills — net + gross to total
    for (const b of bills) {
      if (!b.event_date) continue;
      const k = key(b.event_date);
      if (b.shift_type === 'lunch') {
        addLunch(k, b.event_date, b.net_total);
        totalGrossLunchMap[k] = (totalGrossLunchMap[k] ?? 0) + (b.gross_total ?? 0);
      } else if (b.shift_type === 'dinner') {
        addDinner(k, b.event_date, b.net_total);
        totalGrossDinnerMap[k] = (totalGrossDinnerMap[k] ?? 0) + (b.gross_total ?? 0);
      }
    }

    // Collapse date sets → counts
    const lunchDays:  Record<string, number> = {};
    const dinnerDays: Record<string, number> = {};
    for (const [k, s] of Object.entries(lunchDates))  lunchDays[k]  = s.size;
    for (const [k, s] of Object.entries(dinnerDates)) dinnerDays[k] = s.size;

    // Build ordered column list
    let cols: { key: string; label: string }[];

    if (view === 'monthly') {
      cols = MONTHS.map((m, i) => ({
        key:   `${year}-${String(i + 1).padStart(2, '0')}`,
        label: m,
      }));
    } else {
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

    return {
      lunchMap, dinnerMap,
      lunchDays, dinnerDays,
      simplyGrossLunchMap, simplyGrossDinnerMap,
      totalGrossLunchMap, totalGrossDinnerMap,
      cols,
    };
  }, [shifts, deliveries, bills, view, year]);

  const lunchTotal  = Object.values(lunchMap).reduce( (s, v) => s + v, 0);
  const dinnerTotal = Object.values(dinnerMap).reduce((s, v) => s + v, 0);
  const grandTotal  = lunchTotal + dinnerTotal;

  // Sales/Day totals
  const totalLunchDays  = Object.values(lunchDays).reduce( (s, v) => s + v, 0);
  const totalDinnerDays = Object.values(dinnerDays).reduce((s, v) => s + v, 0);
  const totalDays       = totalLunchDays + totalDinnerDays;

  // Simply as % of total — full-year totals
  const simplyGrossLunchTotal  = Object.values(simplyGrossLunchMap).reduce( (s, v) => s + v, 0);
  const simplyGrossDinnerTotal = Object.values(simplyGrossDinnerMap).reduce((s, v) => s + v, 0);
  const totalGrossLunchTotal   = Object.values(totalGrossLunchMap).reduce(  (s, v) => s + v, 0);
  const totalGrossDinnerTotal  = Object.values(totalGrossDinnerMap).reduce( (s, v) => s + v, 0);

  // ── Render helpers ────────────────────────────────────────────────────────

  const Cell = ({ value }: { value: number }) =>
    value > 0
      ? <span className="font-semibold" style={{ color: '#1B5E20' }}>{fmt(value)}</span>
      : <span className="text-gray-300">—</span>;

  const TotalCell = ({ value }: { value: number }) =>
    value > 0
      ? <span className="font-bold" style={{ color: '#1B5E20' }}>{fmt(value)}</span>
      : <span className="text-gray-300">—</span>;

  const AvgCell = ({ revenue, days }: { revenue: number; days: number }) => {
    if (!revenue || !days) return <span className="text-gray-300">—</span>;
    return <span className="font-semibold" style={{ color: '#1B5E20' }}>{fmt(Math.round(revenue / days))}</span>;
  };

  const AvgTotalCell = ({ revenue, days }: { revenue: number; days: number }) => {
    if (!revenue || !days) return <span className="text-gray-300">—</span>;
    return <span className="font-bold" style={{ color: '#1B5E20' }}>{fmt(Math.round(revenue / days))}</span>;
  };

  const PctCell = ({ simply, total }: { simply: number; total: number }) => {
    if (!simply || !total) return <span className="text-gray-300">—</span>;
    const pct = (simply / total * 100).toFixed(1);
    return <span className="font-semibold" style={{ color: '#1B5E20' }}>{pct}%</span>;
  };

  const PctTotalCell = ({ simply, total }: { simply: number; total: number }) => {
    if (!simply || !total) return <span className="text-gray-300">—</span>;
    const pct = (simply / total * 100).toFixed(1);
    return <span className="font-bold" style={{ color: '#1B5E20' }}>{pct}%</span>;
  };

  // Shared table header
  const TableHeader = ({ title, lastColLabel }: { title: string; lastColLabel: string }) => (
    <thead>
      <tr style={{ backgroundColor: '#0f172a' }}>
        <th
          className="sticky left-0 z-10 px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap"
          style={{ backgroundColor: '#0f172a', minWidth: 180 }}
        >
          {title}
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
          {lastColLabel}
        </th>
      </tr>
    </thead>
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('plReports.stats')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t('plReports.statsSubtitle')}</p>
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
          <p className="text-sm text-gray-400">{t('plReports.selectLocation')}</p>
        </div>
      ) : (
        <>
        {/* ── Net Revenue table ── */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <TableHeader title={`Net Sales · ${year}`} lastColLabel="Total" />
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

        {/* ── Sales / Day table ── */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <TableHeader title={`Sales / Day · ${year}`} lastColLabel="Avg" />
              <tbody className="divide-y divide-gray-100">

                {/* Lunch / Day */}
                <tr className="hover:bg-green-50/40 transition-colors" style={{ backgroundColor: '#f0fdf4' }}>
                  <td
                    className="sticky left-0 z-10 px-4 py-3 font-bold whitespace-nowrap border-r border-gray-100"
                    style={{ backgroundColor: '#f0fdf4', color: '#1B5E20' }}
                  >
                    ☀️ Lunch
                  </td>
                  {cols.map(col => (
                    <td key={col.key} className="px-2 py-3 text-right tabular-nums">
                      <AvgCell revenue={lunchMap[col.key] ?? 0} days={lunchDays[col.key] ?? 0} />
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right tabular-nums border-l border-gray-200">
                    <AvgTotalCell revenue={lunchTotal} days={totalLunchDays} />
                  </td>
                </tr>

                {/* Dinner / Day */}
                <tr className="hover:bg-green-50/40 transition-colors" style={{ backgroundColor: '#f0fdf4' }}>
                  <td
                    className="sticky left-0 z-10 px-4 py-3 font-bold whitespace-nowrap border-r border-gray-100"
                    style={{ backgroundColor: '#f0fdf4', color: '#1B5E20' }}
                  >
                    🌙 Dinner
                  </td>
                  {cols.map(col => (
                    <td key={col.key} className="px-2 py-3 text-right tabular-nums">
                      <AvgCell revenue={dinnerMap[col.key] ?? 0} days={dinnerDays[col.key] ?? 0} />
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right tabular-nums border-l border-gray-200">
                    <AvgTotalCell revenue={dinnerTotal} days={totalDinnerDays} />
                  </td>
                </tr>

                {/* Total / Day */}
                <tr style={{ backgroundColor: '#f0fdf4' }} className="border-t-2 border-gray-200">
                  <td
                    className="sticky left-0 z-10 px-4 py-3 font-bold whitespace-nowrap border-r border-gray-200"
                    style={{ backgroundColor: '#f0fdf4', color: '#1B5E20' }}
                  >
                    ∑ Total
                  </td>
                  {cols.map(col => {
                    const rev  = (lunchMap[col.key] ?? 0) + (dinnerMap[col.key] ?? 0);
                    const days = (lunchDays[col.key] ?? 0) + (dinnerDays[col.key] ?? 0);
                    return (
                      <td key={col.key} className="px-2 py-3 text-right tabular-nums">
                        <AvgCell revenue={rev} days={days} />
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-right tabular-nums border-l border-gray-200">
                    <AvgTotalCell revenue={grandTotal} days={totalDays} />
                  </td>
                </tr>

              </tbody>
            </table>
          </div>
        </div>

        {/* ── Simply as % of Total table ── */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <TableHeader title={`Simply as % of Total · ${year}`} lastColLabel="%" />
              <tbody className="divide-y divide-gray-100">

                {/* Lunch % */}
                <tr className="hover:bg-green-50/40 transition-colors" style={{ backgroundColor: '#f0fdf4' }}>
                  <td
                    className="sticky left-0 z-10 px-4 py-3 font-bold whitespace-nowrap border-r border-gray-100"
                    style={{ backgroundColor: '#f0fdf4', color: '#1B5E20' }}
                  >
                    ☀️ Lunch
                  </td>
                  {cols.map(col => (
                    <td key={col.key} className="px-2 py-3 text-right tabular-nums">
                      <PctCell
                        simply={simplyGrossLunchMap[col.key] ?? 0}
                        total={totalGrossLunchMap[col.key] ?? 0}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right tabular-nums border-l border-gray-200">
                    <PctTotalCell simply={simplyGrossLunchTotal} total={totalGrossLunchTotal} />
                  </td>
                </tr>

                {/* Dinner % */}
                <tr className="hover:bg-green-50/40 transition-colors" style={{ backgroundColor: '#f0fdf4' }}>
                  <td
                    className="sticky left-0 z-10 px-4 py-3 font-bold whitespace-nowrap border-r border-gray-100"
                    style={{ backgroundColor: '#f0fdf4', color: '#1B5E20' }}
                  >
                    🌙 Dinner
                  </td>
                  {cols.map(col => (
                    <td key={col.key} className="px-2 py-3 text-right tabular-nums">
                      <PctCell
                        simply={simplyGrossDinnerMap[col.key] ?? 0}
                        total={totalGrossDinnerMap[col.key] ?? 0}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right tabular-nums border-l border-gray-200">
                    <PctTotalCell simply={simplyGrossDinnerTotal} total={totalGrossDinnerTotal} />
                  </td>
                </tr>

                {/* Total % */}
                <tr style={{ backgroundColor: '#f0fdf4' }} className="border-t-2 border-gray-200">
                  <td
                    className="sticky left-0 z-10 px-4 py-3 font-bold whitespace-nowrap border-r border-gray-200"
                    style={{ backgroundColor: '#f0fdf4', color: '#1B5E20' }}
                  >
                    ∑ Total
                  </td>
                  {cols.map(col => {
                    const sg = (simplyGrossLunchMap[col.key] ?? 0) + (simplyGrossDinnerMap[col.key] ?? 0);
                    const tg = (totalGrossLunchMap[col.key]  ?? 0) + (totalGrossDinnerMap[col.key]  ?? 0);
                    return (
                      <td key={col.key} className="px-2 py-3 text-right tabular-nums">
                        <PctCell simply={sg} total={tg} />
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-right tabular-nums border-l border-gray-200">
                    <PctTotalCell
                      simply={simplyGrossLunchTotal + simplyGrossDinnerTotal}
                      total={totalGrossLunchTotal + totalGrossDinnerTotal}
                    />
                  </td>
                </tr>

              </tbody>
            </table>
          </div>
        </div>

        </>
      )}
    </div>
  );
}
