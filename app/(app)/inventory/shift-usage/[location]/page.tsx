'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { useT } from '@/lib/i18n';

/* ── Canonical sort order (mirrors other inventory pages) ─────────────────── */
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

/* ── Shift usage row type ───────────────────────────────────────────────── */
type ShiftUsageRow = {
  location_name: string;
  usage_date: string;
  shift: 'lunch' | 'dinner';
  item_name: string;
  quantity: number;
};

/* ── Local state key helpers ─────────────────────────────────────────────── */
function cellKey(date: string, shift: 'lunch' | 'dinner', itemName: string): string {
  return `${date}|${shift}|${itemName}`;
}

/* ── Main page ───────────────────────────────────────────────────────────── */
export default function ShiftUsagePage() {
  const { t } = useT();
  const router = useRouter();
  const params = useParams();
  const locationSlug = (params?.location as string) ?? '';
  // Capitalize first letter for display (westend → Westend)
  const locationName = locationSlug.charAt(0).toUpperCase() + locationSlug.slice(1);

  const [weekOffset, setWeekOffset] = useState(0);
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);

  const weekStart = weekDays[0] ? dateKey(weekDays[0]) : '';
  const weekEnd   = weekDays[6] ? dateKey(weekDays[6]) : '';

  const queryClient = useQueryClient();

  /* ── Load items from delivery_run_lines ── */
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

  /* ── Load existing shift_usage data for this week + location ── */
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

  /* ── Build saved values map: cellKey → quantity ── */
  const savedMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of savedRows) {
      m[cellKey(r.usage_date, r.shift, r.item_name)] = r.quantity;
    }
    return m;
  }, [savedRows]);

  /* ── Local edits (overrides saved values while editing) ── */
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({});

  /* ── Save mutation ── */
  const saveMutation = useMutation({
    mutationFn: async ({ date, shift, itemName, quantity }: {
      date: string; shift: 'lunch' | 'dinner'; itemName: string; quantity: number;
    }) => {
      const { error } = await supabase
        .from('shift_usage')
        .upsert({
          location_name: locationName,
          usage_date: date,
          shift,
          item_name: itemName,
          quantity,
        }, { onConflict: 'location_name,usage_date,shift,item_name' });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-usage-data', locationName, weekStart, weekEnd] });
    },
  });

  /* ── Get display value for a cell ── */
  const getCellValue = useCallback((date: string, shift: 'lunch' | 'dinner', itemName: string): string => {
    const k = cellKey(date, shift, itemName);
    if (k in localEdits) return localEdits[k];
    const saved = savedMap[k];
    return saved !== undefined && saved !== 0 ? String(saved) : '';
  }, [localEdits, savedMap]);

  /* ── Handle cell change ── */
  const handleChange = useCallback((date: string, shift: 'lunch' | 'dinner', itemName: string, value: string) => {
    const k = cellKey(date, shift, itemName);
    setLocalEdits(prev => ({ ...prev, [k]: value }));
  }, []);

  /* ── Handle cell blur → save ── */
  const handleBlur = useCallback((date: string, shift: 'lunch' | 'dinner', itemName: string) => {
    const k = cellKey(date, shift, itemName);
    const raw = localEdits[k];
    if (raw === undefined) return; // not edited
    const quantity = parseFloat(raw) || 0;
    setLocalEdits(prev => { const n = { ...prev }; delete n[k]; return n; });
    saveMutation.mutate({ date, shift, itemName, quantity });
  }, [localEdits, saveMutation]);

  /* ── Get total for a cell (lunch + dinner) ── */
  const getTotal = useCallback((date: string, itemName: string): number => {
    const lunchVal = parseFloat(getCellValue(date, 'lunch', itemName)) || 0;
    const dinnerVal = parseFloat(getCellValue(date, 'dinner', itemName)) || 0;
    return lunchVal + dinnerVal;
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

  /* ── Column widths ── */
  const ITEM_W = 180;
  const SUB_W = 52; // width per sub-column (Lunch, Dinner, Total)

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/inventory/usage-forecast')}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          title="Back to Usage Forecast"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('inventory.shiftUsage.title')} — {locationName}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">{t('inventory.shiftUsage.subtitle')}</p>
        </div>
      </div>

      {/* ── Week navigation ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-3 flex items-center gap-3">
        <button
          onClick={() => setWeekOffset(w => w - 1)}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-gray-800 w-40 text-center">
          {fmtWeekRange(weekDays)}
        </span>
        <button
          onClick={() => setWeekOffset(w => w + 1)}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <ChevronRight size={16} />
        </button>
        {weekOffset !== 0 && (
          <button
            onClick={() => setWeekOffset(0)}
            className="text-xs text-[#1B5E20] hover:underline font-medium"
          >
            Today
          </button>
        )}

        <div className="ml-auto flex items-center gap-4 text-xs font-medium text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />
            {t('inventory.shiftUsage.lunch')}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
            {t('inventory.shiftUsage.dinner')}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#1B5E20] inline-block" />
            {t('inventory.shiftUsage.total')}
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
            <table
              className="text-xs border-collapse"
              style={{ minWidth: ITEM_W + 7 * 3 * SUB_W }}
            >
              <thead>
                {/* ── Row 1: Day headers ── */}
                <tr className="border-b border-gray-100">
                  <th
                    className="sticky left-0 z-20 bg-white border-r border-gray-200 px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
                    style={{ minWidth: ITEM_W }}
                    rowSpan={2}
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

                {/* ── Row 2: Lunch / Dinner / Total sub-headers ── */}
                <tr className="border-b-2 border-gray-200">
                  {weekDays.map((day, di) => {
                    const today = isTodayDate(day);
                    return (
                      <>
                        <th
                          key={`${di}-lunch`}
                          className={`text-center py-1.5 text-[9px] font-bold uppercase tracking-wide border-l-2 border-gray-300 text-orange-500 ${
                            today ? 'bg-green-50/40' : ''
                          }`}
                          style={{ minWidth: SUB_W }}
                        >
                          {t('inventory.shiftUsage.lunch')}
                        </th>
                        <th
                          key={`${di}-dinner`}
                          className={`text-center py-1.5 text-[9px] font-bold uppercase tracking-wide border-l border-gray-100 text-indigo-500 ${
                            today ? 'bg-green-50/40' : ''
                          }`}
                          style={{ minWidth: SUB_W }}
                        >
                          {t('inventory.shiftUsage.dinner')}
                        </th>
                        <th
                          key={`${di}-total`}
                          className={`text-center py-1.5 text-[9px] font-bold uppercase tracking-wide border-l border-gray-100 text-[#1B5E20] ${
                            today ? 'bg-green-50/40' : 'bg-gray-50/50'
                          }`}
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
                    {/* Section header */}
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

                    {/* Item rows */}
                    {items.map(item => (
                      <tr
                        key={item.item_name}
                        className="border-b border-gray-50 hover:bg-gray-50/40 transition-colors"
                      >
                        {/* Sticky item name */}
                        <td
                          className="sticky left-0 z-10 bg-white border-r border-gray-100 px-4 py-1.5"
                          style={{ minWidth: ITEM_W }}
                        >
                          <div className="font-medium text-gray-800 text-xs leading-tight">
                            {item.item_name}
                          </div>
                          <div className="text-gray-400 text-[10px] mt-0.5">{item.unit}</div>
                        </td>

                        {/* 7 days × 3 sub-columns */}
                        {weekDays.map((day, di) => {
                          const dk = dateKey(day);
                          const today = isTodayDate(day);
                          const lunchVal = getCellValue(dk, 'lunch', item.item_name);
                          const dinnerVal = getCellValue(dk, 'dinner', item.item_name);
                          const total = getTotal(dk, item.item_name);

                          return (
                            <>
                              {/* Lunch */}
                              <td
                                key={`${di}-lunch`}
                                className={`text-center py-1 px-1 border-l-2 border-gray-300 ${
                                  today ? 'bg-green-50/10' : ''
                                }`}
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

                              {/* Dinner */}
                              <td
                                key={`${di}-dinner`}
                                className={`text-center py-1 px-1 border-l border-gray-100 ${
                                  today ? 'bg-green-50/10' : ''
                                }`}
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

                              {/* Total (calculated) */}
                              <td
                                key={`${di}-total`}
                                className={`text-center py-1 px-1 border-l border-gray-100 ${
                                  today ? 'bg-green-50/20' : 'bg-gray-50/40'
                                }`}
                                style={{ minWidth: SUB_W }}
                              >
                                {total > 0 ? (
                                  <span className="font-bold text-xs text-[#1B5E20]">{total}</span>
                                ) : (
                                  <span className="text-gray-300 text-xs">—</span>
                                )}
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

      <p className="text-xs text-gray-400">
        {t('inventory.shiftUsage.hint')}
      </p>
    </div>
  );
}
