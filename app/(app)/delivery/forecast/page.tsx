'use client';

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { TrendingUp, ChevronLeft, ChevronRight, Lock } from 'lucide-react';

/* ─── Types ─────────────────────────────────────────────────────────────── */
type StoreDayStandard = {
  location_name: string;
  day_of_week: string;
  standard_sales_eur: number;
};

type WeeklyForecast = {
  id: string;
  location_name: string;
  forecast_date: string;
  forecasted_sales_eur: number;
  is_locked: boolean;
  locked_at: string | null;
};

/* ─── Constants ──────────────────────────────────────────────────────────── */
const STORES = ['Eschborn', 'Taunus', 'Westend'] as const;
type Store = typeof STORES[number];

// day-of-week index → short key used in standards table
const DOW_TO_KEY: Record<number, string> = {
  1: 'mon',
  2: 'tue',
  3: 'wed',
  5: 'fri',
};

// Delivery days: Mon=1, Tue=2, Wed=3, Fri=5
const DELIVERY_DOW = [1, 2, 3, 5];

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function getMondayOfWeek(d: Date): Date {
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(d.getDate() + n);
  return result;
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDayLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}

function formatWeekHeader(monday: Date): string {
  return monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function isLockedNow(dateStr: string): boolean {
  // Locked if today is the delivery date and current time >= 03:00
  const today = toDateString(new Date());
  if (dateStr !== today) return false;
  const now = new Date();
  return now.getHours() >= 3;
}

function isPastDay(dateStr: string): boolean {
  const today = toDateString(new Date());
  return dateStr < today;
}

function scalingBadge(forecasted: number, standard: number) {
  const pct = Math.round((forecasted / standard) * 100);
  const diff = Math.abs(pct - 100);
  if (diff <= 2) {
    return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-semibold">100%</span>;
  }
  if (pct > 100) {
    return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold">{pct}%</span>;
  }
  return <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-semibold">{pct}%</span>;
}

/* ─── Forecast Cell ──────────────────────────────────────────────────────── */
function ForecastCell({
  store,
  dateStr,
  standard,
  existing,
  onSave,
}: {
  store: Store;
  dateStr: string;
  standard: number;
  existing: number | null;
  onSave: (store: Store, dateStr: string, value: number) => void;
}) {
  const locked = isLockedNow(dateStr);
  const past = isPastDay(dateStr);
  const readOnly = (locked || past);

  const [draft, setDraft] = useState<string>('');
  const [focused, setFocused] = useState(false);

  const displayValue = existing !== null ? existing : '';

  const handleFocus = () => {
    setDraft(existing !== null ? String(existing) : '');
    setFocused(true);
  };

  const handleBlur = () => {
    setFocused(false);
    const parsed = parseFloat(draft);
    if (!isNaN(parsed) && parsed >= 0) {
      onSave(store, dateStr, parsed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  const forecastedForBadge = existing !== null ? existing : standard;

  return (
    <div className="flex flex-col gap-1 min-w-[130px]">
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">€</span>
        <input
          type="number"
          min={0}
          step={100}
          disabled={readOnly}
          value={focused ? draft : (displayValue === '' ? '' : displayValue)}
          placeholder={readOnly ? '' : String(standard)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          className={`w-full pl-7 pr-2 py-1.5 text-sm rounded-lg border text-right
            ${readOnly
              ? 'bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-white border-gray-200 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]/40'
            }
          `}
        />
      </div>
      <div className="text-xs text-gray-400">
        Standard: €{standard.toLocaleString('en-GB')}
      </div>
      {existing !== null && (
        <div>{scalingBadge(forecastedForBadge, standard)}</div>
      )}
      {locked && (
        <div className="flex items-center gap-1 text-xs text-amber-600 font-semibold">
          <Lock size={11} /> LOCKED
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function ForecastPage() {
  const qc = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);

  const today = new Date();
  const baseMonday = getMondayOfWeek(today);
  const monday = addDays(baseMonday, weekOffset * 7);

  // Build the 4 delivery day dates for this week
  const deliveryDates: { dateStr: string; dow: number; date: Date }[] = DELIVERY_DOW.map(dow => {
    // Mon offset from monday: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4
    const offset = dow === 5 ? 4 : dow - 1;
    const date = addDays(monday, offset);
    return { dateStr: toDateString(date), dow, date };
  });

  const weekDates = deliveryDates.map(d => d.dateStr);

  /* ─ Load standards (once) ─ */
  const { data: standards = [] } = useQuery<StoreDayStandard[]>({
    queryKey: ['store-day-standards'],
    queryFn: async () => {
      const { data, error } = await supabase.from('store_day_standards').select('*');
      if (error) throw error;
      return data as StoreDayStandard[];
    },
    staleTime: Infinity,
  });

  /* ─ Load forecasts for this week ─ */
  const { data: forecasts = [] } = useQuery<WeeklyForecast[]>({
    queryKey: ['weekly-forecasts', weekDates[0], weekDates[3]],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weekly_sales_forecasts')
        .select('*')
        .in('forecast_date', weekDates)
        .in('location_name', [...STORES]);
      if (error) throw error;
      return data as WeeklyForecast[];
    },
  });

  /* ─ Upsert forecast ─ */
  const upsertForecast = useMutation({
    mutationFn: async ({ store, dateStr, value }: { store: Store; dateStr: string; value: number }) => {
      const { error } = await supabase
        .from('weekly_sales_forecasts')
        .upsert(
          { location_name: store, forecast_date: dateStr, forecasted_sales_eur: value },
          { onConflict: 'location_name,forecast_date' }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weekly-forecasts', weekDates[0], weekDates[3]] });
      // also invalidate delivery page so it picks up new forecasts
      qc.invalidateQueries({ queryKey: ['delivery-run'] });
    },
  });

  /* ─ Lock day ─ */
  const lockDay = useMutation({
    mutationFn: async (dateStr: string) => {
      const { error } = await supabase
        .from('weekly_sales_forecasts')
        .update({ is_locked: true, locked_at: new Date().toISOString() })
        .eq('forecast_date', dateStr)
        .in('location_name', [...STORES]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weekly-forecasts', weekDates[0], weekDates[3]] });
    },
  });

  const handleSave = useCallback((store: Store, dateStr: string, value: number) => {
    upsertForecast.mutate({ store, dateStr, value });
  }, [upsertForecast]);

  /* ─ Lookup helpers ─ */
  function getStandard(store: Store, dow: number): number {
    const key = DOW_TO_KEY[dow];
    const s = standards.find(s => s.location_name === store && s.day_of_week === key);
    return s?.standard_sales_eur ?? 0;
  }

  function getForecast(store: Store, dateStr: string): number | null {
    const f = forecasts.find(f => f.location_name === store && f.forecast_date === dateStr);
    return f ? f.forecasted_sales_eur : null;
  }

  function isDayLocked(dateStr: string): boolean {
    return STORES.every(store => {
      const f = forecasts.find(f => f.location_name === store && f.forecast_date === dateStr);
      return f?.is_locked === true;
    });
  }

  /* ─ Column totals ─ */
  function storeWeekTotal(store: Store): number | null {
    const vals = deliveryDates.map(({ dateStr, dow }) => {
      const f = getForecast(store, dateStr);
      return f !== null ? f : null;
    });
    if (vals.every(v => v === null)) return null;
    return vals.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  }

  const todayStr = toDateString(today);

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={20} className="text-[#1B5E20]" />
            <h1 className="text-2xl font-bold text-gray-900">Weekly Sales Forecast</h1>
          </div>
          <p className="text-sm text-gray-500">
            Set expected sales per store per delivery day — targets scale proportionally
          </p>
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => setWeekOffset(o => o - 1)}
          className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors shadow-sm"
          title="Previous week"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-2">
          <span className="text-sm font-semibold text-gray-800">
            Week of {formatWeekHeader(monday)}
          </span>
          {weekOffset === 0 && (
            <span className="ml-2 text-xs text-[#1B5E20] font-semibold bg-green-50 px-2 py-0.5 rounded-full">
              Current week
            </span>
          )}
        </div>
        <button
          onClick={() => setWeekOffset(o => o + 1)}
          className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors shadow-sm"
          title="Next week"
        >
          <ChevronRight size={16} />
        </button>
        {weekOffset !== 0 && (
          <button
            onClick={() => setWeekOffset(0)}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Back to current week
          </button>
        )}
      </div>

      {/* Grid card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-[180px]">
                  Day
                </th>
                {STORES.map(store => (
                  <th key={store} className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {store}
                  </th>
                ))}
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide w-[110px]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {deliveryDates.map(({ dateStr, dow, date }) => {
                const isToday = dateStr === todayStr;
                const past = isPastDay(dateStr);
                const locked = isDayLocked(dateStr);
                const autoLocked = isLockedNow(dateStr);

                return (
                  <tr
                    key={dateStr}
                    className={`border-t border-gray-50 transition-colors ${
                      past ? 'bg-gray-50/70' : isToday ? 'bg-green-50/30' : 'hover:bg-gray-50/40'
                    }`}
                    style={isToday ? { borderLeft: '3px solid #1B5E20' } : undefined}
                  >
                    {/* Day label */}
                    <td className="px-4 py-4 align-top">
                      <div className="font-semibold text-gray-800 text-sm">
                        {formatDayLabel(date)}
                      </div>
                      {isToday && (
                        <span className="text-xs text-[#1B5E20] font-semibold">Today</span>
                      )}
                      {autoLocked && (
                        <div className="flex items-center gap-1 text-xs text-amber-600 mt-1">
                          <Lock size={11} />
                          <span className="font-semibold">Locked after 03:00</span>
                        </div>
                      )}
                    </td>

                    {/* Store cells */}
                    {STORES.map(store => (
                      <td key={store} className="px-4 py-4 align-top">
                        <ForecastCell
                          store={store}
                          dateStr={dateStr}
                          standard={getStandard(store, dow)}
                          existing={getForecast(store, dateStr)}
                          onSave={handleSave}
                        />
                      </td>
                    ))}

                    {/* Lock day button */}
                    <td className="px-4 py-4 text-center align-top">
                      {!past && (
                        <button
                          disabled={locked || lockDay.isPending}
                          onClick={() => lockDay.mutate(dateStr)}
                          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                            locked
                              ? 'bg-gray-100 text-gray-400 cursor-default'
                              : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                          }`}
                        >
                          {locked ? (
                            <span className="flex items-center gap-1"><Lock size={11} /> Locked</span>
                          ) : 'Lock Day'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Totals row */}
            <tfoot>
              <tr className="border-t-2 border-gray-100 bg-gray-50">
                <td className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Week total
                </td>
                {STORES.map(store => {
                  const total = storeWeekTotal(store);
                  return (
                    <td key={store} className="px-4 py-3 text-center">
                      {total !== null ? (
                        <span className="font-bold text-gray-800">
                          €{total.toLocaleString('en-GB')}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  );
                })}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-400">
        <span>Targets auto-lock at 03:00 on delivery morning (force-edit still possible via Target Levels page)</span>
        <span>·</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
          Above standard
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
          Below standard
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-gray-300" />
          At standard (±2%)
        </span>
      </div>
    </div>
  );
}
