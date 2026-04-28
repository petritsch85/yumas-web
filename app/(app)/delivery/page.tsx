'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { RefreshCw, CheckCircle2, AlertCircle, Package, TrendingUp, Eye, Settings2, Truck, Play, Timer, Flag } from 'lucide-react';
import type { Profile } from '@/types';

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s}s`;
}

/* ─── Types ─────────────────────────────────────────────────────────────── */
type DeliveryRun = {
  id: string;
  delivery_date: string;
  status: 'draft' | 'ready' | 'in_progress' | 'completed';
  created_at: string;
  packing_started_at: string | null;
  packing_finished_at: string | null;
  packing_duration_seconds: number | null;
  items_packed_count: number | null;
  packed_by: string | null;
  delivery_started_at: string | null;
  delivery_started_by: string | null;
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
  viewMode,
  editingTargets,
  onTargetChange,
  onTargetBlur,
  packingStarted,
}: {
  store: Store;
  lines: DeliveryLine[];
  hasSubmission: boolean;
  isActive: boolean;
  onTogglePacked: (id: string, value: boolean) => void;
  forecast: WeeklyForecast | null;
  standard: number;
  viewMode: 'packer' | 'manager';
  editingTargets: Record<string, string>;
  onTargetChange: (id: string, value: string) => void;
  onTargetBlur: (line: DeliveryLine, value: string) => void;
  packingStarted: boolean;
}) {
  if (!hasSubmission) {
    return (
      <div className="flex items-center gap-3 p-6 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-700">
        <AlertCircle size={18} className="flex-shrink-0" />
        <span>Inventory not yet submitted for <strong>{store}</strong> — cannot calculate delivery quantities.</span>
      </div>
    );
  }

  const isManager = viewMode === 'manager';
  const colSpanCount = isManager ? 6 : 4;
  const canPack = isManager || packingStarted;

  // Compute live delivery qty taking into account any unsaved target edits
  const liveDeliveryQty = (line: DeliveryLine): number => {
    if (!isManager) return line.delivery_qty;
    const raw = editingTargets[line.id];
    if (raw === undefined) return line.delivery_qty;
    const t = parseFloat(raw);
    return Math.max(0, (isNaN(t) ? line.target_qty : t) - line.reported_qty);
  };

  const itemsToDeliver = lines.filter(l => liveDeliveryQty(l) > 0);
  const sections = [...new Set(lines.map(l => l.section))].sort();

  return (
    <div className={isActive ? 'block' : 'hidden'}>
      {/* Forecast info banner — manager only */}
      {isManager && <ForecastBanner store={store} forecast={forecast} standard={standard} />}

      {/* Summary */}
      <div className="flex items-center gap-3 mb-4">
        {isManager ? (
          <>
            <span className="text-sm font-medium text-gray-700">
              <span className="text-[#1B5E20] font-bold text-base">{itemsToDeliver.length}</span>
              {' '}item{itemsToDeliver.length !== 1 ? 's' : ''} to pack
            </span>
            {lines.length > itemsToDeliver.length && (
              <span className="text-xs text-gray-400">
                ({lines.length - itemsToDeliver.length} at target — no delivery needed)
              </span>
            )}
          </>
        ) : (
          <span className="text-sm font-medium text-gray-700">
            <span className="text-[#1B5E20] font-bold text-base">
              {itemsToDeliver.filter(l => l.is_packed).length}
            </span>
            <span className="text-gray-400 font-normal"> / {itemsToDeliver.length} packed</span>
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className={isManager ? 'overflow-x-auto' : ''}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 md:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                {/* Unit: hidden on mobile in packer view, folded under item name instead */}
                {isManager && (
                  <th className="px-3 md:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                )}
                <th className="hidden sm:table-cell px-3 md:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {!isManager && 'Unit'}
                </th>
                {isManager && <>
                  <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Reported</th>
                  <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Target</th>
                </>}
                <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-[#1B5E20] uppercase tracking-wide">To Deliver</th>
                <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Packed</th>
              </tr>
            </thead>
            <tbody>
              {sections.map(section => {
                const sectionLines = lines.filter(l => l.section === section);
                return (
                  <React.Fragment key={section}>
                    <tr className="bg-gray-50">
                      <td colSpan={colSpanCount} className="px-3 md:px-4 py-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{section}</span>
                      </td>
                    </tr>
                    {sectionLines.map(line => {
                      const deliverQty = liveDeliveryQty(line);
                      const muted = deliverQty === 0;
                      const targetVal = editingTargets[line.id] ?? String(line.target_qty);
                      return (
                        <tr
                          key={line.id}
                          className={`border-t border-gray-50 transition-colors ${muted ? 'opacity-40' : 'hover:bg-gray-50/50'}`}
                        >
                          <td className={`px-3 md:px-4 py-2.5 font-medium ${muted ? 'text-gray-400' : 'text-gray-800'}`}>
                            {line.item_name}
                            {/* Unit shown inline on mobile in packer view */}
                            {!isManager && (
                              <div className="text-xs text-gray-400 font-normal mt-0.5 sm:hidden">{line.unit}</div>
                            )}
                          </td>
                          {/* Unit as separate column: always in manager view, desktop-only in packer view */}
                          {isManager
                            ? <td className="px-3 md:px-4 py-2.5 text-xs text-gray-500">{line.unit}</td>
                            : <td className="hidden sm:table-cell px-3 md:px-4 py-2.5 text-xs text-gray-500">{line.unit}</td>
                          }

                          {isManager && <>
                            <td className="px-3 md:px-4 py-2.5 text-center text-gray-500">{line.reported_qty}</td>
                            <td className="px-3 md:px-4 py-2.5 text-center">
                              <input
                                type="number"
                                min="0"
                                value={targetVal}
                                onChange={e => onTargetChange(line.id, e.target.value)}
                                onBlur={e => onTargetBlur(line, e.target.value)}
                                className="w-16 text-center border border-gray-200 rounded-md px-1.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] bg-white"
                              />
                            </td>
                          </>}

                          <td className="px-2 md:px-4 py-2.5 text-center">
                            {deliverQty > 0 ? (
                              <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-md bg-[#1B5E20]/10 text-[#1B5E20] font-bold text-sm">
                                {deliverQty}
                              </span>
                            ) : (
                              <span className="text-gray-300 text-xs">—</span>
                            )}
                          </td>

                          <td className="px-2 md:px-4 py-2.5 text-center">
                            {deliverQty > 0 ? (
                              <button
                                onClick={() => canPack && onTogglePacked(line.id, !line.is_packed)}
                                disabled={!canPack}
                                className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors mx-auto ${
                                  line.is_packed
                                    ? 'bg-[#1B5E20] border-[#1B5E20]'
                                    : canPack
                                    ? 'border-gray-300 hover:border-[#1B5E20]'
                                    : 'border-gray-200 bg-gray-50 cursor-not-allowed'
                                }`}
                                title={!canPack ? 'Start packing first' : line.is_packed ? 'Mark as unpacked' : 'Mark as packed'}
                              >
                                {line.is_packed && <CheckCircle2 size={14} className="text-white" />}
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

  // View mode: packer (default) or manager
  const [viewMode, setViewMode] = useState<'packer' | 'manager'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('delivery-view-mode') as 'packer' | 'manager') ?? 'packer';
    }
    return 'packer';
  });

  // Inline target edits: line id → string value (unsaved)
  const [editingTargets, setEditingTargets] = useState<Record<string, string>>({});

  const setMode = (mode: 'packer' | 'manager') => {
    setViewMode(mode);
    localStorage.setItem('delivery-view-mode', mode);
    if (mode === 'packer') setEditingTargets({});
  };

  // Packing timer
  const [packingStarted, setPackingStarted] = useState(false);
  const [packingFinished, setPackingFinished] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const packingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const [startingDelivery, setStartingDelivery] = useState(false);

  useEffect(() => {
    return () => { if (packingInterval.current) clearInterval(packingInterval.current); };
  }, []);

  const startPacking = async () => {
    setPackingStarted(true);
    packingInterval.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    if (run) {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('delivery_runs').update({
        packing_started_at: new Date().toISOString(),
        packed_by: user?.id ?? null,
      }).eq('id', run.id);
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    }
  };

  const finishPacking = async () => {
    if (packingInterval.current) clearInterval(packingInterval.current);
    setPackingFinished(true);
    if (run) {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('delivery_runs').update({
        packing_finished_at: new Date().toISOString(),
        packing_duration_seconds: elapsedSeconds,
        items_packed_count: totalPackStats.packed,
        packed_by: user?.id ?? null,
      }).eq('id', run.id);
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    }
  };

  const startDelivery = async () => {
    if (!run) return;
    setStartingDelivery(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('delivery_runs').update({
        delivery_started_at: new Date().toISOString(),
        delivery_started_by: user?.id ?? null,
        status: 'in_progress',
      }).eq('id', run.id);
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    } finally {
      setStartingDelivery(false);
    }
  };

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

  /* ─ Profile (to gate manager toggle) ─ */
  const { data: profile } = useQuery<Profile | null>({
    queryKey: ['delivery-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      return data as Profile | null;
    },
  });
  const canManage = profile?.role === 'admin' || profile?.role === 'manager';

  /* ─ Update target qty on a line ─ */
  const updateTarget = useMutation({
    mutationFn: async ({ line, newTarget }: { line: DeliveryLine; newTarget: number }) => {
      const newDelivery = Math.max(0, newTarget - line.reported_qty);
      const { error } = await supabase
        .from('delivery_run_lines')
        .update({ target_qty: newTarget, delivery_qty: newDelivery })
        .eq('id', line.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] }),
  });

  const handleTargetChange = (id: string, value: string) => {
    setEditingTargets(prev => ({ ...prev, [id]: value }));
  };

  const handleTargetBlur = (line: DeliveryLine, value: string) => {
    const parsed = parseFloat(value);
    const newTarget = isNaN(parsed) ? line.target_qty : Math.max(0, Math.round(parsed));
    // Only save if changed
    if (newTarget !== line.target_qty) {
      updateTarget.mutate({ line, newTarget });
    }
    // Clear local override — DB value will come back via query invalidation
    setEditingTargets(prev => {
      const next = { ...prev };
      delete next[line.id];
      return next;
    });
  };

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

  const storePackStats = (store: Store) => {
    const sl = storeLines(store).filter(l => l.delivery_qty > 0);
    const packed = sl.filter(l => l.is_packed).length;
    return { packed, total: sl.length, complete: sl.length > 0 && packed === sl.length };
  };

  const totalPackStats = STORES.reduce(
    (acc, store) => {
      const { packed, total } = storePackStats(store);
      return { packed: acc.packed + packed, total: acc.total + total };
    },
    { packed: 0, total: 0 }
  );

  const getStoreForecast = (store: Store): WeeklyForecast | null =>
    forecasts.find(f => f.location_name === store) ?? null;

  const getStoreStandard = (store: Store): number => {
    const s = standards.find(s => s.location_name === store && s.day_of_week === stdDayKey);
    return s?.standard_sales_eur ?? 0;
  };


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

          <div className="flex items-center gap-3">
            {/* View mode toggle — managers/admins only */}
            {canManage && (
              <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-1">
                <button
                  onClick={() => setMode('packer')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    viewMode === 'packer' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Eye size={13} />
                  Packer
                </button>
                <button
                  onClick={() => setMode('manager')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    viewMode === 'manager' ? 'bg-white text-[#1B5E20] shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Settings2 size={13} />
                  Manager
                </button>
              </div>
            )}

            {/* Packer view: Start Packing / timer / Packing Finished */}
            {viewMode === 'packer' && run && !packingFinished && (
              !packingStarted ? (
                <button
                  onClick={startPacking}
                  className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors shadow-sm"
                >
                  <Play size={15} />
                  Start Packing
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
                    <Timer size={14} className="text-[#1B5E20]" />
                    <span className="font-mono font-bold text-gray-800 tabular-nums text-sm">
                      {formatTimer(elapsedSeconds)}
                    </span>
                  </div>
                  <button
                    onClick={finishPacking}
                    className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors shadow-sm"
                  >
                    <Flag size={15} />
                    Packing Finished
                  </button>
                </div>
              )
            )}

            {/* Manager view: Start Delivery + Regenerate */}
            {viewMode === 'manager' && (
              <>
                {run && run.packing_finished_at && !run.delivery_started_at && (
                  <button
                    onClick={startDelivery}
                    disabled={startingDelivery}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60 shadow-sm"
                  >
                    <Truck size={15} />
                    {startingDelivery ? 'Logging…' : 'Start Delivery'}
                  </button>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-60 shadow-sm"
                >
                  {generating
                    ? <><RefreshCw size={15} className="animate-spin" /> Generating…</>
                    : <><RefreshCw size={15} /> {run ? 'Regenerate' : 'Generate List'}</>
                  }
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Date banner ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Delivery Date</p>
          <p className="text-base font-semibold text-gray-900">{fmtDate(targetDate)}</p>
        </div>

        {/* Packing finished banner */}
        {packingFinished && (
          <div className="mb-5 flex items-center gap-4 p-4 bg-green-50 border border-green-200 rounded-xl">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 size={22} className="text-[#1B5E20]" />
            </div>
            <div>
              <p className="font-semibold text-green-900">Packing complete!</p>
              <p className="text-sm text-green-700">
                {totalPackStats.packed} / {totalPackStats.total} items packed in{' '}
                <strong>{formatDuration(elapsedSeconds)}</strong>
              </p>
            </div>
          </div>
        )}

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
              Switch to Manager view and click "Generate List" to pull the latest inventory counts.
            </p>
            {viewMode === 'manager' && (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="bg-[#1B5E20] text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-60"
              >
                {generating ? 'Generating…' : 'Generate Delivery List'}
              </button>
            )}
          </div>
        ) : (
          /* ── Store tabs + content ── */
          <>
            {/* Store tabs */}
            <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit">
              {STORES.map(store => {
                const { packed, total, complete } = storePackStats(store);
                const isActive = activeStore === store;
                const isPacker = viewMode === 'packer';
                return (
                  <button
                    key={store}
                    onClick={() => setActiveStore(store)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                      isActive
                        ? 'bg-white text-[#1B5E20] shadow-sm font-semibold'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {store}
                    {isPacker && packingStarted ? (
                      complete ? (
                        <CheckCircle2 size={14} className="text-[#1B5E20]" />
                      ) : (
                        <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold leading-none ${
                          isActive ? 'bg-[#1B5E20] text-white' : 'bg-gray-300 text-gray-600'
                        }`}>
                          {packed}/{total}
                        </span>
                      )
                    ) : (
                      total > 0 && (
                        <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold leading-none ${
                          isActive ? 'bg-[#1B5E20] text-white' : 'bg-gray-300 text-gray-600'
                        }`}>
                          {total}
                        </span>
                      )
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
                  viewMode={viewMode}
                  editingTargets={editingTargets}
                  onTargetChange={handleTargetChange}
                  onTargetBlur={handleTargetBlur}
                  packingStarted={packingStarted}
                />
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
