'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { Truck, RefreshCw, CheckCircle2, AlertCircle, Package, TrendingUp } from 'lucide-react';

/* ─── Types ─────────────────────────────────────────────────────────────── */
type DeliveryRun = {
  id: string;
  delivery_date: string;
  status: 'draft' | 'ready' | 'in_progress' | 'completed';
  created_at: string;
};

type DeliveryLine = {
  id: string;
  run_id: string;
  location_name: string;
  section: string;
  item_name: string;
  unit: string;
  target_qty: number;
  reported_qty: number;
  delivery_qty: number;
  is_packed: boolean;
};

type InventoryItem = {
  section: string;
  name: string;
  unit: string;
  quantity: number;
};

type InventorySubmission = {
  id: string;
  location_name: string;
  submitted_at: string;
  data: InventoryItem[];
};

type DeliveryTarget = {
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

type StoreDayStandard = {
  location_name: string;
  day_of_week: string;
  standard_sales_eur: number;
};

type WeeklyForecast = {
  location_name: string;
  forecast_date: string;
  forecasted_sales_eur: number;
  is_locked: boolean;
};

/* ─── Constants ──────────────────────────────────────────────────────────── */
const STORES = ['Eschborn', 'Taunus', 'Westend'] as const;
type Store = typeof STORES[number];

const DELIVERY_DAYS = [1, 2, 3, 5]; // Mon=1, Tue=2, Wed=3, Fri=5
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
type DayKey = 'mon_target' | 'tue_target' | 'wed_target' | 'fri_target';

const DAY_KEY_MAP: Record<number, DayKey> = {
  1: 'mon_target',
  2: 'tue_target',
  3: 'wed_target',
  5: 'fri_target',
};

const DOW_TO_STD_KEY: Record<number, string> = {
  1: 'mon',
  2: 'tue',
  3: 'wed',
  5: 'fri',
};

const STATUS_CONFIG = {
  draft:       { label: 'Draft',       color: 'bg-gray-100 text-gray-600' },
  ready:       { label: 'Ready',       color: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'In Progress', color: 'bg-yellow-100 text-yellow-700' },
  completed:   { label: 'Completed',   color: 'bg-green-100 text-green-700' },
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDeliveryDate(): { date: string; dayOfWeek: number; isDeliveryDay: boolean } {
  const now = new Date();
  const dow = now.getDay();

  if (DELIVERY_DAYS.includes(dow)) {
    return { date: toLocalDateString(now), dayOfWeek: dow, isDeliveryDay: true };
  }

  let next = new Date(now);
  for (let i = 1; i <= 7; i++) {
    next = new Date(now);
    next.setDate(now.getDate() + i);
    if (DELIVERY_DAYS.includes(next.getDay())) break;
  }
  return { date: toLocalDateString(next), dayOfWeek: next.getDay(), isDeliveryDay: false };
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function fmtEur(n: number): string {
  return `€${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/* ─── Forecast info banner per store ────────────────────────────────────── */
function ForecastBanner({
  store,
  forecast,
  standard,
}: {
  store: Store;
  forecast: WeeklyForecast | null;
  standard: number;
}) {
  if (!forecast) {
    return (
      <div className="flex items-center gap-2 mb-4 px-4 py-2.5 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
        <AlertCircle size={14} className="flex-shrink-0" />
        <span>No forecast set for <strong>{store}</strong> — using standard targets (scale = 1.0×)</span>
      </div>
    );
  }

  const scale = standard > 0 ? forecast.forecasted_sales_eur / standard : 1;
  const scalePct = Math.round(scale * 100);
  const scaleStr = scale.toFixed(2);
  const isAbove = scale > 1.02;
  const isBelow = scale < 0.98;

  return (
    <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-blue-50 border border-blue-100 rounded-lg text-xs">
      <TrendingUp size={14} className="flex-shrink-0 text-blue-500" />
      <span className="text-blue-700">
        Forecast for <strong>{store}</strong>: <strong>{fmtEur(forecast.forecasted_sales_eur)}</strong>
      </span>
      <span className={`px-2 py-0.5 rounded font-bold ${
        isAbove ? 'bg-green-100 text-green-700' : isBelow ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
      }`}>
        ×{scaleStr} vs standard ({scalePct}%)
      </span>
    </div>
  );
}

/* ─── Store delivery list ────────────────────────────────────────────────── */
function StoreDeliveryList({
  store,
  lines,
  hasSubmission,
  isActive,
  onTogglePacked,
  forecast,
  standard,
}: {
  store: Store;
  lines: DeliveryLine[];
  hasSubmission: boolean;
  isActive: boolean;
  onTogglePacked: (id: string, value: boolean) => void;
  forecast: WeeklyForecast | null;
  standard: number;
}) {
  if (!hasSubmission) {
    return (
      <div className="flex items-center gap-3 p-6 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-700">
        <AlertCircle size={18} className="flex-shrink-0" />
        <span>Inventory not yet submitted for <strong>{store}</strong> — cannot calculate delivery quantities.</span>
      </div>
    );
  }

  const itemsToDeliver = lines.filter(l => l.delivery_qty > 0);
  const sections = [...new Set(lines.map(l => l.section))].sort();

  return (
    <div className={`print-store ${isActive ? 'block' : 'hidden print:hidden'}`}>
      {/* Forecast info banner */}
      <ForecastBanner store={store} forecast={forecast} standard={standard} />

      {/* Summary */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm font-medium text-gray-700">
          <span className="text-[#1B5E20] font-bold text-base">{itemsToDeliver.length}</span>
          {' '}item{itemsToDeliver.length !== 1 ? 's' : ''} to deliver
        </span>
        {lines.length > itemsToDeliver.length && (
          <span className="text-xs text-gray-400">
            ({lines.length - itemsToDeliver.length} at target — no delivery needed)
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-[35%]">Item</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Reported</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Target</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-[#1B5E20] uppercase tracking-wide">To Deliver</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide print:hidden">Packed</th>
              </tr>
            </thead>
            <tbody>
              {sections.map(section => {
                const sectionLines = lines.filter(l => l.section === section);
                return (
                  <React.Fragment key={section}>
                    <tr className="bg-gray-50">
                      <td colSpan={6} className="px-4 py-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          {section}
                        </span>
                      </td>
                    </tr>
                    {sectionLines.map(line => {
                      const muted = line.delivery_qty === 0;
                      return (
                        <tr
                          key={line.id}
                          className={`border-t border-gray-50 transition-colors ${
                            muted ? 'opacity-40' : 'hover:bg-gray-50/50'
                          }`}
                        >
                          <td className={`px-4 py-2.5 font-medium ${muted ? 'text-gray-400' : 'text-gray-800'}`}>
                            {line.item_name}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-500">{line.unit}</td>
                          <td className="px-4 py-2.5 text-center text-gray-600">{line.reported_qty}</td>
                          <td className="px-4 py-2.5 text-center text-gray-600">{line.target_qty}</td>
                          <td className="px-4 py-2.5 text-center">
                            {line.delivery_qty > 0 ? (
                              <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-md bg-[#1B5E20]/10 text-[#1B5E20] font-bold text-sm">
                                {line.delivery_qty}
                              </span>
                            ) : (
                              <span className="text-gray-300 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-center print:hidden">
                            {line.delivery_qty > 0 ? (
                              <button
                                onClick={() => onTogglePacked(line.id, !line.is_packed)}
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors mx-auto ${
                                  line.is_packed
                                    ? 'bg-[#1B5E20] border-[#1B5E20]'
                                    : 'border-gray-300 hover:border-[#1B5E20]'
                                }`}
                                title={line.is_packed ? 'Mark as unpacked' : 'Mark as packed'}
                              >
                                {line.is_packed && (
                                  <CheckCircle2 size={12} className="text-white" />
                                )}
                              </button>
                            ) : (
                              <span className="text-gray-200 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function DeliveryPage() {
  const qc = useQueryClient();
  const [activeStore, setActiveStore] = useState<Store>('Eschborn');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  const { date: targetDate, dayOfWeek, isDeliveryDay } = getDeliveryDate();
  const stdDayKey = DOW_TO_STD_KEY[dayOfWeek];

  /* ─ Query: existing run ─ */
  const { data: runData, isLoading } = useQuery({
    queryKey: ['delivery-run', targetDate],
    queryFn: async () => {
      const { data: run, error: runErr } = await supabase
        .from('delivery_runs')
        .select('*')
        .eq('delivery_date', targetDate)
        .maybeSingle();
      if (runErr) throw runErr;
      if (!run) return null;

      const { data: lines, error: linesErr } = await supabase
        .from('delivery_run_lines')
        .select('*')
        .eq('run_id', run.id)
        .order('location_name')
        .order('section')
        .order('item_name');
      if (linesErr) throw linesErr;

      return { run: run as DeliveryRun, lines: (lines ?? []) as DeliveryLine[] };
    },
  });

  /* ─ Query: standards for today's day ─ */
  const { data: standards = [] } = useQuery<StoreDayStandard[]>({
    queryKey: ['store-day-standards'],
    queryFn: async () => {
      const { data, error } = await supabase.from('store_day_standards').select('*');
      if (error) throw error;
      return data as StoreDayStandard[];
    },
    staleTime: Infinity,
  });

  /* ─ Query: forecasts for today's date ─ */
  const { data: forecasts = [] } = useQuery<WeeklyForecast[]>({
    queryKey: ['weekly-forecasts-today', targetDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weekly_sales_forecasts')
        .select('location_name, forecast_date, forecasted_sales_eur, is_locked')
        .eq('forecast_date', targetDate)
        .in('location_name', [...STORES]);
      if (error) throw error;
      return data as WeeklyForecast[];
    },
  });

  /* ─ Toggle packed ─ */
  const togglePacked = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase
        .from('delivery_run_lines')
        .update({ is_packed: value })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    },
  });

  /* ─ Generate delivery list ─ */
  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError('');

    try {
      const dayKey = DAY_KEY_MAP[dayOfWeek] as DayKey;

      // Load standards and forecasts
      const { data: allStandards } = await supabase
        .from('store_day_standards')
        .select('*')
        .eq('day_of_week', stdDayKey);

      const { data: allForecasts } = await supabase
        .from('weekly_sales_forecasts')
        .select('*')
        .eq('forecast_date', targetDate)
        .in('location_name', [...STORES]);

      const stdMap: Record<string, number> = {};
      for (const s of (allStandards ?? [])) {
        stdMap[s.location_name] = s.standard_sales_eur;
      }

      const forecastMap: Record<string, number> = {};
      for (const f of (allForecasts ?? [])) {
        forecastMap[f.location_name] = f.forecasted_sales_eur;
      }

      // For each store: get latest inventory submission + delivery targets
      const storeData: {
        store: Store;
        submission: InventorySubmission | null;
        targets: DeliveryTarget[];
      }[] = [];

      for (const store of STORES) {
        const { data: submissions } = await supabase
          .from('inventory_submissions')
          .select('*')
          .eq('location_name', store)
          .order('submitted_at', { ascending: false })
          .limit(1);

        const { data: targets } = await supabase
          .from('delivery_targets')
          .select('*')
          .eq('location_name', store);

        storeData.push({
          store,
          submission: (submissions?.[0] as InventorySubmission | undefined) ?? null,
          targets: (targets ?? []) as DeliveryTarget[],
        });
      }

      // Insert / upsert delivery_run
      const { data: runRow, error: runErr } = await supabase
        .from('delivery_runs')
        .upsert({ delivery_date: targetDate, status: 'draft' }, { onConflict: 'delivery_date' })
        .select()
        .single();
      if (runErr) throw runErr;

      const runId = (runRow as DeliveryRun).id;

      // Delete existing lines (regenerate)
      await supabase.from('delivery_run_lines').delete().eq('run_id', runId);

      // Build lines using forecast-scaled targets
      const allLines: Omit<DeliveryLine, 'id' | 'created_at'>[] = [];

      for (const { store, submission, targets } of storeData) {
        const standardSales = stdMap[store] ?? 0;
        const forecastedSales = forecastMap[store] ?? null;

        for (const target of targets) {
          const baseTarget = target[dayKey] ?? 0;

          // Compute effective target
          let effectiveTarget: number;
          if (target.scales_with_demand && forecastedSales !== null && standardSales > 0) {
            effectiveTarget = Math.round(baseTarget * (forecastedSales / standardSales));
          } else {
            effectiveTarget = baseTarget;
          }
          effectiveTarget = Math.max(0, effectiveTarget);

          // Find matching item in inventory submission
          let reportedQty = 0;
          if (submission?.data && Array.isArray(submission.data)) {
            const found = (submission.data as InventoryItem[]).find(
              item => item.name.trim().toLowerCase() === target.item_name.trim().toLowerCase()
            );
            if (found) reportedQty = Number(found.quantity) || 0;
          }

          const deliveryQty = Math.max(0, effectiveTarget - reportedQty);

          allLines.push({
            run_id: runId,
            location_name: store,
            section: target.section,
            item_name: target.item_name,
            unit: target.unit,
            target_qty: effectiveTarget,
            reported_qty: reportedQty,
            delivery_qty: deliveryQty,
            is_packed: false,
          });
        }
      }

      if (allLines.length > 0) {
        const { error: linesErr } = await supabase
          .from('delivery_run_lines')
          .insert(allLines);
        if (linesErr) throw linesErr;
      }

      const allSubmitted = storeData.every(s => s.submission !== null);
      await supabase
        .from('delivery_runs')
        .update({ status: allSubmitted ? 'ready' : 'draft' })
        .eq('id', runId);

      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
      qc.invalidateQueries({ queryKey: ['weekly-forecasts-today', targetDate] });
    } catch (err: any) {
      setGenerateError(err.message ?? 'Failed to generate delivery list');
    } finally {
      setGenerating(false);
    }
  };

  /* ─ Derived state ─ */
  const run = runData?.run ?? null;
  const lines = runData?.lines ?? [];

  const storeLines = (store: Store) => lines.filter(l => l.location_name === store);
  const storeHasSubmission = (store: Store) => {
    const sl = storeLines(store);
    if (sl.length === 0) return run !== null;
    return sl.length > 0;
  };

  const getStoreForecast = (store: Store): WeeklyForecast | null =>
    forecasts.find(f => f.location_name === store) ?? null;

  const getStoreStandard = (store: Store): number => {
    const s = standards.find(s => s.location_name === store && s.day_of_week === stdDayKey);
    return s?.standard_sales_eur ?? 0;
  };

  const dayLabel = DAY_NAMES[dayOfWeek]?.toUpperCase() ?? '';

  return (
    <>
      <div>
        {/* ── Page header ── */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Truck size={20} className="text-[#1B5E20]" />
              <h1 className="text-2xl font-bold text-gray-900">Delivery</h1>
            </div>
            <p className="text-sm text-gray-500">
              Mon · Tue · Wed · Fri — departs ZK at 14:00
            </p>
          </div>

          <div className="flex items-center gap-3 print:hidden">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-60 shadow-sm"
            >
              {generating
                ? <><RefreshCw size={15} className="animate-spin" /> Generating…</>
                : <><RefreshCw size={15} /> {run ? 'Regenerate' : 'Generate Delivery List'}</>
              }
            </button>
          </div>
        </div>

        {/* ── Date / status banner ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-5 flex items-center justify-between print-header">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Delivery Date</p>
              <p className="text-base font-semibold text-gray-900">{fmtDate(targetDate)}</p>
            </div>
            <div className="h-8 w-px bg-gray-100" />
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Today</p>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                isDeliveryDay
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {isDeliveryDay ? '✓ Delivery Day' : `Next delivery: ${dayLabel}`}
              </span>
            </div>
            {run && (
              <>
                <div className="h-8 w-px bg-gray-100" />
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Status</p>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${STATUS_CONFIG[run.status].color}`}>
                    {STATUS_CONFIG[run.status].label}
                  </span>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400 print:hidden">
            <Truck size={14} />
            <span>Eschborn → Taunus → Westend</span>
          </div>
        </div>

        {generateError && (
          <div className="mb-4 flex items-center gap-3 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
            <AlertCircle size={16} className="flex-shrink-0" />
            {generateError}
          </div>
        )}

        {/* ── Loading ── */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : !run ? (
          /* ── Empty state ── */
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <Package size={40} className="mx-auto text-gray-200 mb-4" />
            <p className="text-base font-semibold text-gray-400 mb-1">No delivery list yet</p>
            <p className="text-sm text-gray-300 mb-6">
              Click "Generate Delivery List" to pull the latest inventory counts and calculate what needs to be delivered to each store.
            </p>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="bg-[#1B5E20] text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-60"
            >
              {generating ? 'Generating…' : 'Generate Delivery List'}
            </button>
          </div>
        ) : (
          /* ── Store tabs + content ── */
          <>
            {/* Store tabs */}
            <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit print:hidden">
              {STORES.map(store => {
                const sl = storeLines(store);
                const toDeliver = sl.filter(l => l.delivery_qty > 0).length;
                return (
                  <button
                    key={store}
                    onClick={() => setActiveStore(store)}
                    className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                      activeStore === store
                        ? 'bg-white text-[#1B5E20] shadow-sm font-semibold'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {store}
                    {toDeliver > 0 && (
                      <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold leading-none ${
                        activeStore === store
                          ? 'bg-[#1B5E20] text-white'
                          : 'bg-gray-300 text-gray-600'
                      }`}>
                        {toDeliver}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Store delivery lists */}
            {STORES.map(store => (
              <div
                key={store}
                className={activeStore === store ? 'block' : 'hidden'}
              >
                <StoreDeliveryList
                  store={store}
                  lines={storeLines(store)}
                  hasSubmission={storeHasSubmission(store)}
                  isActive={activeStore === store}
                  onTogglePacked={(id, value) => togglePacked.mutate({ id, value })}
                  forecast={getStoreForecast(store)}
                  standard={getStoreStandard(store)}
                />
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
