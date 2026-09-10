'use client';

/**
 * Analysis → Sales.
 *
 * Sales trends across the restaurants, one metric at a time. The first metric
 * is net sales per trading day: what an open day earns, which is the figure
 * that stays comparable when one store trades six days and another seven, or
 * when a fortnight is lost to a holiday.
 *
 * The page is built around a metric list rather than around this one measure,
 * so the next question — guests per day, spend per guest — is a new entry
 * here, not a new page.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Loader2, TrendingUp } from 'lucide-react';
import { isoWeek, isoWeekYear, isoWeekMonday, isoWeekRange } from '@/lib/iso-week';

type Granularity = 'weekly' | 'monthly';
type ShiftFilter = 'all' | 'lunch' | 'dinner';

interface ShiftRow {
  location_id: string;
  report_date: string;
  shift_type:  'lunch' | 'dinner' | null;
  net_total:   number | null;
}

/** Distinguishable at a glance, and readable against a white card. */
const SERIES_COLOURS = ['#1B5E20', '#1d4ed8', '#c2410c', '#7c3aed', '#0891b2'];

const MONTHS_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const eur0 = (n: number) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
const eur2 = (n: number) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

/** Today, and the same day one year back, as "YYYY-MM-DD". */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const back = new Date(now);
  back.setFullYear(back.getFullYear() - 1);
  return { from: back.toISOString().slice(0, 10), to };
}

