'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useT } from '@/lib/i18n';
import {
  computeSimplyRatios,
  computeDailyTotal,
  currentQuarterRange,
  type ForecastSettings,
  type ForecastOverride,
  type ShiftRowLite,
  type DelivRowLite,
} from '@/lib/forecast-utils';

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
  const { t } = useT();
  const [weekOffset, setWeekOffset] = useState(0);
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);

  /* ── Locations ── */
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

  /* ── Forecast settings for all locations ── */
  const { data: allForecastSettings = [] } = useQuery({
    queryKey: ['forecast-settings-all'],
    queryFn: async () => {
      const { data } = await supabase
        .from('forecast_settings')
        .select('location_id,shift_type,week_base_net,growth_rate,weight_mon,weight_tue,weight_wed,weight_thu,weight_fri,weight_sat,weight_sun,closed_weekdays');
      return (data ?? []) as ForecastSettings[];
    },
  });

  /* ── Week date range ── */
  const weekStart = weekDays[0] ? dateKey(weekDays[0]) : '';
  const weekEnd   = weekDays[6] ? dateKey(weekDays[6]) : '';

  /* ── Current quarter range (for ratio computation) ── */
  const { qStart, qEnd } = useMemo(() => currentQuarterRange(), []);

  /* ── Quarter shift_reports — exact same data as Sales Reports uses for ratio ── */
  const { data: qShiftRows = [], refetch: refetchQShifts } = useQuery({
    queryKey: ['q-shift-rows-ratio', qStart, qEnd],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('shift_reports')
        .select('location_id, report_date, shift_type, net_total, z_report_number')
        .gte('report_date', qStart)
        .lte('report_date', qEnd);
      return (data ?? []) as ShiftRowLite[];
    },
  });

  /* ── Quarter delivery_reports — exact same data as Sales Reports uses for ratio ── */
  const { data: qDelivRows = [], refetch: refetchQDeliv } = useQuery({
    queryKey: ['q-deliv-rows-ratio', qStart, qEnd],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('delivery_reports')
        .select('location_id, report_date, shift_type, net_revenue')
        .gte('report_date', qStart)
        .lte('report_date', qEnd);
      return (data ?? []) as DelivRowLite[];
    },
  });

  /* ── Simply/OB ratios — computed with the EXACT same algorithm as Sales Reports ── */
  const simplyRatios = useMemo(
    () => computeSimplyRatios(qShiftRows, qDelivRows),
    [qShiftRows, qDelivRows],
  );

  /* ── Forecast overrides for the displayed week ── */
  const { data: weekOverrides = [], refetch: refetchOverrides } = useQuery({
    queryKey: ['forecast-overrides-week', weekStart, weekEnd],
    enabled: !!weekStart,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('forecast_overrides')
        .select('location_id, forecast_date, shift_type, net_revenue')
        .gte('forecast_date', weekStart)
        .lte('forecast_date', weekEnd);
      return (data ?? []) as ForecastOverride[];
    },
  });

  /* ── Actual Orderbird shift_reports for the week ── */
  const { data: weekShiftRows = [], refetch: refetchShifts } = useQuery({
    queryKey: ['shift-reports-week', weekStart, weekEnd],
    enabled: !!weekStart,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('shift_reports')
        .select('location_id, report_date, net_total')
        .gte('report_date', weekStart)
        .lte('report_date', weekEnd);
      return (data ?? []) as { location_id: string; report_date: string; net_total: number }[];
    },
  });

  /* ── Actual Simply delivery_reports for the week ── */
  const { data: weekDeliveryRows = [], refetch: refetchDeliveries } = useQuery({
    queryKey: ['delivery-reports-week', weekStart, weekEnd],
    enabled: !!weekStart,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('delivery_reports')
        .select('location_id, report_date, net_revenue')
        .gte('report_date', weekStart)
        .lte('report_date', weekEnd);
      return (data ?? []) as { location_id: string; report_date: string; net_revenue: number }[];
    },
  });

  /* ── Outgoing bills for the week ── */
  const locationNames = useMemo(() => locations.map(l => l.name), [locations]);
  const { data: weekBillRows = [], refetch: refetchBills } = useQuery({
    queryKey: ['outgoing-bills-week', weekStart, weekEnd, locationNames.join(',')],
    enabled: !!weekStart && locationNames.length > 0,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('outgoing_bills')
        .select('issuing_location, event_date, net_total')
        .in('issuing_location', locationNames)
        .gte('event_date', weekStart)
        .lte('event_date', weekEnd);
      return (data ?? []) as { issuing_location: string; event_date: string; net_total: number }[];
    },
  });

  /* ── Closure days ── */
  const { data: closureDays = [], refetch: refetchClosures } = useQuery({
    queryKey: ['closure-days-usage', weekStart, weekEnd],
    enabled: !!weekStart,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('closure_days')
        .select('location_id, closure_date, shift_type')
        .gte('closure_date', weekStart)
        .lte('closure_date', weekEnd);
      return (data ?? []) as { location_id: string; closure_date: string; shift_type: string }[];
    },
  });

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refetchShifts(),
      refetchDeliveries(),
      refetchBills(),
      refetchClosures(),
      refetchOverrides(),
      refetchQShifts(),
      refetchQDeliv(),
    ]);
    setRefreshing(false);
  };

  /* Local closure overrides — toggled immediately on click; persisted async to DB */
  const [localClosures, setLocalClosures] = useState<Record<string, boolean>>({});

  /* Effective closed set: DB data UNION local overrides */
  const closedSet = useMemo(() => {
    const s = new Set<string>();
    for (const c of closureDays) s.add(`${c.location_id}:${c.closure_date}`);
    for (const [key, closed] of Object.entries(localClosures)) {
      if (closed) s.add(key); else s.delete(key);
    }
    return s;
  }, [closureDays, localClosures]);

  /* Toggle closure — optimistic update then async persist */
  const handleToggleClosure = async (locId: string, dk: string, currentlyClosed: boolean) => {
    const key = `${locId}:${dk}`;
    setLocalClosures(prev => ({ ...prev, [key]: !currentlyClosed }));
    try {
      if (currentlyClosed) {
        const { error } = await supabase.from('closure_days')
          .delete().eq('location_id', locId).eq('closure_date', dk);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('closure_days').upsert({
          location_id:  locId,
          closure_date: dk,
          shift_type:   'all',
          reason:       'Closed (set from Usage Forecast)',
        }, { onConflict: 'location_id,closure_date,shift_type' });
        if (error) throw new Error(error.message);
      }
      await refetchClosures();
      setLocalClosures(prev => { const n = { ...prev }; delete n[key]; return n; });
    } catch (e: any) {
      setLocalClosures(prev => { const n = { ...prev }; delete n[key]; return n; });
      alert(`Could not update closure: ${e.message}`);
    }
  };

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

  /* Build location name → id lookup */
  const locationIdByName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const loc of locations) m[loc.name] = loc.id;
    return m;
  }, [locations]);

  /* Actual net sales per location+date: Orderbird + Simply + Bills */
  const actualSalesByLocDate = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of weekShiftRows)
      m[`${r.location_id}:${r.report_date}`] = (m[`${r.location_id}:${r.report_date}`] ?? 0) + (r.net_total ?? 0);
    for (const r of weekDeliveryRows)
      m[`${r.location_id}:${r.report_date}`] = (m[`${r.location_id}:${r.report_date}`] ?? 0) + (r.net_revenue ?? 0);
    for (const b of weekBillRows) {
      if (!b.event_date) continue;
      const locId = locationIdByName[b.issuing_location];
      if (!locId) continue;
      m[`${locId}:${b.event_date}`] = (m[`${locId}:${b.event_date}`] ?? 0) + (b.net_total ?? 0);
    }
    return m;
  }, [weekShiftRows, weekDeliveryRows, weekBillRows, locationIdByName]);

  /**
   * Per store+day sales value.
   * - Actual: sum of uploaded shift_reports + delivery_reports + outgoing_bills (blue)
   * - Forecast: computeDailyTotal() — identical computation to Sales Reports "Daily Total" row (green)
   * - Closed: null
   *
   * NOTE: forecast values ALWAYS match the Sales Reports Daily Total row exactly because
   * both use computeDailyTotal() + computeSimplyRatios() from lib/forecast-utils.ts.
   */
  type DaySales = { val: number; isActual: boolean } | null;
  const dailySalesByStore = useMemo(() => {
    const result: Record<Store, Record<string, DaySales>> = {
      Westend: {}, Eschborn: {}, Taunus: {},
    };
    for (const store of STORES) {
      const locId = locationIdByName[store];
      if (!locId) continue;
      const lunchS  = allForecastSettings.find(s => s.location_id === locId && s.shift_type === 'lunch');
      const dinnerS = allForecastSettings.find(s => s.location_id === locId && s.shift_type === 'dinner');
      const ratios  = simplyRatios[locId] ?? { lunch: 0, dinner: 0 };

      for (const day of weekDays) {
        const dk = dateKey(day);
        if (closedSet.has(`${locId}:${dk}`)) { result[store][dk] = null; continue; }

        const actualKey = `${locId}:${dk}`;
        if (actualKey in actualSalesByLocDate) {
          // Uploaded data exists — show exact actuals
          result[store][dk] = { val: actualSalesByLocDate[actualKey], isActual: true };
        } else {
          // No actuals — compute forecast exactly as Sales Reports "Daily Total" row
          const lunchOverride  = weekOverrides.find(
            o => o.location_id === locId && o.forecast_date === dk && o.shift_type === 'lunch',
          );
          const dinnerOverride = weekOverrides.find(
            o => o.location_id === locId && o.forecast_date === dk && o.shift_type === 'dinner',
          );
          const total = computeDailyTotal(dk, lunchS, dinnerS, lunchOverride, dinnerOverride, ratios);
          result[store][dk] = { val: total, isActual: false };
        }
      }
    }
    return result;
  }, [
    locationIdByName, allForecastSettings, weekDays, closedSet,
    actualSalesByLocDate, simplyRatios, weekOverrides,
  ]);

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
        <h1 className="text-2xl font-bold text-gray-900">{t('inventory.usageForecast.title')}</h1>
        <p className="text-xs text-gray-400">Sales from Sales Reports · usage proportional to sales</p>
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
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Reload sales data"
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex items-center gap-4 text-xs font-medium">
          <span className="flex items-center gap-1.5 text-blue-600 font-semibold">
            <span className="w-3 h-3 rounded-full bg-blue-500" /> Actual (uploaded)
          </span>
          <span className="flex items-center gap-1.5 text-[#1B5E20] font-semibold">
            <span className="w-3 h-3 rounded-full bg-[#1B5E20]" /> Forecast
          </span>
          <span className="flex items-center gap-1.5 text-gray-400">
            — No data / closed
          </span>
          <span className="text-gray-400 italic text-[10px]">
            Click a sales cell to toggle closed
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
                    className="sticky left-0 z-20 bg-white border-r border-gray-200 px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
                    style={{ minWidth: ITEM_W }}
                    rowSpan={3}
                  >
                    Item
                  </th>
                  {weekDays.map((day, di) => {
                    const today = isToday(day);
                    const altBg = !today && di % 2 === 1 ? 'bg-gray-50' : '';
                    return (
                      <th
                        key={di}
                        colSpan={STORES.length}
                        className={`text-center font-bold text-sm py-2 border-l-2 border-gray-300 ${today ? 'bg-green-50 text-[#1B5E20]' : `text-gray-700 ${altBg}`}`}
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

                {/* ── Row 2: Net sales per store (matches Sales Reports Daily Total exactly) ── */}
                <tr className="border-b border-gray-100">
                  {weekDays.map((day, di) => {
                    const today = isToday(day);
                    const dk = dateKey(day);
                    const altBg = !today && di % 2 === 1 ? 'bg-gray-50' : '';
                    return STORES.map((store, si) => {
                      const locId    = locationIdByName[store];
                      const entry    = dailySalesByStore[store][dk];
                      const isClosed = entry === null;
                      const isActual = !isClosed && entry?.isActual === true;
                      const salesVal = entry?.val ?? 0;
                      const hasVal   = !isClosed && salesVal > 0;
                      return (
                        <th
                          key={`${di}-${si}`}
                          onClick={() => locId && handleToggleClosure(locId, dk, isClosed)}
                          className={`text-center py-1 px-1 font-semibold text-[10px] cursor-pointer select-none transition-colors ${
                            si === 0 ? 'border-l-2 border-gray-300' : 'border-l border-gray-100'
                          } ${today ? 'bg-green-50/60' : altBg} ${
                            isClosed
                              ? 'bg-red-50 text-red-400 hover:bg-red-100'
                              : isActual
                                ? 'text-blue-600 hover:bg-blue-50'
                                : hasVal
                                  ? 'text-[#1B5E20] hover:bg-green-50'
                                  : 'text-gray-300 hover:bg-gray-50'
                          }`}
                          style={{ minWidth: COL_W }}
                          title={
                            isClosed   ? `${store} is closed — click to reopen` :
                            isActual   ? `${store}: actual net sales — click to mark closed` :
                                         `${store}: forecasted net sales — click to mark closed`
                          }
                        >
                          {isClosed ? '🚫' : hasVal ? `€${(salesVal / 1000).toFixed(1)}k` : '—'}
                        </th>
                      );
                    });
                  })}
                </tr>

                {/* ── Row 3: Store name sub-headers ── */}
                <tr className="border-b-2 border-gray-200">
                  {weekDays.map((day, di) => {
                    const today = isToday(day);
                    const altBg = !today && di % 2 === 1 ? 'bg-gray-50' : '';
                    return STORES.map((store, si) => (
                      <th
                        key={`${di}-${si}-label`}
                        className={`text-center py-1.5 px-1 font-semibold text-[10px] uppercase tracking-wide ${
                          si === 0 ? 'border-l-2 border-gray-300' : 'border-l border-gray-100'
                        } ${today ? 'bg-green-50/40 text-[#1B5E20]/70' : `text-gray-400 ${altBg}`}`}
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
                          const altBg = !today && di % 2 === 1 ? 'bg-gray-50/60' : '';
                          return STORES.map((store, si) => {
                            const entry = dailySalesByStore[store][dk];
                            const salesVal = entry?.val ?? 0;
                            const usage = (entry !== null && entry !== undefined && salesVal > 0)
                              ? forecastUsage(item.item_name, si, salesVal) : null;
                            return (
                              <td
                                key={`${di}-${si}`}
                                className={`text-center py-2 px-1 ${
                                  si === 0 ? 'border-l-2 border-gray-300' : 'border-l border-gray-100'
                                } ${today ? 'bg-green-50/20' : altBg}`}
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
        Sales figures match the Daily Total row in Sales Reports exactly (OB + Simply + Bills, actual or forecast).
        Item quantities are proportional to forecasted sales — connect recipe/BOM data for precise amounts.
      </p>
    </div>
  );
}
