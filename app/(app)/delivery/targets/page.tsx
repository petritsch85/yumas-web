'use client';

import React, { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { Upload, Target } from 'lucide-react';
import * as XLSX from 'xlsx';

/* ─── Types ─────────────────────────────────────────────────────────────── */
type TargetRow = {
  id: string;
  location_name: string;
  section: string;
  item_name: string;
  unit: string;
  mon_target: number;
  tue_target: number;
  wed_target: number;
  fri_target: number;
  scales_with_demand: boolean;
};

type ParsedItem = {
  section: string;
  item_name: string;
  unit: string;
  mon_target: number;
  tue_target: number;
  wed_target: number;
  fri_target: number;
};

type SalesForecast = {
  location_name: string;
  forecast_date: string;
  forecasted_sales_eur: number;
};

type DayStandard = {
  location_name: string;
  day_of_week: string;
  standard_sales_eur: number;
};

type InventorySubmission = {
  id: string;
  location_name: string;
  submitted_at: string;
  data: Array<{ section: string; name: string; unit: string; quantity: number }>;
};

/* ─── Constants ──────────────────────────────────────────────────────────── */
const STORES = ['Eschborn', 'Taunus', 'Westend'] as const;
type Store = typeof STORES[number];

const SECTIONS = ['Kühlhaus', 'Tiefkühler', 'Trockenware', 'Regale', 'Lager'];

const DAY_KEYS = ['mon', 'tue', 'wed', 'fri'] as const;
type DayKey = typeof DAY_KEYS[number];
const DAY_LABELS = ['MON', 'TUE', 'WED', 'FRI'];
const BASE_TARGET_COLS = ['mon_target', 'tue_target', 'wed_target', 'fri_target'] as const;

/* ─── Week helpers ───────────────────────────────────────────────────────── */
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getISOWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}

function getMondayOfISOWeek(week: number, year: number): Date {
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - jan4Day + (week - 1) * 7);
  return monday;
}

function getDeliveryDays(monday: Date): Date[] {
  return [0, 1, 2, 4].map(offset => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + offset);
    return d;
  });
}

