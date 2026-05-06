'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { useT } from '@/lib/i18n';
import {
  computeSimplyRatios,
  computeDailyForecast,
  currentQuarterRange,
  type ForecastSettings,
  type ForecastOverride,
  type ShiftRowLite,
  type DelivRowLite,
} from '@/lib/forecast-utils';

/* ── Canonical sort order ─────────────────────────────────────────────────── */
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

/* ── Date helpers ─────────────────────────────────────────────────────────── */
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

function dateKey(d: Date): string {
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

function isTodayDate(d: Date) {
  const t = new Date();
  return d.getFullYear() === t.getFullYear()
    && d.getMonth() === t.getMonth()
    && d.getDate() === t.getDate();
}

/* ── Types ────────────────────────────────────────────────────────────────── */
type ShiftUsageRow = {
  location_name: string;
  usage_date: string;
  shift: 'lunch' | 'dinner';
  item_name: string;
  quantity: number;
};

type DayShiftSales = {
  lunch: number;
  lunchIsActual: boolean; // true = uploaded, false = forecast
  dinner: number;
  dinnerIsActual: boolean; // true = uploaded, false = forecast
} | null; // null = no settings / no data

function cellKey(date: string, shift: 'lunch' | 'dinner', itemName: string): string {
  return `${date}|${shift}|${itemName}`;
}

/* ── Main page ────────────────────────────────────────────────────────────── */
export default function ShiftUsagePage() {
  const { t } = useT();
  const router = useRouter();
  const params = useParams();
  const locationSlug = (params?.location as string) ?? '';
  const locationName = locationSlug.charAt(0).toUpperCase() + locationSlug.slice(1);

  const [weekOffset, setWeekOffset] = useState(0);
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);
  const weekStart = weekDays[0] ? dateKey(weekDays[0]) : '';
  const weekEnd   = weekDays[6] ? dateKey(weekDays[6]) : '';

  const queryClient = useQueryClient();
  const { qStart, qEnd } = useMemo(() => currentQuarterRange(), []);

  /* ── Locations (to resolve name → id) ── */
  const { data: locations = [] } = useQuery({
    queryKey: ['locations-shift-usage'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').eq('is_active', true);
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const locId = useMemo(
    () => locations.find(l => l.name === locationName)?.id ?? null,
    [locations, locationName],
  );

  /* ── Forecast settings for this location ── */
  const { data: forecastSettings = [] } = useQuery({
    queryKey: ['forecast-settings-shift', locId],
    enabled: !!locId,
    queryFn: async () => {
      const { data } = await supabase
        .from('forecast_settings')
        .select('location_id,shift_type,week_base_net,growth_rate,weight_mon,weight_tue,weight_wed,weight_thu,weight_fri,weight_sat,weight_sun,closed_weekdays')
        .eq('location_id', locId!);
      return (data ?? []) as ForecastSettings[];
    },
  });

  const lunchSettings  = forecastSettings.find(s => s.shift_type === 'lunch');
  const dinnerSettings = forecastSettings.find(s => s.shift_type === 'dinner');

  /* ── Quarter shift_reports (for Simply ratio) ── */
  const { data: qShiftRows = [] } = useQuery({
    queryKey: ['q-shift-rows-shift-usage', qStart, qEnd, locId],
    enabled: !!locId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('shift_reports')
        .select('location_id, report_date, shift_type, net_total, z_report_number')
        .eq('location_id', locId!)
        .gte('report_date', qStart)
        .lte('report_date', qEnd);
      return (data ?? []) as ShiftRowLite[];
    },
  });

  /* ── Quarter delivery_reports (for Simply ratio) ── */
  const { data: qDelivRows = [] } = useQuery({
    queryKey: ['q-deliv-rows-shift-usage', qStart, qEnd, locId],
    enabled: !!locId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('delivery_reports')
        .select('location_id, report_date, shift_type, net_revenue')
        .eq('location_id', locId!)
        .gte('report_date', qStart)
        .lte('report_date', qEnd);
      return (data ?? []) as DelivRowLite[];
    },
  });

  /* ── Simply ratios ── */
  const simplyRatios = useMemo(
    () => computeSimplyRatios(qShiftRows, qDelivRows),
    [qShiftRows, qDelivRows],
  );
  const ratios = useMemo(
    () => (locId ? (simplyRatios[locId] ?? { lunch: 0, dinner: 0 }) : { lunch: 0, dinner: 0 }),
    [simplyRatios, locId],
  );

  /* ── Week actual shift_reports (with shift_type for lunch/dinner split) ── */
  const { data: weekShiftRows = [] } = useQuery({
    queryKey: ['shift-reports-week-shift-usage', weekStart, weekEnd, locId],
    enabled: !!weekStart && !!locId,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('shift_reports')
        .select('location_id, report_date, shift_type, net_total, z_report_number')
        .eq('location_id', locId!)
        .gte('report_date', weekStart)
        .lte('report_date', weekEnd);
      return (data ?? []) as ShiftRowLite[];
    },
  });

  /* ── Week actual delivery_reports ── */
  const { data: weekDelivRows = [] } = useQuery({
    queryKey: ['delivery-reports-week-shift-usage', weekStart, weekEnd, locId],
    enabled: !!weekStart && !!locId,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('delivery_reports')
        .select('location_id, report_date, shift_type, net_revenue')
        .eq('location_id', locId!)
        .gte('report_date', weekStart)
        .lte('report_date', weekEnd);
      return (data ?? []) as DelivRowLite[];
    },
  });

  /* ── Week forecast overrides ── */
  const { data: weekOverrides = [] } = useQuery({
    queryKey: ['forecast-overrides-shift-usage', weekStart, weekEnd, locId],
    enabled: !!weekStart && !!locId,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('forecast_overrides')
        .select('location_id, forecast_date, shift_type, net_revenue')
        .eq('location_id', locId!)
        .gte('forecast_date', weekStart)
        .lte('forecast_date', weekEnd);
      return (data ?? []) as ForecastOverride[];
    },
  });

  /* ── Compute per-day, per-shift sales ─────────────────────────────────────
   *
   * Each shift is evaluated independently:
   *   - If OB data exists for that shift → actual (blue)
   *   - Otherwise → forecast (green)
   *
   * This means within a single day, lunch can be blue (uploaded) while
   * dinner is still green (forecast, not yet done).
   */
  const salesByDay = useMemo((): Record<string, DayShiftSales> => {
    const m: Record<string, DayShiftSales> = {};

    // Determine which OB shifts are uploaded per date
    const obByDate: Record<string, ShiftRowLite[]> = {};
    for (const r of weekShiftRows) {
      if (!obByDate[r.report_date]) obByDate[r.report_date] = [];
      obByDate[r.report_date].push(r);
    }

    for (const day of weekDays) {
      const dk = dateKey(day);
      const obRows = obByDate[dk] ?? [];

      // Determine which OB shifts exist for this date
      let obLunchActual = 0, obDinnerActual = 0;
      let hasObLunch = false, hasObDinner = false;

      if (obRows.length > 0) {
        const allTagged = obRows.every(r => r.shift_type === 'lunch' || r.shift_type === 'dinner');
        if (allTagged) {
          for (const r of obRows) {
            if (r.shift_type === 'lunch') { obLunchActual += r.net_total ?? 0; hasObLunch = true; }
            else                          { obDinnerActual += r.net_total ?? 0; hasObDinner = true; }
          }
        } else {
          // Legacy Z-report order: first = lunch, second = dinner
          const sorted = [...obRows].sort(
            (a, b) => parseInt(a.z_report_number || '0', 10) - parseInt(b.z_report_number || '0', 10),
          );
          if (sorted[0]) { obLunchActual  += sorted[0].net_total ?? 0; hasObLunch  = true; }
          if (sorted[1]) { obDinnerActual += sorted[1].net_total ?? 0; hasObDinner = true; }
        }
      }

      // Simply actuals for this date (split by shift_type)
      let simLunchActual = 0, simDinnerActual = 0;
      for (const r of weekDelivRows) {
        if (r.report_date !== dk) continue;
        if (r.shift_type === 'dinner') simDinnerActual += r.net_revenue ?? 0;
        else                           simLunchActual  += r.net_revenue ?? 0;
      }

      // Forecast overrides
      const lunchOverride  = weekOverrides.find(o => o.forecast_date === dk && o.shift_type === 'lunch');
      const dinnerOverride = weekOverrides.find(o => o.forecast_date === dk && o.shift_type === 'dinner');

      // ── Lunch: actual if OB uploaded, otherwise forecast ──
      let lunchVal: number;
      let lunchIsActual: boolean;
      if (hasObLunch) {
        lunchVal      = obLunchActual + simLunchActual;
        lunchIsActual = true;
      } else {
        const lOB = lunchOverride?.net_revenue
          ?? (lunchSettings ? computeDailyForecast(dk, lunchSettings) : 0);
        lunchVal      = Math.round(lOB + lOB * ratios.lunch);
        lunchIsActual = false;
      }

      // ── Dinner: actual if OB uploaded, otherwise forecast ──
      let dinnerVal: number;
      let dinnerIsActual: boolean;
      if (hasObDinner) {
        dinnerVal      = obDinnerActual + simDinnerActual;
        dinnerIsActual = true;
      } else {
        const dOB = dinnerOverride?.net_revenue
          ?? (dinnerSettings ? computeDailyForecast(dk, dinnerSettings) : 0);
        dinnerVal      = Math.round(dOB + dOB * ratios.dinner);
        dinnerIsActual = false;
      }

      if (lunchVal === 0 && dinnerVal === 0) {
        m[dk] = null;
      } else {
        m[dk] = { lunch: lunchVal, lunchIsActual, dinner: dinnerVal, dinnerIsActual };
      }
    }

    return m;
  }, [weekDays, weekShiftRows, weekDelivRows, weekOverrides, lunchSettings, dinnerSettings, ratios]);

  /* ── Shift usage item data ── */
  const { data: rawItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['shift-usage-items'],
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

  /* ── Saved shift_usage rows ── */
  const { data: savedRows = [] } = useQuery({
    queryKey: ['shift-usage-data', locationName, weekStart, weekEnd],
    enabled: !!weekStart && !!locationName,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('shift_usage')
        .select('location_name, usage_date, shift, item_name, quantity')
        .eq('location_name', locationName)
        .gte('usage_date', weekStart)
        .lte('usage_date', weekEnd);
      return (data ?? []) as ShiftUsageRow[];
    },
  });

  const savedMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of savedRows) m[cellKey(r.usage_date, r.shift, r.item_name)] = r.quantity;
    return m;
  }, [savedRows]);

  const [localEdits, setLocalEdits] = useState<Record<string, string>>({});

  const saveMutation = useMutation({
    mutationFn: async ({ date, shift, itemName, quantity }: {
      date: string; shift: 'lunch' | 'dinner'; itemName: string; quantity: number;
    }) => {
      const { error } = await supabase
        .from('shift_usage')
        .upsert(
          { location_name: locationName, usage_date: date, shift, item_name: itemName, quantity },
          { onConflict: 'location_name,usage_date,shift,item_name' },
        );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-usage-data', locationName, weekStart, weekEnd] });
    },
  });

  const getCellValue = useCallback((date: string, shift: 'lunch' | 'dinner', itemName: string): string => {
    const k = cellKey(date, shift, itemName);
    if (k in localEdits) return localEdits[k];
    const saved = savedMap[k];
    return saved !== undefined && saved !== 0 ? String(saved) : '';
  }, [localEdits, savedMap]);

  const handleChange = useCallback((date: string, shift: 'lunch' | 'dinner', itemName: string, value: string) => {
    setLocalEdits(prev => ({ ...prev, [cellKey(date, shift, itemName)]: value }));
  }, []);

  const handleBlur = useCallback((date: string, shift: 'lunch' | 'dinner', itemName: string) => {
    const k = cellKey(date, shift, itemName);
    const raw = localEdits[k];
    if (raw === undefined) return;
    const quantity = parseFloat(raw) || 0;
    setLocalEdits(prev => { const n = { ...prev }; delete n[k]; return n; });
    saveMutation.mutate({ date, shift, itemName, quantity });
  }, [localEdits, saveMutation]);

  const getTotal = useCallback((date: string, itemName: string): number => {
    return (parseFloat(getCellValue(date, 'lunch', itemName)) || 0)
         + (parseFloat(getCellValue(date, 'dinner', itemName)) || 0);
  }, [getCellValue]);

  /* ── Group items by section ── */
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

  const ITEM_W = 180;
  const SUB_W  = 52;
  const STORES_NAV = ['Westend', 'Eschborn', 'Taunus'] as const;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('inventory.shiftUsage.title')} — {locationName}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">{t('inventory.shiftUsage.subtitle')}</p>
        </div>
      </div>

      {/* ── Store nav buttons ── */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push('/inventory/usage-forecast')}
          className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-300 text-gray-500 hover:bg-gray-100 transition-colors"
        >
          {t('inventory.shiftUsage.groupBtn')}
        </button>
        <span className="text-gray-300 text-sm">|</span>
        {STORES_NAV.map(store => {
          const isActive = store.toLowerCase() === locationSlug.toLowerCase();
          return (
            <button
              key={store}
              onClick={() => router.push(`/inventory/shift-usage/${store.toLowerCase()}`)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                isActive
                  ? 'bg-[#1B5E20] border-[#1B5E20] text-white'
                  : 'border-[#1B5E20] text-[#1B5E20] hover:bg-[#1B5E20] hover:text-white'
              }`}
            >
              {store}
            </button>
          );
        })}
      </div>

      {/* ── Week navigation ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-3 flex items-center gap-3">
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

        <div className="ml-auto flex items-center gap-4 text-xs font-medium">
          <span className="flex items-center gap-1.5 text-blue-600 font-semibold">
            <span className="w-3 h-3 rounded-full bg-blue-500" /> Actual (uploaded)
          </span>
          <span className="flex items-center gap-1.5 text-red-500 font-semibold">
            <span className="w-3 h-3 rounded-full bg-red-500" /> Forecast
          </span>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {itemsLoading ? (
          <div className="p-8 space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse" style={{ minWidth: ITEM_W + 7 * 3 * SUB_W }}>
              <thead>
                {/* ── Row 1: Day headers ── */}
                <tr className="border-b border-gray-100">
                  <th
                    className="sticky left-0 z-20 bg-white border-r border-gray-200 px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
                    style={{ minWidth: ITEM_W }}
                    rowSpan={3}
                  >
                    {t('inventory.shiftUsage.item')}
                  </th>
                  {weekDays.map((day, di) => {
                    const today = isTodayDate(day);
                    return (
                      <th
                        key={di}
                        colSpan={3}
                        className={`text-center font-bold text-[11px] py-2 border-l-2 border-gray-300 ${
                          today ? 'bg-green-50 text-[#1B5E20]' : 'text-gray-700'
                        }`}
                        style={{ minWidth: SUB_W * 3 }}
                      >
                        {fmtDayHeader(day)}
                        {today && (
                          <span className="ml-1.5 text-[9px] font-semibold bg-[#1B5E20] text-white rounded-full px-1.5 py-0.5">
                            Today
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>

                {/* ── Row 2: Net sales per shift (each shift coloured independently) ──
                 *  Blue  = actual uploaded data for that shift
                 *  Green = forecast (shift not yet uploaded)
                 */}
                <tr className="border-b border-gray-100">
                  {weekDays.map((day, di) => {
                    const today = isTodayDate(day);
                    const dk    = dateKey(day);
                    const entry = salesByDay[dk];

                    const lunchVal      = entry?.lunch  ?? 0;
                    const dinnerVal     = entry?.dinner ?? 0;
                    const totalVal      = lunchVal + dinnerVal;
                    const lunchIsActual  = entry?.lunchIsActual  ?? false;
                    const dinnerIsActual = entry?.dinnerIsActual ?? false;
                    // Total colour: blue when lunch is actual AND dinner is either actual or has no value (no dinner shift that day)
                    const totalIsActual  = lunchIsActual && (dinnerIsActual || dinnerVal === 0);

                    const altBg = !today && di % 2 === 1 ? 'bg-gray-50/50' : '';
                    const fmt   = (v: number) => v > 0 ? `€${(v / 1000).toFixed(1)}k` : '—';

                    return (
                      <>
                        <th
                          key={`${di}-sales-lunch`}
                          className={`text-center py-1 px-1 font-semibold text-[10px] border-l-2 border-gray-300 ${
                            lunchIsActual ? 'text-blue-600' : 'text-red-500'
                          } ${today ? (lunchIsActual ? 'bg-blue-50/30' : 'bg-red-50/40') : altBg}`}
                          style={{ minWidth: SUB_W }}
                        >
                          {fmt(lunchVal)}
                        </th>
                        <th
                          key={`${di}-sales-dinner`}
                          className={`text-center py-1 px-1 font-semibold text-[10px] border-l border-gray-100 ${
                            dinnerIsActual ? 'text-blue-600' : 'text-red-500'
                          } ${today ? (dinnerIsActual ? 'bg-blue-50/30' : 'bg-red-50/40') : altBg}`}
                          style={{ minWidth: SUB_W }}
                        >
                          {fmt(dinnerVal)}
                        </th>
                        <th
                          key={`${di}-sales-total`}
                          className={`text-center py-1 px-1 font-semibold text-[10px] border-l border-gray-100 ${
                            totalIsActual ? 'text-blue-600' : 'text-red-500'
                          } ${today ? (totalIsActual ? 'bg-blue-50/30' : 'bg-red-50/40') : altBg}`}
                          style={{ minWidth: SUB_W }}
                        >
                          {fmt(totalVal)}
                        </th>
                      </>
                    );
                  })}
                </tr>

                {/* ── Row 3: Lunch / Dinner / Total sub-headers ── */}
                <tr className="border-b-2 border-gray-200">
                  {weekDays.map((day, di) => {
                    const today = isTodayDate(day);
                    return (
                      <>
                        <th
                          key={`${di}-lbl-lunch`}
                          className={`text-center py-1.5 text-[9px] font-bold uppercase tracking-wide border-l-2 border-gray-300 text-gray-700 ${today ? 'bg-green-50/40' : ''}`}
                          style={{ minWidth: SUB_W }}
                        >
                          {t('inventory.shiftUsage.lunch')}
                        </th>
                        <th
                          key={`${di}-lbl-dinner`}
                          className={`text-center py-1.5 text-[9px] font-bold uppercase tracking-wide border-l border-gray-100 text-gray-700 ${today ? 'bg-green-50/40' : ''}`}
                          style={{ minWidth: SUB_W }}
                        >
                          {t('inventory.shiftUsage.dinner')}
                        </th>
                        <th
                          key={`${di}-lbl-total`}
                          className={`text-center py-1.5 text-[9px] font-bold uppercase tracking-wide border-l border-gray-100 text-gray-700 ${today ? 'bg-green-50/40' : 'bg-gray-50/50'}`}
                          style={{ minWidth: SUB_W }}
                        >
                          {t('inventory.shiftUsage.total')}
                        </th>
                      </>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {sections.map(([section, items]) => (
                  <>
                    <tr key={`sec-${section}`} className="bg-gray-50 border-y border-gray-100">
                      <td
                        className="sticky left-0 z-10 bg-gray-50 px-4 py-1.5 border-r border-gray-100"
                        colSpan={1 + 7 * 3}
                      >
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                          {section}
                        </span>
                      </td>
                    </tr>

                    {items.map(item => (
                      <tr key={item.item_name} className="border-b border-gray-50 hover:bg-gray-50/40 transition-colors">
                        <td
                          className="sticky left-0 z-10 bg-white border-r border-gray-100 px-4 py-1.5"
                          style={{ minWidth: ITEM_W }}
                        >
                          <div className="font-medium text-gray-800 text-xs leading-tight">{item.item_name}</div>
                          <div className="text-gray-400 text-[10px] mt-0.5">{item.unit}</div>
                        </td>

                        {weekDays.map((day, di) => {
                          const dk = dateKey(day);
                          const today = isTodayDate(day);
                          const lunchVal  = getCellValue(dk, 'lunch',  item.item_name);
                          const dinnerVal = getCellValue(dk, 'dinner', item.item_name);
                          const total     = getTotal(dk, item.item_name);

                          return (
                            <>
                              <td
                                key={`${di}-lunch`}
                                className={`text-center py-1 px-1 border-l-2 border-gray-300 ${today ? 'bg-green-50/10' : ''}`}
                                style={{ minWidth: SUB_W }}
                              >
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={lunchVal}
                                  onChange={e => handleChange(dk, 'lunch', item.item_name, e.target.value)}
                                  onBlur={() => handleBlur(dk, 'lunch', item.item_name)}
                                  className="w-full text-center text-xs font-semibold text-orange-600 bg-transparent border border-transparent hover:border-orange-200 focus:border-orange-400 focus:outline-none rounded px-0.5 py-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  placeholder="—"
                                />
                              </td>
                              <td
                                key={`${di}-dinner`}
                                className={`text-center py-1 px-1 border-l border-gray-100 ${today ? 'bg-green-50/10' : ''}`}
                                style={{ minWidth: SUB_W }}
                              >
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={dinnerVal}
                                  onChange={e => handleChange(dk, 'dinner', item.item_name, e.target.value)}
                                  onBlur={() => handleBlur(dk, 'dinner', item.item_name)}
                                  className="w-full text-center text-xs font-semibold text-indigo-600 bg-transparent border border-transparent hover:border-indigo-200 focus:border-indigo-400 focus:outline-none rounded px-0.5 py-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  placeholder="—"
                                />
                              </td>
                              <td
                                key={`${di}-total`}
                                className={`text-center py-1 px-1 border-l border-gray-100 ${today ? 'bg-green-50/20' : 'bg-gray-50/40'}`}
                                style={{ minWidth: SUB_W }}
                              >
                                {total > 0
                                  ? <span className="font-bold text-xs text-[#1B5E20]">{total}</span>
                                  : <span className="text-gray-300 text-xs">—</span>
                                }
                              </td>
                            </>
                          );
                        })}
                      </tr>
                    ))}
                  </>
                ))}

                {sections.length === 0 && (
                  <tr>
                    <td colSpan={1 + 7 * 3} className="text-center py-12 text-gray-400 text-sm">
                      {t('inventory.shiftUsage.noItems')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">{t('inventory.shiftUsage.hint')}</p>
    </div>
  );
}
