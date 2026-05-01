'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/* ── Constants ───────────────────────────────────────────────────────────── */
const STORES = ['Westend', 'Eschborn', 'Taunus'] as const;
type Store = (typeof STORES)[number];

// Dummy expected gross sales per store per day-of-week index (0 = Mon, 6 = Sun)
const DUMMY_SALES: Record<Store, number[]> = {
  Westend:  [4200, 4800, 4500, 4600, 5100, 6400, 5800],
  Eschborn: [3200, 3600, 3400, 3500, 4000, 5200, 4800],
  Taunus:   [3800, 4200, 4000, 4100, 4600, 5900, 5400],
};

/* Deterministic dummy usage: based on item name hash + day + store index */
function dummyUsage(itemName: string, dayOfWeek: number, storeIdx: number): number {
  let h = 0;
  for (let i = 0; i < itemName.length; i++) h = (h * 31 + itemName.charCodeAt(i)) & 0xffff;
  const raw = ((h + dayOfWeek * 37 + storeIdx * 19) % 18) + 1;
  // Weekends slightly higher
  return dayOfWeek >= 5 ? Math.ceil(raw * 1.3) : raw;
}

/* ── Date helpers ────────────────────────────────────────────────────────── */
function getWeekDays(offset: number): Date[] {
  const now = new Date();
  const dow = now.getDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday + offset * 7);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function fmtWeekRange(days: Date[]) {
  const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${days[0].toLocaleDateString('en-GB', o)} – ${days[6].toLocaleDateString('en-GB', o)}`;
}

function fmtDayHeader(d: Date) {
  return d.toLocaleDateString('en-GB', { weekday: 'short' })
    + ' ' + String(d.getDate()).padStart(2, '0')
    + '/' + String(d.getMonth() + 1).padStart(2, '0');
}

function isToday(d: Date) {
  const t = new Date();
  return d.getFullYear() === t.getFullYear()
    && d.getMonth() === t.getMonth()
    && d.getDate() === t.getDate();
}

/* ── Main page ───────────────────────────────────────────────────────────── */
export default function UsageForecastPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);

  /* Fetch distinct items from delivery_run_lines for the item list */
  const { data: rawItems = [], isLoading } = useQuery({
    queryKey: ['usage-forecast-items'],
    queryFn: async () => {
      const { data } = await supabase
        .from('delivery_run_lines')
        .select('item_name, unit, section')
        .order('section')
        .order('item_name');
      if (!data) return [];
      // Deduplicate
      const seen = new Set<string>();
      const out: { item_name: string; unit: string; section: string }[] = [];
      for (const row of data) {
        if (!seen.has(row.item_name)) {
          seen.add(row.item_name);
          out.push(row);
        }
      }
      return out;
    },
  });

  /* Group items by section */
  const sections = useMemo(() => {
    const map = new Map<string, typeof rawItems>();
    for (const item of rawItems) {
      const sec = item.section || 'Other';
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push(item);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rawItems]);

  /* Total columns per day = 3 stores */
  const COL_W = 68; // px per store column
  const ITEM_W = 180;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Usage Forecast</h1>
        <p className="text-xs text-gray-400">Dummy data — replace with recipe-based calculations</p>
      </div>

      {/* ── Week nav + legend ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-3 flex items-center justify-between gap-4">
        {/* Week picker */}
        <div className="flex items-center gap-3">
          <button onClick={() => setWeekOffset(w => w - 1)}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-gray-800 w-40 text-center">
            {fmtWeekRange(weekDays)}
          </span>
          <button onClick={() => setWeekOffset(w => w + 1)}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <ChevronRight size={16} />
          </button>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)}
              className="text-xs text-[#1B5E20] hover:underline font-medium">
              Today
            </button>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs font-medium">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#1B5E20]" /> Usage forecast
          </span>
          <span className="flex items-center gap-1.5 text-gray-400">
            — No data / closed
          </span>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse" style={{ minWidth: ITEM_W + 7 * 3 * COL_W }}>
              <thead>
                {/* ── Row 1: Day headers ── */}
                <tr className="border-b border-gray-100">
                  <th
                    className="sticky left-0 z-20 bg-white border-r border-gray-100 px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
                    style={{ minWidth: ITEM_W }}
                    rowSpan={3}
                  >
                    Item
                  </th>
                  {weekDays.map((day, di) => {
                    const today = isToday(day);
                    return (
                      <th
                        key={di}
                        colSpan={STORES.length}
                        className={`text-center font-bold text-sm py-2 border-l border-gray-100 ${today ? 'bg-green-50 text-[#1B5E20]' : 'text-gray-700'}`}
                        style={{ minWidth: COL_W * STORES.length }}
                      >
                        {fmtDayHeader(day)}
                        {today && (
                          <span className="ml-1.5 text-[10px] font-semibold bg-[#1B5E20] text-white rounded-full px-1.5 py-0.5">Today</span>
                        )}
                      </th>
                    );
                  })}
                </tr>

                {/* ── Row 2: Expected sales per store ── */}
                <tr className="border-b border-gray-100">
                  {weekDays.map((day, di) => {
                    const dow = (di); // 0=Mon
                    const today = isToday(day);
                    return STORES.map((store, si) => (
                      <th
                        key={`${di}-${si}`}
                        className={`text-center py-1 px-1 border-l font-semibold text-[10px] ${
                          si === 0 ? 'border-gray-200' : 'border-gray-50'
                        } ${today ? 'bg-green-50/60 text-[#1B5E20]' : 'text-gray-400'}`}
                        style={{ minWidth: COL_W }}
                        title={`Expected gross sales: ${store}`}
                      >
                        €{(DUMMY_SALES[store][dow] / 1000).toFixed(1)}k
                      </th>
                    ));
                  })}
                </tr>

                {/* ── Row 3: Store name sub-headers ── */}
                <tr className="border-b-2 border-gray-200">
                  {weekDays.map((day, di) => {
                    const today = isToday(day);
                    return STORES.map((store, si) => (
                      <th
                        key={`${di}-${si}-label`}
                        className={`text-center py-1.5 px-1 font-semibold text-[10px] uppercase tracking-wide border-l ${
                          si === 0 ? 'border-gray-200' : 'border-gray-50'
                        } ${today ? 'bg-green-50/40 text-[#1B5E20]/70' : 'text-gray-400'}`}
                        style={{ minWidth: COL_W }}
                      >
                        {store}
                      </th>
                    ));
                  })}
                </tr>
              </thead>

              <tbody>
                {sections.map(([section, items]) => (
                  <>
                    {/* Section header */}
                    <tr key={`sec-${section}`} className="bg-gray-50 border-y border-gray-100">
                      <td
                        className="sticky left-0 z-10 bg-gray-50 px-4 py-1.5 border-r border-gray-100"
                        colSpan={1 + 7 * STORES.length}
                      >
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                          {section}
                        </span>
                      </td>
                    </tr>

                    {/* Item rows */}
                    {items.map(item => (
                      <tr key={item.item_name} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        {/* Sticky item name */}
                        <td
                          className="sticky left-0 z-10 bg-white border-r border-gray-100 px-4 py-2"
                          style={{ minWidth: ITEM_W }}
                        >
                          <div className="font-medium text-gray-800 text-xs leading-tight">{item.item_name}</div>
                          <div className="text-gray-400 text-[10px] mt-0.5">{item.unit}</div>
                        </td>

                        {/* Usage cells: 7 days × 3 stores */}
                        {weekDays.map((day, di) => {
                          const today = isToday(day);
                          // Day-of-week index (0=Mon)
                          const dow = di;
                          return STORES.map((store, si) => {
                            const usage = dummyUsage(item.item_name, dow, si);
                            return (
                              <td
                                key={`${di}-${si}`}
                                className={`text-center py-2 px-1 border-l ${
                                  si === 0 ? 'border-gray-100' : 'border-gray-50'
                                } ${today ? 'bg-green-50/20' : ''}`}
                                style={{ minWidth: COL_W }}
                              >
                                <span className="font-semibold text-[#1B5E20] text-xs">{usage}</span>
                              </td>
                            );
                          });
                        })}
                      </tr>
                    ))}
                  </>
                ))}

                {sections.length === 0 && (
                  <tr>
                    <td colSpan={1 + 7 * 3} className="text-center py-12 text-gray-400 text-sm">
                      No items found. Items will appear once deliveries have been created.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Usage figures are based on dummy data. Connect to recipe/BOM system for real forecasts.
      </p>
    </div>
  );
}