export default function SalesAnalysisPage() {
  const [granularity, setGranularity] = useState<Granularity>('weekly');
  const [shift, setShift]             = useState<ShiftFilter>('all');
  const [{ from, to }, setRange]      = useState(defaultRange);
  const [hidden, setHidden]           = useState<Set<string>>(new Set());

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-analysis'],
    queryFn: async () => {
      const { data } = await supabase
        .from('locations').select('id, name, type').eq('is_active', true).order('name');
      return ((data ?? []) as { id: string; name: string; type: string }[])
        .filter(l => l.type === 'restaurant')
        .map(({ id, name }) => ({ id, name }));
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['analysis-shifts', from, to],
    queryFn: async () => {
      // Three restaurants over a year is well past PostgREST's 1000-row cap.
      const all: ShiftRow[] = [];
      for (let p = 0; ; p++) {
        const { data, error } = await supabase
          .from('shift_reports')
          .select('location_id, report_date, shift_type, net_total')
          .gte('report_date', from).lte('report_date', to)
          .order('report_date')
          .range(p * 1000, (p + 1) * 1000 - 1);
        if (error) throw error;
        if (!data?.length) break;
        all.push(...(data as ShiftRow[]));
        if (data.length < 1000) break;
      }
      return all;
    },
  });

  const locationName = useMemo(() => {
    const m = new Map(locations.map(l => [l.id, l.name]));
    return (id: string) => m.get(id) ?? '—';
  }, [locations]);

  /**
   * Net sales per trading day, per period, per store.
   *
   * A trading day is a date the selected shift actually took money — so a
   * closure lowers nothing, and a store open six days is not penalised against
   * one open seven. Lunch and dinner are counted separately because their open
   * days differ: Taunus trades 299 lunches against 260 dinners.
   */
  const { periods, series, totals } = useMemo(() => {
    const filtered = shift === 'all' ? rows : rows.filter(r => r.shift_type === shift);

    /** period key → location id → { net, days } */
    const grid = new Map<string, Map<string, { net: number; days: Set<string> }>>();
    const labels = new Map<string, { sort: string; label: string; sub: string }>();

    for (const r of filtered) {
      let key: string, sort: string, label: string, sub: string;
      if (granularity === 'weekly') {
        const wy = isoWeekYear(r.report_date), wk = isoWeek(r.report_date);
        key   = `${wy}-W${String(wk).padStart(2, '0')}`;
        sort  = isoWeekMonday(wy, wk);
        label = `KW${wk}`;
        sub   = isoWeekRange(wy, wk);
      } else {
        const y = Number(r.report_date.slice(0, 4)), m = Number(r.report_date.slice(5, 7));
        key   = `${y}-${String(m).padStart(2, '0')}`;
        sort  = `${key}-01`;
        label = `${MONTHS_DE[m - 1]} ${String(y).slice(-2)}`;
        sub   = String(y);
      }
      labels.set(key, { sort, label, sub });

      let byLoc = grid.get(key);
      if (!byLoc) { byLoc = new Map(); grid.set(key, byLoc); }
      let cell = byLoc.get(r.location_id);
      if (!cell) { cell = { net: 0, days: new Set() }; byLoc.set(r.location_id, cell); }
      cell.net += Number(r.net_total ?? 0);
      cell.days.add(r.report_date);
    }

    const keys = [...labels.keys()].sort((a, b) => labels.get(a)!.sort.localeCompare(labels.get(b)!.sort));

    /* Recharts wants one object per x-value with a key per series. */
    const periods = keys.map(k => {
      const row: Record<string, string | number | null> = {
        key: k, label: labels.get(k)!.label, sub: labels.get(k)!.sub,
      };
      for (const l of locations) {
        const cell = grid.get(k)?.get(l.id);
        row[l.id]           = cell && cell.days.size > 0 ? Math.round(cell.net / cell.days.size) : null;
        row[`${l.id}__net`]  = cell?.net ?? 0;
        row[`${l.id}__days`] = cell?.days.size ?? 0;
      }
      return row;
    });

    /* A store with nothing in the window would otherwise take a legend slot. */
    const series = locations
      .filter(l => periods.some(p => p[l.id] !== null))
      .map((l, i) => ({ id: l.id, name: l.name, colour: SERIES_COLOURS[i % SERIES_COLOURS.length] }));

    const totals = new Map<string, { net: number; days: number }>();
    for (const l of locations) {
      let net = 0; const days = new Set<string>();
      for (const r of filtered) {
        if (r.location_id !== l.id) continue;
        net += Number(r.net_total ?? 0);
        days.add(r.report_date);
      }
      totals.set(l.id, { net, days: days.size });
    }

    return { periods, series, totals };
  }, [rows, locations, granularity, shift]);

  const visible = series.filter(s => !hidden.has(s.id));

  const toggle = (id: string) =>
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const btn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
      active ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
             : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
    }`;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900">Sales analysis</h1>
      <p className="text-sm text-gray-500 mb-5">
        Net sales per trading day — what an open day earns, by store
      </p>

      {/* ── Controls ── */}
      <div className="flex items-end gap-4 mb-5 flex-wrap">
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Period</p>
          <div className="flex gap-1">
            {(['weekly', 'monthly'] as Granularity[]).map(g => (
              <button key={g} onClick={() => setGranularity(g)} className={btn(granularity === g)}>
                {g === 'weekly' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Shift</p>
          <div className="flex gap-1">
            {(['all', 'lunch', 'dinner'] as ShiftFilter[]).map(sf => (
              <button key={sf} onClick={() => setShift(sf)} className={btn(shift === sf)}>
                {sf === 'all' ? 'All day' : sf === 'lunch' ? '☀️ Lunch' : '🌙 Dinner'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">From</p>
          <input type="date" value={from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-[#1B5E20]" />
        </div>
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">To</p>
          <input type="date" value={to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-[#1B5E20]" />
        </div>
      </div>

      {/* ── Headline per store ── */}
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: `repeat(${Math.max(series.length, 1)}, minmax(0, 1fr))` }}>
        {series.map(s => {
          const t = totals.get(s.id)!;
          return (
            <button key={s.id} onClick={() => toggle(s.id)}
              title={hidden.has(s.id) ? 'Show on chart' : 'Hide from chart'}
              className={`text-left bg-white border rounded-xl p-3 shadow-sm transition-opacity ${
                hidden.has(s.id) ? 'opacity-40' : ''
              }`}
              style={{ borderColor: hidden.has(s.id) ? '#e5e7eb' : s.colour }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: s.colour }}>{s.name}</p>
              <p className="text-xl font-bold tabular-nums text-gray-900">
                {t.days > 0 ? eur2(t.net / t.days) : '—'}
              </p>
              <p className="text-[11px] text-gray-400">{t.days} trading days · {eur0(t.net)} net</p>
            </button>
          );
        })}
        {series.length === 0 && (
          <div className="bg-white border border-gray-100 rounded-xl p-6 text-center text-sm text-gray-400">
            No shifts in this range
          </div>
        )}
      </div>

      {/* ── Chart ── */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 mb-6">
        {isLoading ? (
          <div className="h-80 flex items-center justify-center text-gray-400 gap-2">
            <Loader2 size={18} className="animate-spin" /> Loading…
          </div>
        ) : periods.length === 0 ? (
          <div className="h-80 flex flex-col items-center justify-center text-gray-400 gap-2">
            <TrendingUp size={28} className="text-gray-200" />
            <p className="text-sm">Nothing to plot for this range</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={periods} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }}
                interval="preserveStartEnd" minTickGap={16} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickFormatter={(v: number) => v.toLocaleString('de-DE')} width={64} />
              <Tooltip
                formatter={(value, name) => [typeof value === 'number' ? eur2(value) : String(value), String(name)]}
                labelFormatter={(label, payload) => {
                  const sub = (payload?.[0]?.payload as { sub?: string } | undefined)?.sub;
                  return sub ? `${String(label)} · ${sub}` : String(label);
                }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {visible.map(s => (
                // connectNulls joins across a period the store did not trade,
                // rather than breaking the line into fragments.
                <Line key={s.id} type="monotone" dataKey={s.id} name={s.name}
                  stroke={s.colour} strokeWidth={2} dot={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── The same numbers, readable ── */}
      <h2 className="text-lg font-bold text-gray-900 mb-1">Net sales / day</h2>
      <p className="text-sm text-gray-500 mb-3">
        {granularity === 'weekly' ? 'By ISO week' : 'By month'} · trading days only · {
          shift === 'all' ? 'both shifts' : shift === 'lunch' ? 'lunch only' : 'dinner only'
        }
      </p>
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-2 text-left whitespace-nowrap">Period</th>
                {series.map(s => (
                  <th key={s.id} className="px-3 py-2 text-right whitespace-nowrap" style={{ color: s.colour }}>
                    {s.name}
                    <span className="block font-normal normal-case tracking-normal text-[9px] text-gray-400">
                      net / day · days
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map(p => (
                <tr key={String(p.key)} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-4 py-1.5 whitespace-nowrap">
                    <span className="font-medium text-gray-800">{p.label}</span>
                    <span className="text-gray-400 text-xs ml-2">{p.sub}</span>
                  </td>
                  {series.map(s => {
                    const perDay = p[s.id] as number | null;
                    const days   = p[`${s.id}__days`] as number;
                    return (
                      <td key={s.id} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                        {perDay === null
                          ? <span className="text-gray-300">—</span>
                          : <>
                              <span className="font-semibold text-gray-800">{eur0(perDay)}</span>
                              <span className="text-gray-400 text-xs ml-1.5">{days}d</span>
                            </>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Net sales are Orderbird till sales, excluding Wolt, the webshop and event invoices.
        A trading day is a date the selected shift took money, so a closure does not drag the average down.
      </p>
    </div>
  );
}
