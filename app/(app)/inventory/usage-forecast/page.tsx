'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/* ── Canonical sort order (mirrors delivery + overview pages) ─────────────── */
const SECTION_ORDER = ['Kühlhaus', 'Tiefkühler', 'Trockenware', 'Regale', 'Lager'];

const CANONICAL_ITEMS: string[] = [
  'Guacamole','Schärfemix','Pico de Gallo','Rote Salsa','Grüne Salsa','Crema',
  'Pollo Adobado','Pollo Asado','Birria','Carne Vegetal','Chorizo','Costilla de Res',
  'Filetspitzen','Füllung Nogada','Hähnchenkeule (ganz)','Mole Rojo','Pulpo',
  'Rinderfilet Steak','Hähnchenfilet','Steak Fleisch (Rind)','Pork Belly',
  'Tortilla 16cm','Tortilla 20cm','Tortilla 25cm','Tostada','Taco Dorado Shell',
  'Elotes (TK)','Garnelen (TK)','Maisblätter (TK)','Garnelen (frisch)',
  'Limetten','Tomaten','Rote Zwiebeln','Jalapeños (frisch)','Avocados',
  'Koriander','Mais (Dose)','Schwarze Bohnen (Dose)','Chipotle (Dose)',
  'Crema Lata','Käse (gerieben)','Sauerrahm','Queso Fresco',
  'Chips','Totopos','Agua Fresca Mix','Horchata Mix','Tamarindo',
  'Servietten','Takeaway Boxen','Papierbecher',
];

const ITEM_RANK = Object.fromEntries(CANONICAL_ITEMS.map((n, i) => [n, i]));

function canonicalSectionOrder(sections: string[]): string[] {
  const known = SECTION_ORDER.filter(s => sections.includes(s));
  const rest  = sections.filter(s => !SECTION_ORDER.includes(s)).sort();
  return [...known, ...rest];
}

function canonicalItemOrder<T extends { item_name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ra = ITEM_RANK[a.item_name] ?? 9999;
    const rb = ITEM_RANK[b.item_name] ?? 9999;
    return ra !== rb ? ra - rb : a.item_name.localeCompare(b.item_name);
  });
}

/* ── Forecast helpers (mirrors sales-reports/page.tsx) ───────────────────── */
type ForecastSettings = {
  location_id:   string;
  shift_type:    'lunch' | 'dinner';
  week_base_net: number;
  growth_rate:   number;
  weight_mon: number; weight_tue: number; weight_wed: number; weight_thu: number;
  weight_fri: number; weight_sat: number; weight_sun: number;
};

const DOW_WEIGHT_KEYS = [
  'weight_sun','weight_mon','weight_tue','weight_wed',
  'weight_thu','weight_fri','weight_sat',
] as const;

function computeDailyForecast(dateKey: string, s: ForecastSettings): number {
  if (!s.week_base_net) return 0;
  const d        = new Date(dateKey + 'T12:00:00Z');
  const today    = new Date();
  const refMs    = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const weeksAhead = Math.round((d.getTime() - refMs) / (7 * 24 * 3600 * 1000));
  const growth   = (1 + s.growth_rate / 100) ** Math.max(0, weeksAhead);
  const weight   = s[DOW_WEIGHT_KEYS[d.getUTCDay()]] as number;
  return s.week_base_net * weight * growth;
}

/* ── Constants ───────────────────────────────────────────────────────────── */
const STORES = ['Westend', 'Eschborn', 'Taunus'] as const;
type Store = (typeof STORES)[number];

/* Deterministic dummy ratio 0–1: relative item usage weight */
function itemRatio(itemName: string, storeIdx: number): number {
  let h = 0;
  for (let i = 0; i < itemName.length; i++) h = (h * 31 + itemName.charCodeAt(i)) & 0xffff;
  const raw = ((h + storeIdx * 19) % 18) + 1; // 1–18
  return raw / 18; // 0.056–1.0
}