function fmtDayMonth(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtWeekLabel(week: number, year: number): string {
  const monday = getMondayOfISOWeek(week, year);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `KW${week} — ${monday.getDate()}. ${months[monday.getMonth()]} – ${friday.getDate()}. ${months[friday.getMonth()]} ${year}`;
}

type WeekOption = { week: number; year: number; key: string; label: string };

function buildWeekOptions(): WeekOption[] {
  const today = new Date();
  const currentWeek = getISOWeek(today);
  const currentYear = getISOWeekYear(today);

  const options: WeekOption[] = [];
  // 4 weeks back, current, 8 weeks forward = 13 total
  for (let offset = -4; offset <= 8; offset++) {
    let w = currentWeek + offset;
    let y = currentYear;
    // Handle year boundaries (simplified: max weeks ~52–53)
    while (w < 1) {
      y -= 1;
      // Approximate: use 52 weeks per year
      w += 52;
    }
    while (w > 52) {
      // Check if week 53 exists for this year (simplified: just roll over)
      const dec28 = new Date(y, 11, 28);
      const maxWeek = getISOWeek(dec28);
      if (w > maxWeek) {
        w -= maxWeek;
        y += 1;
      } else {
        break;
      }
    }
    options.push({
      week: w,
      year: y,
      key: `${y}-W${String(w).padStart(2, '0')}`,
      label: fmtWeekLabel(w, y),
    });
  }
  return options;
}

/* ─── Toggle switch ──────────────────────────────────────────────────────── */
function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 ${
        checked ? 'bg-[#1B5E20]' : 'bg-gray-200'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

/* ─── Stock cell ─────────────────────────────────────────────────────────── */
function StockCell({ qty, submittedAt }: { qty: number | null; submittedAt: string | null }) {
  if (qty === null) {
    return <span className="text-gray-300 text-sm">—</span>;
  }
  const asOf = submittedAt
    ? (() => {
        const d = new Date(submittedAt);
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return `${dayNames[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      })()
    : null;
  return (
    <div className="flex flex-col items-center leading-tight">
      <span className="text-sm text-gray-800">{qty}</span>
      {asOf && <span className="text-[10px] text-gray-400 mt-0.5">{asOf}</span>}
    </div>
  );
}

/* ─── Target cell ────────────────────────────────────────────────────────── */
function TargetCell({ baseTarget, effectiveTarget, scale, hasForecast }: {
  baseTarget: number;
  effectiveTarget: number;
  scale: number;
  hasForecast: boolean;
}) {
  const scaleDiff = Math.abs(scale - 1.0) > 0.01;
  return (
    <div className="flex flex-col items-center leading-tight gap-0.5">
      <span className="text-sm text-gray-700">{effectiveTarget}</span>
      {!hasForecast && (
        <span className="text-[10px] text-gray-400 bg-gray-100 rounded px-1">std</span>
      )}
      {hasForecast && scaleDiff && (
        <span className={`text-[10px] font-medium rounded px-1 ${
          scale >= 1 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
        }`}>
          ×{scale.toFixed(1)}
        </span>
      )}
    </div>
  );
}

/* ─── Deliver cell ───────────────────────────────────────────────────────── */
function DeliverCell({ qty }: { qty: number }) {
  if (qty === 0) {
    return <span className="text-sm text-gray-300">0</span>;
  }
  return (
    <span className="text-sm font-semibold text-green-800 bg-green-50 rounded px-2 py-0.5">
      {qty}
    </span>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function DeliveryTargetsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const weekOptions = useMemo(() => buildWeekOptions(), []);
  // Default to current week (index 4 = offset 0)
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>(weekOptions[4].key);
  const [activeStore, setActiveStore] = useState<Store>('Eschborn');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [pendingScaleIds, setPendingScaleIds] = useState<Set<string>>(new Set());

  const selectedWeek = weekOptions.find(w => w.key === selectedWeekKey) ?? weekOptions[4];
  const monday = useMemo(
    () => getMondayOfISOWeek(selectedWeek.week, selectedWeek.year),
    [selectedWeek.week, selectedWeek.year]
  );
  const deliveryDays = useMemo(() => getDeliveryDays(monday), [monday]);
  const friday = deliveryDays[3];

  /* ─ Main query ─ */
  const { data: weekData, isLoading } = useQuery({
    queryKey: ['targets-weekly', activeStore, selectedWeekKey],
    queryFn: async () => {
      // Window for inventory: monday - 2 days to friday + 1 day
      const windowStart = new Date(monday);
      windowStart.setDate(monday.getDate() - 2);
      const windowEnd = new Date(friday);
      windowEnd.setDate(friday.getDate() + 1);

      const deliveryDateStrs = deliveryDays.map(fmtDateISO);

      const [targetsRes, standardsRes, forecastsRes, inventoryRes] = await Promise.all([
        supabase
          .from('delivery_targets')
          .select('*')
          .eq('location_name', activeStore)
          .order('section')
          .order('item_name'),
        supabase
          .from('store_day_standards')
          .select('*')
          .eq('location_name', activeStore),
        supabase
          .from('weekly_sales_forecasts')
          .select('*')
          .eq('location_name', activeStore)
          .in('forecast_date', deliveryDateStrs),
        supabase
          .from('inventory_submissions')
          .select('*')
          .eq('location_name', activeStore)
          .gte('submitted_at', windowStart.toISOString())
          .lt('submitted_at', windowEnd.toISOString()),
      ]);

      if (targetsRes.error) throw targetsRes.error;
      if (standardsRes.error) throw standardsRes.error;
      if (forecastsRes.error) throw forecastsRes.error;
      if (inventoryRes.error) throw inventoryRes.error;

      return {
        targets: (targetsRes.data ?? []) as TargetRow[],
        standards: (standardsRes.data ?? []) as DayStandard[],
        forecasts: (forecastsRes.data ?? []) as SalesForecast[],
        submissions: (inventoryRes.data ?? []) as InventorySubmission[],
      };
    },
  });

  const targets = weekData?.targets ?? [];
  const standards = weekData?.standards ?? [];
  const forecasts = weekData?.forecasts ?? [];
  const submissions = weekData?.submissions ?? [];

  /* ─ Compute per-day scaling factors ─ */
  const dayScales: { scale: number; hasForecast: boolean }[] = DAY_KEYS.map((dayKey, idx) => {
    const deliveryDate = fmtDateISO(deliveryDays[idx]);
    const standard = standards.find(s => s.day_of_week === dayKey);
    const forecast = forecasts.find(f => f.forecast_date === deliveryDate);
    if (!forecast || !standard || standard.standard_sales_eur === 0) {
      return { scale: 1.0, hasForecast: false };
    }
    return {
      scale: forecast.forecasted_sales_eur / standard.standard_sales_eur,
      hasForecast: true,
    };
  });

  /* ─ Compute per-day inventory lookup ─ */
  // For each delivery day, find latest submission within 48h before that date
  const dayStockMaps: Map<string, { qty: number; submittedAt: string }>[] = deliveryDays.map(deliveryDay => {
    const deliveryTs = deliveryDay.getTime();
    const windowStartTs = deliveryTs - 2 * 24 * 60 * 60 * 1000;
    // Filter submissions within the window
    const relevant = submissions.filter(sub => {
      const ts = new Date(sub.submitted_at).getTime();
      return ts >= windowStartTs && ts < deliveryTs;
    });
    // Find the latest one
    relevant.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
    const latest = relevant[0] ?? null;
    const map = new Map<string, { qty: number; submittedAt: string }>();
    if (latest) {
      for (const item of latest.data) {
        map.set(item.name, { qty: item.quantity, submittedAt: latest.submitted_at });
      }
    }
    return map;
  });

  /* ─ Toggle scales_with_demand ─ */
  const toggleScale = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase
        .from('delivery_targets')
        .update({ scales_with_demand: value })
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: ({ id }) => {
      setPendingScaleIds(prev => new Set([...prev, id]));
    },
    onSettled: (_, __, { id }) => {
      setPendingScaleIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      qc.invalidateQueries({ queryKey: ['targets-weekly', activeStore, selectedWeekKey] });
    },
  });

  /* ─ Upsert from Excel ─ */
  const upsertTargets = useMutation({
    mutationFn: async (rows: ParsedItem[]) => {
      const payload = rows.map(r => ({
        location_name: activeStore,
        section: r.section,
        item_name: r.item_name,
        unit: r.unit,
        mon_target: r.mon_target,
        tue_target: r.tue_target,
        wed_target: r.wed_target,
        fri_target: r.fri_target,
      }));
      const { error } = await supabase
        .from('delivery_targets')
        .upsert(payload, { onConflict: 'location_name,item_name' });
      if (error) throw error;
    },
    onSuccess: (_, rows) => {
      qc.invalidateQueries({ queryKey: ['targets-weekly', activeStore, selectedWeekKey] });
      setUploadMsg(`Imported ${rows.length} items successfully.`);
      setTimeout(() => setUploadMsg(''), 4000);
    },
    onError: (e: Error) => {
      setUploadMsg(`Error: ${e.message}`);
    },
  });

  /* ─ Excel parse ─ */
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg('');

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      const parsed: ParsedItem[] = [];
      let currentSection = 'Uncategorised';

      for (let i = 2; i < raw.length; i++) {
        const row = raw[i] as unknown[];
        const colA = String(row[0] ?? '').trim();
        const colC = String(row[2] ?? '').trim();
        const colD = row[3];
        const colE = row[4];
        const colF = row[5];
        const colG = row[6];

        if (!colA) continue;

        const hasUnit = colC !== '';
        const hasNumbers = [colD, colE, colF, colG].some(v => v !== '' && !isNaN(Number(v)));

        if (!hasUnit && !hasNumbers) {
          currentSection = colA;
          continue;
        }

        parsed.push({
          section: currentSection,
          item_name: colA,
          unit: colC,
          mon_target: parseFloat(String(colD)) || 0,
          tue_target: parseFloat(String(colE)) || 0,
          wed_target: parseFloat(String(colF)) || 0,
          fri_target: parseFloat(String(colG)) || 0,
        });
      }

      if (parsed.length === 0) {
        setUploadMsg('No data rows found in the file.');
      } else {
        upsertTargets.mutate(parsed);
      }
    } catch (err: unknown) {
      setUploadMsg(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /* ─ Group by section ─ */
  const grouped = SECTIONS.reduce<Record<string, TargetRow[]>>((acc, sec) => {
    acc[sec] = targets.filter(t => t.section === sec);
    return acc;
  }, {});
  const knownSections = new Set(SECTIONS);
  const otherSections = [...new Set(targets.map(t => t.section).filter(s => !knownSections.has(s)))];
  const allSections = [...SECTIONS, ...otherSections];

  const totalItems = targets.length;

  // Today's date string for highlighting
  const todayStr = fmtDateISO(new Date());

  /* ─ Total columns: Item + Unit + 4×3 data cols + Scales = 15 ─ */
  const totalCols = 2 + 4 * 3 + 1; // 15

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Target size={20} className="text-[#1B5E20]" />
            <h1 className="text-2xl font-bold text-gray-900">Target Levels</h1>
          </div>
          {/* Week selector */}
          <div className="flex items-center gap-2 mt-2">
            <label className="text-xs text-gray-500 font-medium">Week:</label>
            <select
              value={selectedWeekKey}
              onChange={e => setSelectedWeekKey(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            >
              {weekOptions.map(opt => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {uploadMsg && (
            <span className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
              uploadMsg.startsWith('Error') || uploadMsg.startsWith('Parse')
                ? 'bg-red-50 text-red-600'
                : 'bg-green-50 text-green-700'
            }`}>
              {uploadMsg}
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFile}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || upsertTargets.isPending}
            className="flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 shadow-sm"
          >
            <Upload size={15} />
            {uploading || upsertTargets.isPending ? 'Importing…' : 'Upload Excel'}
          </button>
        </div>
      </div>

      {/* Store tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit">
        {STORES.map(store => (
          <button
            key={store}
            onClick={() => setActiveStore(store)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeStore === store
                ? 'bg-white text-[#1B5E20] shadow-sm font-semibold'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {store}
          </button>
        ))}
      </div>

      {/* Table card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="h-4 bg-gray-100 rounded animate-pulse"
                style={{ width: `${60 + (i % 3) * 15}%` }}
              />
            ))}
          </div>
        ) : totalItems === 0 ? (
          <div className="p-12 text-center">
            <Target size={36} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-400 mb-1">
              No targets uploaded yet. Use the Upload Excel button to import targets for {activeStore}.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                {/* Day header row */}
                <tr className="bg-gray-50 border-b border-gray-100">
                  {/* Item + Unit sticky headers */}
                  <th
                    className="sticky left-0 z-10 bg-gray-50 px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-r border-gray-100 min-w-[160px]"
                    rowSpan={2}
                  >
                    Item
                  </th>
                  <th
                    className="sticky left-[160px] z-10 bg-gray-50 px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-r border-gray-200 min-w-[60px]"
                    rowSpan={2}
                  >
                    Unit
                  </th>

                  {/* Day span headers */}
                  {DAY_KEYS.map((dayKey, idx) => {
                    const deliveryDay = deliveryDays[idx];
                    const dateStr = fmtDateISO(deliveryDay);
                    const isToday = dateStr === todayStr;
                    const isPast = deliveryDay < new Date(todayStr);
                    return (
                      <th
                        key={dayKey}
                        colSpan={3}
                        className={`px-2 py-2 text-center text-xs font-bold uppercase tracking-wide border-l border-gray-100 ${
                          isPast ? 'text-gray-300 opacity-60' : isToday ? 'text-[#1B5E20]' : 'text-gray-600'
                        }`}
                        style={isToday ? { borderLeft: '3px solid #1B5E20' } : {}}
                      >
                        {DAY_LABELS[idx]}&nbsp;&nbsp;{fmtDayMonth(deliveryDay)}
                      </th>
                    );
                  })}

                  {/* Scales header */}
                  <th
                    className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide border-l border-gray-200"
                    rowSpan={2}
                  >
                    Scales
                  </th>
                </tr>

                {/* Sub-header row: Stock | Target | Deliver */}
                <tr className="bg-gray-50 border-b border-gray-200">
                  {DAY_KEYS.map(dayKey => (
                    <React.Fragment key={dayKey}>
                      <th className="px-2 py-1.5 text-center text-[11px] font-medium text-gray-400 border-l border-gray-100 w-16">
                        Stock
                      </th>
                      <th className="px-2 py-1.5 text-center text-[11px] font-medium text-gray-400 w-16">
                        Target
                      </th>
                      <th className="px-2 py-1.5 text-center text-[11px] font-medium text-gray-400 w-16">
                        Deliver
                      </th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>

              <tbody>
                {allSections.map(section => {
                  const rows = grouped[section] ?? targets.filter(t => t.section === section);
                  if (rows.length === 0) return null;
                  return (
                    <SectionRows
                      key={section}
                      section={section}
                      rows={rows}
                      deliveryDays={deliveryDays}
                      dayScales={dayScales}
                      dayStockMaps={dayStockMaps}
                      totalCols={totalCols}
                      onToggleScale={(id, value) => toggleScale.mutate({ id, value })}
                      pendingScaleIds={pendingScaleIds}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        {totalItems > 0 && (
          <div className="border-t border-gray-50 px-4 py-2 bg-gray-50/50">
            <p className="text-xs text-gray-400">
              {totalItems} item{totalItems !== 1 ? 's' : ''} · {activeStore} · {selectedWeek.label}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Section rows ───────────────────────────────────────────────────────── */
function SectionRows({
  section,
  rows,
  deliveryDays,
  dayScales,
  dayStockMaps,
  totalCols,
  onToggleScale,
  pendingScaleIds,
}: {
  section: string;
  rows: TargetRow[];
  deliveryDays: Date[];
  dayScales: { scale: number; hasForecast: boolean }[];
  dayStockMaps: Map<string, { qty: number; submittedAt: string }>[];
  totalCols: number;
  onToggleScale: (id: string, value: boolean) => void;
  pendingScaleIds: Set<string>;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Section header */}
      <tr
        className="bg-gray-100 cursor-pointer select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <td
          colSpan={totalCols}
          className="sticky left-0 px-4 py-2"
        >
          <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">
            {section}
          </span>
          <span className="ml-2 text-xs text-gray-400 font-normal normal-case">
            ({rows.length} item{rows.length !== 1 ? 's' : ''})
          </span>
        </td>
      </tr>

      {!collapsed && rows.map(row => (
        <tr key={row.id} className="border-t border-gray-50 hover:bg-gray-50/40 transition-colors">
          {/* Item name — sticky */}
          <td className="sticky left-0 z-10 bg-white px-4 py-2 text-sm text-gray-800 border-r border-gray-100 min-w-[160px] hover:bg-gray-50/40">
            {row.item_name}
          </td>
          {/* Unit — sticky */}
          <td className="sticky left-[160px] z-10 bg-white px-3 py-2 text-xs text-gray-500 border-r border-gray-200 min-w-[60px] hover:bg-gray-50/40">
            {row.unit}
          </td>

          {/* Day columns */}
          {DAY_KEYS.map((dayKey, idx) => {
            const baseTargetKey = BASE_TARGET_COLS[idx];
            const baseTarget: number = row[baseTargetKey] as number;
            const { scale, hasForecast } = dayScales[idx];
            const effectiveTarget = row.scales_with_demand
              ? Math.round(baseTarget * scale)
              : baseTarget;

            const stockEntry = dayStockMaps[idx].get(row.item_name) ?? null;
            const stockQty = stockEntry ? stockEntry.qty : null;
            const submittedAt = stockEntry ? stockEntry.submittedAt : null;

            const deliverQty =
              stockQty === null
                ? effectiveTarget
                : Math.max(0, effectiveTarget - stockQty);

            return (
              <React.Fragment key={dayKey}>
                {/* Stock */}
                <td className="px-2 py-2 text-center border-l border-gray-100">
                  <StockCell qty={stockQty} submittedAt={submittedAt} />
                </td>
                {/* Target */}
                <td className="px-2 py-2 text-center">
                  <TargetCell
                    baseTarget={baseTarget}
                    effectiveTarget={effectiveTarget}
                    scale={scale}
                    hasForecast={hasForecast}
                  />
                </td>
                {/* Deliver */}
                <td className={`px-2 py-2 text-center ${deliverQty > 0 ? 'bg-green-50' : ''}`}>
                  <DeliverCell qty={deliverQty} />
                </td>
              </React.Fragment>
            );
          })}

          {/* Scales toggle */}
          <td className="px-3 py-2 text-center border-l border-gray-200">
            <ToggleSwitch
              checked={row.scales_with_demand}
              onChange={v => onToggleScale(row.id, v)}
              disabled={pendingScaleIds.has(row.id)}
            />
          </td>
        </tr>
      ))}
    </>
  );
}
