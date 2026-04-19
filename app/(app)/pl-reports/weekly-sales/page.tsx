'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { MapPin } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────
type Location = { id: string; name: string };

type WeekData = {
  week_start:       string;
  week_end:         string | null;
  total_revenue:    number;
  gross_food:       number;
  gross_drinks:     number;
  net_revenue:      number;
  tax_total:        number;
  tips:             number;
  inhouse_revenue:  number;
  takeaway_revenue: number;
};

type RowType = 'section' | 'bold' | 'normal' | 'pct';
type RowColor = 'blue' | 'black' | 'green' | 'red';

type RowDef = {
  type:     RowType;
  label:    string;
  color?:   RowColor;
  format?:  'currency' | 'pct' | 'pct_delta';
  getValue?: (w: WeekData | null, pw: WeekData | null) => number | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function isoWeek(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - y.getTime()) / 86400000 + 1) / 7);
}

function currentISOWeek(): number {
  const today = new Date();
  const s = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  return isoWeek(s);
}

const safeNum = (n: any): number | null =>
  n !== null && n !== undefined && !isNaN(Number(n)) ? Number(n) : null;

const pct = (num: number | null, denom: number | null): number | null => {
  const n = safeNum(num), d = safeNum(denom);
  if (n === null || d === null || d === 0) return null;
  return (n / d) * 100;
};

