'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { TrendingUp, ChevronLeft, ChevronRight, Lock, Save, CheckCircle2 } from 'lucide-react';
import { useT } from '@/lib/i18n';

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

const DOW_TO_KEY: Record<number, string> = { 1: 'mon', 2: 'tue', 3: 'wed', 5: 'fri' };
const DELIVERY_DOW = [1, 2, 3, 5];

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function getMondayOfWeek(d: Date): Date {
  const day = d.getDay();
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
  const today = toDateString(new Date());
  if (dateStr !== today) return false;
  return new Date().getHours() >= 3;
}

function isPastDay(dateStr: string): boolean {
  return dateStr < toDateString(new Date());
}

function scalingBadge(forecasted: number, standard: number) {
  if (standard === 0) return null;
  const pct = Math.round((forecasted / standard) * 100);
  const diff = Math.abs(pct - 100);
  if (diff <= 2)   return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-semibold">100%</span>;
  if (pct > 100)   return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold">{pct}%</span>;
  return <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-semibold">{pct}%</span>;
}

/* ─── Forecast Cell ──────────────────────────────────────────────────────── */
function ForecastCell({
  standard, value, readOnly, onChange,
}: {
  standard: number;
  value: string;
  readOnly: boolean;
  onChange: (v: string) => void;
}) {
  const numVal = parseFloat(value);
  const hasValue = !isNaN(numVal) && value !== '';

  return (
    <div className="flex flex-col gap-1 min-w-[130px]">
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none select-none">€</span>
        <input
          type="text"
          inputMode="numeric"
          disabled={readOnly}
          value={value}
          placeholder={standard > 0 ? String(standard) : '0'}
          onChange={e => onChange(e.target.value)}
          className={`w-full pl-7 pr-2 py-1.5 text-sm rounded-lg border text-right transition-colors
            ${readOnly
              ? 'bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-white border-gray-200 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]/50 hover:border-gray-300'
            }
          `}
        />
      </div>
      {standard > 0 && (
        <div className="text-xs text-gray-400">Standard: €{standard.toLocaleString('en-GB')}</div>
      )}
      {hasValue && standard > 0 && (
        <div>{scalingBadge(numVal, standard)}</div>
      )}
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function ForecastPage() {
  const qc = useQueryClient();
  const { t } = useT();
  const [weekOffset, setWeekOffset] = useState(0);
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({});
  const [savedFlash, setSavedFlash] = useState(false);

  const today = new Date();
  const baseMonday = getMondayOfWeek(today);
  const monday = addDays(baseMonday, weekOffset * 7);

  const deliveryDates: { dateStr: string; dow: number; date: Date }[] = DELIVERY_DOW.map(dow => {
    const offset = dow === 5 ? 4 : dow - 1;
    const date = addDays(monday, offset);
    return { dateStr: toDateString(date), dow, date };
  });
  const weekDates = deliveryDates.map(d => d.dateStr);

  // Clear local edits when week changes
  useEffect(() => { setLocalEdits({}); }, [weekOffset]);

  /* ─ Load standards ─ */
  const { data: standards = [] } = useQuery<StoreDayStandard[]>({
    queryKey: ['store-day-standards'],
    queryFn: async () => {
      const { data, error } = await supabase.from('store_day_standards').select('*');
      if (error) throw error;
      return data as StoreDayStandard[];
    },
    staleTime: Infinity,
  });

  /* ─ Load forecasts ─ */
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

  /* ─ Save all edits at once ─ */
  const saveForecasts = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(localEdits)
        .map(([key, val]) => {
          const [store, dateStr] = key.split('__');
          const parsed = parseFloat(val);
          if (isNaN(parsed) || parsed < 0) return null;
          return { location_name: store, forecast_date: dateStr, forecasted_sales_eur: parsed };
        })
        .filter(Boolean) as { location_name: string; forecast_date: string; forecasted_sales_eur: number }[];

      if (rows.length === 0) return;
      const { error } = await supabase
        .from('weekly_sales_forecasts')
        .upsert(rows, { onConflict: 'location_name,forecast_date' });
      if (error) throw error;
    },
    onSuccess: () => {
      setLocalEdits({});
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
      qc.invalidateQueries({ queryKey: ['weekly-forecasts', weekDates[0], weekDates[3]] });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weekly-forecasts', weekDates[0], weekDates[3]] }),
  });

  /* ─ Cell key helpers ─ */
  const cellKey = (store: Store, dateStr: string) => `${store}__${dateStr}`;

  const getCellValue = (store: Store, dateStr: string): string => {
    const key = cellKey(store, dateStr);
    if (localEdits[key] !== undefined) return localEdits[key];
    const f = forecasts.find(f => f.location_name === store && f.forecast_date === dateStr);
    return f ? String(f.forecasted_sales_eur) : '';
  };

  const handleCellChange = (store: Store, dateStr: string, value: string) => {
    setLocalEdits(prev => ({ ...prev, [cellKey(store, dateStr)]: value }));
  };

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

  /* ─ Dirty check (any valid unsaved edits?) ─ */
  const hasDirtyChanges = Object.entries(localEdits).some(([_, val]) => {
    const parsed = parseFloat(val);
    return !isNaN(parsed) && parsed >= 0;
  });

  /* ─ Column totals ─ */
  function storeWeekTotal(store: Store): number | null {
    const vals = deliveryDates.map(({ dateStr }) => {
      const val = getCellValue(store, dateStr);
      const n = parseFloat(val);
      return isNaN(n) ? null : n;
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
            <h1 className="text-2xl font-bold text-gray-900">{t('delivery.salesForecast')}</h1>
          </div>
          <p className="text-sm text-gray-500">
            Set expected sales per store per delivery day — targets scale proportionally
          </p>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3">
          {savedFlash && (
            <span className="flex items-center gap-1.5 text-sm text-green-700 font-medium">
              <CheckCircle2 size={15} className="text-green-500" /> Saved
            </span>
          )}
          <button
            onClick={() => saveForecasts.mutate()}
            disabled={!hasDirtyChanges || saveForecasts.isPending}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm
              ${hasDirtyChanges
                ? 'bg-[#1B5E20] text-white hover:bg-[#2E7D32]'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }
              disabled:opacity-60
            `}
          >
            <Save size={15} />
            {saveForecasts.isPending ? 'Saving…' : 'Save Forecasts'}
          </button>
        </div>
      </div>

      {/* Unsaved changes notice */}
      {hasDirtyChanges && (
        <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700 font-medium">
          You have unsaved changes — click "Save Forecasts" to apply them.
        </div>
      )}

      {/* Week navigation */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => setWeekOffset(o => o - 1)}
          className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors shadow-sm"
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
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-[180px]">Day</th>
                {STORES.map(store => (
                  <th key={store} className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {store}
                  </th>
                ))}
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide w-[110px]">Actions</th>
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
                      <div className="font-semibold text-gray-800 text-sm">{formatDayLabel(date)}</div>
                      {isToday && <span className="text-xs text-[#1B5E20] font-semibold">Today</span>}
                      {autoLocked && (
                        <div className="flex items-center gap-1 text-xs text-amber-600 mt-1">
                          <Lock size={11} />
                          <span className="font-semibold">Locked after 03:00</span>
                        </div>
                      )}
                    </td>

                    {/* Store cells */}
                    {STORES.map(store => {
                      const readOnly = autoLocked || past;
                      const isDirty = localEdits[cellKey(store, dateStr)] !== undefined;
                      return (
                        <td key={store} className="px-4 py-4 align-top">
                          <div className={isDirty ? 'ring-2 ring-amber-300/60 rounded-lg' : ''}>
                            <ForecastCell
                              standard={getStandard(store, dow)}
                              value={getCellValue(store, dateStr)}
                              readOnly={readOnly}
                              onChange={v => handleCellChange(store, dateStr, v)}
                            />
                          </div>
                        </td>
                      );
                    })}

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
                          {locked
                            ? <span className="flex items-center gap-1"><Lock size={11} /> Locked</span>
                            : 'Lock Day'}
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
                <td className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Week total</td>
                {STORES.map(store => {
                  const total = storeWeekTotal(store);
                  return (
                    <td key={store} className="px-4 py-3 text-center">
                      {total !== null
                        ? <span className="font-bold text-gray-800">€{total.toLocaleString('en-GB')}</span>
                        : <span className="text-gray-300 text-xs">—</span>
                      }
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
        <span>Targets auto-lock at 03:00 on delivery morning</span>
        <span>·</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-400" />Above standard</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-400" />Below standard</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-gray-300" />At standard (±2%)</span>
      </div>
    </div>
  );
}