/* Scale usage by forecasted sales vs a €3 000 baseline */
const BASE_SALES = 3000;
function forecastUsage(itemName: string, storeIdx: number, dailySales: number): number {
  if (dailySales <= 0) return 0;
  const ratio = itemRatio(itemName, storeIdx);
  return Math.max(1, Math.round(ratio * (dailySales / BASE_SALES) * 18));
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

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  /* Fetch all active locations to map name → id */
  const { data: locations = [] } = useQuery({
    queryKey: ['locations-usage'],
    queryFn: async () => {
      const { data } = await supabase
        .from('locations')
        .select('id, name')
        .eq('is_active', true);
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  /* Fetch forecast settings for all locations */
  const { data: allForecastSettings = [] } = useQuery({
    queryKey: ['forecast-settings-all'],
    queryFn: async () => {
      const { data } = await supabase
        .from('forecast_settings')
        .select('location_id,shift_type,week_base_net,growth_rate,weight_mon,weight_tue,weight_wed,weight_thu,weight_fri,weight_sat,weight_sun');
      return (data ?? []) as ForecastSettings[];
    },
  });

  /* Fetch distinct items from delivery_run_lines for the item list */
  const { data: rawItems = [], isLoading } = useQuery({
    queryKey: ['usage-forecast-items'],
    queryFn: async () => {
      const { data } = await supabase
        .from('delivery_run_lines')
        .select('item_name, unit, section');
      if (!data) return [];
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

  /* Build location name → forecast settings lookup */
  const locationIdByName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const loc of locations) m[loc.name] = loc.id;
    return m;
  }, [locations]);

  /* Compute daily sales forecast per store per dateKey */
  const dailySalesByStore = useMemo(() => {
    const result: Record<Store, Record<string, number>> = {
      Westend: {}, Eschborn: {}, Taunus: {},
    };
    for (const store of STORES) {
      const locId = locationIdByName[store];
      if (!locId) continue;
      const lunchS  = allForecastSettings.find(s => s.location_id === locId && s.shift_type === 'lunch');
      const dinnerS = allForecastSettings.find(s => s.location_id === locId && s.shift_type === 'dinner');
      for (const day of weekDays) {
        const dk = dateKey(day);
        const l = lunchS  ? computeDailyForecast(dk, lunchS)  : 0;
        const d = dinnerS ? computeDailyForecast(dk, dinnerS) : 0;
        result[store][dk] = l + d;
      }
    }
    return result;
  }, [locationIdByName, allForecastSettings, weekDays]);

  /* Group items by section in canonical order */
  const sections = useMemo(() => {
    const map = new Map<string, typeof rawItems>();
    for (const item of rawItems) {
      const sec = item.section || 'Other';
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push(item);
    }
    const allSections = [...map.keys()];
    const ordered = canonicalSectionOrder(allSections);
    return ordered
      .filter(sec => map.has(sec))
      .map(sec => [sec, canonicalItemOrder(map.get(sec)!)] as [string, typeof rawItems]);
  }, [rawItems]);

  const COL_W = 68;
  const ITEM_W = 180;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Usage Forecast</h1>
        <p className="text-xs text-gray-400">Sales forecasts from Forecast Settings · usage proportional to sales</p>
      </div>

      {/* ── Week nav + legend ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-3 flex items-center justify-between gap-4">
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

                {/* ── Row 2: Forecasted sales per store ── */}
                <tr className="border-b border-gray-100">
                  {weekDays.map((day, di) => {
                    const today = isToday(day);
                    const dk = dateKey(day);
                    return STORES.map((store, si) => {
                      const sales = dailySalesByStore[store][dk] ?? 0;
                      const hasForecast = sales > 0;
                      return (
                        <th
                          key={`${di}-${si}`}
                          className={`text-center py-1 px-1 border-l font-semibold text-[10px] ${
                            si === 0 ? 'border-gray-200' : 'border-gray-50'
                          } ${today ? 'bg-green-50/60' : ''} ${hasForecast ? 'text-[#1B5E20]' : 'text-gray-300'}`}
                          style={{ minWidth: COL_W }}
                          title={`Forecasted net sales: ${store}`}
                        >
                          {hasForecast ? `€${(sales / 1000).toFixed(1)}k` : '—'}
                        </th>
                      );
                    });
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
                          const dk = dateKey(day);
                          return STORES.map((store, si) => {
                            const sales = dailySalesByStore[store][dk] ?? 0;
                            const usage = sales > 0 ? forecastUsage(item.item_name, si, sales) : null;
                            return (
                              <td
                                key={`${di}-${si}`}
                                className={`text-center py-2 px-1 border-l ${
                                  si === 0 ? 'border-gray-100' : 'border-gray-50'
                                } ${today ? 'bg-green-50/20' : ''}`}
                                style={{ minWidth: COL_W }}
                              >
                                {usage !== null
                                  ? <span className="font-semibold text-[#1B5E20] text-xs">{usage}</span>
                                  : <span className="text-gray-300">—</span>
                                }
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
        Sales figures come from Forecast Settings per location. Item quantities are proportional to forecasted sales — connect recipe/BOM data for precise amounts.
      </p>
    </div>
  );
}