const growth = (curr: number | null, prev: number | null): number | null => {
  const c = safeNum(curr), p = safeNum(prev);
  if (c === null || p === null || p === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
};

const fmtNum = (n: number) =>
  new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const TOTAL_WEEKS = 52;

// ── Row definitions ───────────────────────────────────────────────────────────
const ROWS: RowDef[] = [
  // ── REVENUE ──────────────────────────────────────────────────────────────
  { type: 'section', label: 'REVENUE' },
  {
    type: 'bold', label: 'Total Gross Revenue', color: 'blue', format: 'currency',
    getValue: (w) => safeNum(w?.total_revenue),
  },
  {
    type: 'pct', label: 'Revenue growth (%)', color: 'black', format: 'pct_delta',
    getValue: (w, pw) => growth(safeNum(w?.total_revenue), safeNum(pw?.total_revenue)),
  },
  {
    type: 'normal', label: 'Food Revenue (7% VAT)', color: 'blue', format: 'currency',
    getValue: (w) => safeNum(w?.gross_food),
  },
  {
    type: 'pct', label: 'Food share (%)', color: 'black', format: 'pct',
    getValue: (w) => pct(safeNum(w?.gross_food), safeNum(w?.total_revenue)),
  },
  {
    type: 'normal', label: 'Drinks Revenue (19% VAT)', color: 'blue', format: 'currency',
    getValue: (w) => safeNum(w?.gross_drinks),
  },
  {
    type: 'pct', label: 'Drinks share (%)', color: 'black', format: 'pct',
    getValue: (w) => pct(safeNum(w?.gross_drinks), safeNum(w?.total_revenue)),
  },
  {
    type: 'normal', label: 'Tips', color: 'blue', format: 'currency',
    getValue: (w) => safeNum(w?.tips),
  },

  // ── NET REVENUE ───────────────────────────────────────────────────────────
  { type: 'section', label: 'NET REVENUE' },
  {
    type: 'bold', label: 'Net Revenue', color: 'blue', format: 'currency',
    getValue: (w) => safeNum(w?.net_revenue),
  },
  {
    type: 'pct', label: 'Net growth (%)', color: 'black', format: 'pct_delta',
    getValue: (w, pw) => growth(safeNum(w?.net_revenue), safeNum(pw?.net_revenue)),
  },
  {
    type: 'normal', label: 'VAT', color: 'blue', format: 'currency',
    getValue: (w) => safeNum(w?.tax_total),
  },
  {
    type: 'pct', label: 'Effective VAT rate (%)', color: 'black', format: 'pct',
    getValue: (w) => pct(safeNum(w?.tax_total), safeNum(w?.net_revenue)),
  },

  // ── CHANNEL MIX ──────────────────────────────────────────────────────────
  { type: 'section', label: 'CHANNEL MIX' },
  {
    type: 'normal', label: 'In-house Revenue', color: 'blue', format: 'currency',
    getValue: (w) => safeNum(w?.inhouse_revenue),
  },
  {
    type: 'pct', label: 'In-house share (%)', color: 'black', format: 'pct',
    getValue: (w) => pct(safeNum(w?.inhouse_revenue), safeNum(w?.total_revenue)),
  },
  {
    type: 'normal', label: 'Takeaway Revenue', color: 'blue', format: 'currency',
    getValue: (w) => safeNum(w?.takeaway_revenue),
  },
  {
    type: 'pct', label: 'Takeaway share (%)', color: 'black', format: 'pct',
    getValue: (w) => pct(safeNum(w?.takeaway_revenue), safeNum(w?.total_revenue)),
  },

  // ── COSTS ────────────────────────────────────────────────────────────────
  { type: 'section', label: 'COSTS' },
  { type: 'normal', label: 'Food Cost',             color: 'black', format: 'currency', getValue: () => null },
  { type: 'pct',    label: 'Food cost (%)',          color: 'black', format: 'pct',     getValue: () => null },
  { type: 'normal', label: 'Drinks Cost',            color: 'black', format: 'currency', getValue: () => null },
  { type: 'pct',    label: 'Drinks cost (%)',        color: 'black', format: 'pct',     getValue: () => null },
  { type: 'normal', label: 'Labour Cost',            color: 'black', format: 'currency', getValue: () => null },
  { type: 'pct',    label: 'Labour cost (%)',        color: 'black', format: 'pct',     getValue: () => null },

  // ── PROFITABILITY ─────────────────────────────────────────────────────────
  { type: 'section', label: 'PROFITABILITY' },
  { type: 'bold', label: 'Gross Profit',             color: 'black', format: 'currency', getValue: () => null },
  { type: 'pct',  label: 'Gross margin (%)',         color: 'black', format: 'pct',     getValue: () => null },
  { type: 'bold', label: 'EBITDA',                   color: 'black', format: 'currency', getValue: () => null },
  { type: 'pct',  label: 'EBITDA margin (%)',        color: 'black', format: 'pct',     getValue: () => null },
];

// ── Page ──────────────────────────────────────────────────────────────────────
export default function WeeklySalesPage() {
  const [location, setLocation] = useState<Location | null>(null);
  const [year, setYear]         = useState(new Date().getFullYear());

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-active'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').eq('is_active', true).order('name');
      return (data ?? []) as Location[];
    },
  });

  const { data: imports = [] } = useQuery({
    queryKey: ['weekly-sales', location?.id, year],
    enabled: !!location,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_imports')
        .select('week_start, week_end, total_revenue, gross_food, gross_drinks, net_revenue, tax_total, tips, inhouse_revenue, takeaway_revenue')
        .eq('location_id', location!.id)
        .gte('week_start', `${year}-01-01`)
        .lte('week_start', `${year}-12-31`)
        .order('week_start', { ascending: true });
      if (error) throw error;
      return (data ?? []) as WeekData[];
    },
  });

  // KW → data
  const weekMap = useMemo<Record<number, WeekData>>(() => {
    const map: Record<number, WeekData> = {};
    for (const imp of imports) {
      if (imp.week_start) map[isoWeek(imp.week_start)] = imp;
    }
    return map;
  }, [imports]);

  const weeks  = Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1);
  const cwk    = currentISOWeek();
  const hasData = Object.keys(weekMap).length > 0;

  // Render a single cell value
  const renderCell = (row: RowDef, kw: number) => {
    if (row.type === 'section') return null;
    const w  = weekMap[kw]     ?? null;
    const pw = weekMap[kw - 1] ?? null;
    const val = row.getValue?.(w, pw) ?? null;

    if (val === null) {
      return <span className="text-gray-300 select-none">—</span>;
    }

    if (row.format === 'currency') {
      const colorClass =
        row.color === 'blue'  ? 'text-blue-700'  :
        row.color === 'green' ? 'text-green-700'  :
        row.color === 'red'   ? 'text-red-600'   : 'text-gray-900';
      return <span className={colorClass}>{fmtNum(val)}</span>;
    }

    if (row.format === 'pct') {
      return <span className="text-gray-500">{val.toFixed(1)}%</span>;
    }

    if (row.format === 'pct_delta') {
      const sign  = val >= 0 ? '+' : '';
      const color = val >= 0 ? 'text-green-600' : 'text-red-500';
      return <span className={color}>{sign}{val.toFixed(1)}%</span>;
    }

    return <span>{fmtNum(val)}</span>;
  };

  // Totals row for the very bottom (all-weeks aggregate)
  const yearTotal = useMemo<WeekData | null>(() => {
    if (imports.length === 0) return null;
    return imports.reduce<WeekData>((acc, w) => ({
      week_start:       '',
      week_end:         null,
      total_revenue:    acc.total_revenue    + (safeNum(w.total_revenue)    ?? 0),
      gross_food:       acc.gross_food       + (safeNum(w.gross_food)       ?? 0),
      gross_drinks:     acc.gross_drinks     + (safeNum(w.gross_drinks)     ?? 0),
      net_revenue:      acc.net_revenue      + (safeNum(w.net_revenue)      ?? 0),
      tax_total:        acc.tax_total        + (safeNum(w.tax_total)        ?? 0),
      tips:             acc.tips             + (safeNum(w.tips)             ?? 0),
      inhouse_revenue:  acc.inhouse_revenue  + (safeNum(w.inhouse_revenue)  ?? 0),
      takeaway_revenue: acc.takeaway_revenue + (safeNum(w.takeaway_revenue) ?? 0),
    }), {
      week_start: '', week_end: null,
      total_revenue: 0, gross_food: 0, gross_drinks: 0,
      net_revenue: 0, tax_total: 0, tips: 0,
      inhouse_revenue: 0, takeaway_revenue: 0,
    });
  }, [imports]);

  const COL_WIDTH = 76;
  const LABEL_WIDTH = 220;

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Weekly Sales P&L</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gross revenue by calendar week · {year}</p>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-5 text-xs text-gray-500 pt-1">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-blue-600 inline-block" />
            Reported (imported)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-gray-800 inline-block" />
            Calculated
          </span>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="flex items-center gap-6 mb-5 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Location</span>
          {locations.map((l) => (
            <button
              key={l.id}
              onClick={() => setLocation(l)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                location?.id === l.id
                  ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20] hover:text-[#1B5E20]'
              }`}
            >
              <MapPin size={11} />
              {l.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Year</span>
          {[2025, 2026, 2027].map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                year === y
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* ── Empty state ── */}
      {!location ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2 border border-dashed border-gray-200 rounded-xl">
          <MapPin size={36} className="text-gray-200" />
          <p className="text-sm">Select a location to view the P&L</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table
              className="text-xs border-collapse"
              style={{ minWidth: LABEL_WIDTH + (TOTAL_WEEKS + 1) * COL_WIDTH }}
            >
              {/* ── Column header row ── */}
              <thead>
                <tr style={{ backgroundColor: '#111827' }}>
                  {/* Sticky metric label */}
                  <th
                    className="sticky left-0 z-20 px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap border-r border-gray-700"
                    style={{ backgroundColor: '#111827', minWidth: LABEL_WIDTH, width: LABEL_WIDTH }}
                  >
                    METRIC / PERIOD
                  </th>

                  {/* Week columns */}
                  {weeks.map((kw) => {
                    const hasWeek = !!weekMap[kw];
                    const isCurrent = kw === cwk;
                    return (
                      <th
                        key={kw}
                        className="py-3 text-right font-bold whitespace-nowrap tabular-nums"
                        style={{
                          minWidth: COL_WIDTH,
                          width: COL_WIDTH,
                          paddingLeft: 4,
                          paddingRight: 10,
                          color: isCurrent ? '#ffffff' : hasWeek ? '#93c5fd' : '#4b5563',
                          borderBottom: isCurrent ? '2px solid #3b82f6' : 'none',
                        }}
                      >
                        KW{kw}
                      </th>
                    );
                  })}

                  {/* Year total column */}
                  <th
                    className="py-3 text-right font-bold whitespace-nowrap border-l border-gray-700"
                    style={{ minWidth: COL_WIDTH + 8, paddingLeft: 4, paddingRight: 10, color: '#e5e7eb' }}
                  >
                    FY {year}
                  </th>
                </tr>
              </thead>

              {/* ── Body ── */}
              <tbody>
                {ROWS.map((row, i) => {

                  // ── Section header row ──
                  if (row.type === 'section') {
                    return (
                      <tr key={i}>
                        <td
                          colSpan={TOTAL_WEEKS + 2}
                          className="sticky left-0 px-4 py-2 text-xs font-bold uppercase tracking-widest"
                          style={{ backgroundColor: '#f3f4f6', color: '#374151', letterSpacing: '0.08em' }}
                        >
                          {row.label}
                        </td>
                      </tr>
                    );
                  }

                  const isBold  = row.type === 'bold';
                  const isPct   = row.type === 'pct';
                  const bgColor = isBold ? '#f0fdf4' : '#ffffff';

                  return (
                    <tr
                      key={i}
                      className="border-b border-gray-100 hover:bg-gray-50/60 transition-colors group"
                      style={{ backgroundColor: bgColor }}
                    >
                      {/* Metric label */}
                      <td
                        className={`sticky left-0 z-10 px-4 py-2 whitespace-nowrap border-r border-gray-100 group-hover:bg-gray-50/60 transition-colors ${
                          isBold ? 'font-bold text-gray-900' :
                          isPct  ? 'pl-8 text-gray-400 italic' :
                                   'text-gray-700'
                        }`}
                        style={{ backgroundColor: bgColor }}
                      >
                        {row.label}
                      </td>

                      {/* Weekly cells */}
                      {weeks.map((kw) => {
                        const isCurrent = kw === cwk;
                        return (
                          <td
                            key={kw}
                            className={`py-2 text-right tabular-nums ${isBold ? 'font-bold' : ''}`}
                            style={{
                              paddingLeft: 4,
                              paddingRight: 10,
                              backgroundColor: isCurrent ? 'rgba(59,130,246,0.04)' : undefined,
                            }}
                          >
                            {renderCell(row, kw)}
                          </td>
                        );
                      })}

                      {/* Year total cell */}
                      <td
                        className={`py-2 text-right tabular-nums border-l border-gray-200 ${isBold ? 'font-bold' : ''}`}
                        style={{ paddingLeft: 4, paddingRight: 10 }}
                      >
                        {isPct || !yearTotal ? (
                          <span className="text-gray-300">—</span>
                        ) : (() => {
                          const val = row.getValue?.(yearTotal, null) ?? null;
                          if (val === null) return <span className="text-gray-300">—</span>;
                          if (row.format === 'currency') {
                            const colorClass = row.color === 'blue' ? 'text-blue-700' : 'text-gray-900';
                            return <span className={colorClass}>{fmtNum(val)}</span>;
                          }
                          return <span className="text-gray-300">—</span>;
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer note */}
          {hasData && (
            <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {imports.length} week{imports.length !== 1 ? 's' : ''} imported · Costs & profitability rows coming soon
              </span>
              <span className="text-xs text-gray-400">
                Total gross revenue {year}: <span className="font-bold text-[#1B5E20]">
                  {yearTotal ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(yearTotal.total_revenue) : '—'}
                </span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
