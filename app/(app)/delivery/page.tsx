'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  RefreshCw, CheckCircle2, AlertCircle, Package, TrendingUp,
  Eye, Settings2, Truck, Play, Timer, Flag, XCircle,
  Upload, SlidersHorizontal, Save, X, CalendarDays,
  Navigation, Store, ClipboardCheck, Clock,
} from 'lucide-react';
import * as XLSX from 'xlsx';
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
type ViewMode = 'manager' | 'packer' | 'driver' | 'store';

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
  delivery_finished_at: string | null;
  delivery_finished_by: string | null;
};

type StoreReceipt = {
  id: string;
  run_id: string;
  location_name: string;
  received_at: string;
  received_by: string | null;
  notes: string | null;
  items_confirmed_count: number | null;
};

type DeliveryLine = {
  id: string;
  run_id: string;
  location_name: string;
  section: string;
  item_name: string;
  unit: string;
  standard_target_qty: number;
  target_qty: number;
  reported_qty: number;
  delivery_qty: number;
  is_packed: boolean;
  packed_qty: number | null;
};

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
  demand_scale_factor: number; // 1.0 = fully proportional; 0.5 = half; 0 = fixed
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
  demand_scale_factor: number;
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

const SECTIONS = ['Kühlhaus', 'Tiefkühler', 'Trockenware', 'Regale', 'Lager'];

const DELIVERY_DAYS = [1, 2, 3, 5]; // Mon=1 Tue=2 Wed=3 Fri=5
type DayKey = 'mon_target' | 'tue_target' | 'wed_target' | 'fri_target';

const DAY_KEY_MAP: Record<number, DayKey> = {
  1: 'mon_target', 2: 'tue_target', 3: 'wed_target', 5: 'fri_target',
};

const DOW_TO_STD_KEY: Record<number, string> = {
  1: 'mon', 2: 'tue', 3: 'wed', 5: 'fri',
};

/* ─── Date helpers ───────────────────────────────────────────────────────── */
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDefaultDeliveryDate(): string {
  const now = new Date();
  const dow = now.getDay();
  if (DELIVERY_DAYS.includes(dow)) return toLocalDateString(now);
  let next = new Date(now);
  for (let i = 1; i <= 7; i++) {
    next = new Date(now);
    next.setDate(now.getDate() + i);
    if (DELIVERY_DAYS.includes(next.getDay())) break;
  }
  return toLocalDateString(next);
}

/** Next N upcoming delivery dates (Mon/Tue/Wed/Fri) starting from today */
function getUpcomingDeliveryDates(count = 24): { date: string; label: string; dow: number }[] {
  const result: { date: string; label: string; dow: number }[] = [];
  const todayStr = toLocalDateString(new Date());
  const d = new Date();
  while (result.length < count) {
    const dow = d.getDay();
    if (DELIVERY_DAYS.includes(dow)) {
      const dateStr = toLocalDateString(d);
      const label = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      result.push({ date: dateStr, label: dateStr === todayStr ? `Today — ${label}` : label, dow });
    }
    d.setDate(d.getDate() + 1);
  }
  return result;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function fmtEur(n: number): string {
  return `€${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/* ─── Packing status indicator ───────────────────────────────────────────── */
function PackingStatus({ packedQty, deliveryQty }: { packedQty: number | null; deliveryQty: number }) {
  if (packedQty === null) return <span className="text-gray-200 text-xs select-none">—</span>;
  if (packedQty >= deliveryQty) return <CheckCircle2 size={17} className="text-green-600 mx-auto" />;
  if (packedQty > 0)            return <CheckCircle2 size={17} className="text-orange-400 mx-auto" />;
  return <XCircle size={17} className="text-red-400 mx-auto" />;
}

/* ─── Forecast banner ────────────────────────────────────────────────────── */
function ForecastBanner({ store, forecast, standard }: {
  store: Store; forecast: WeeklyForecast | null; standard: number;
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
  const isAbove = scale > 1.02;
  const isBelow = scale < 0.98;
  return (
    <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-blue-50 border border-blue-100 rounded-lg text-xs">
      <TrendingUp size={14} className="flex-shrink-0 text-blue-500" />
      <span className="text-blue-700">Forecast for <strong>{store}</strong>: <strong>{fmtEur(forecast.forecasted_sales_eur)}</strong></span>
      <span className={`px-2 py-0.5 rounded font-bold ${isAbove ? 'bg-green-100 text-green-700' : isBelow ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
        ×{scale.toFixed(2)} ({scalePct}%)
      </span>
    </div>
  );
}

/* ─── Store delivery list ────────────────────────────────────────────────── */
function StoreDeliveryList({
  store, lines, hasSubmission, isActive, onPackedQtyBlur,
  forecast, standard, viewMode, editingTargets, editingPackedQty,
  onTargetChange, onTargetBlur, onPackedQtyChange, packingStarted, isPreview,
  storeInventory,
}: {
  store: Store;
  lines: DeliveryLine[];
  hasSubmission: boolean;
  isActive: boolean;
  onPackedQtyBlur: (id: string, value: string, deliveryQty: number) => void;
  forecast: WeeklyForecast | null;
  standard: number;
  viewMode: 'packer' | 'manager';
  editingTargets: Record<string, string>;
  editingPackedQty: Record<string, string>;
  onTargetChange: (id: string, value: string) => void;
  onTargetBlur: (line: DeliveryLine, value: string) => void;
  onPackedQtyChange: (id: string, value: string) => void;
  packingStarted: boolean;
  isPreview: boolean;
  storeInventory: Record<string, number>; // item_name_lower → qty, always live
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
  const canPack = !isPreview && (isManager || packingStarted);
  const colCount = isManager ? 6 : 5;

  // Live current inventory for this item (latest submission, always fresh)
  const getLiveInventory = (line: DeliveryLine): number =>
    storeInventory[line.item_name.trim().toLowerCase()] ?? line.reported_qty;

  const liveDeliveryQty = (line: DeliveryLine): number => {
    if (!isManager) return line.delivery_qty;
    const raw = editingTargets[line.id];
    const target = raw !== undefined
      ? Math.max(0, parseFloat(raw) || line.target_qty)
      : line.target_qty;
    return Math.max(0, target - getLiveInventory(line));
  };

  const itemsToDeliver = lines.filter(l => liveDeliveryQty(l) > 0);
  const sections = [...new Set(lines.map(l => l.section))].sort();

  const fullCount    = itemsToDeliver.filter(l => l.packed_qty !== null && l.packed_qty >= l.delivery_qty).length;
  const partialCount = itemsToDeliver.filter(l => l.packed_qty !== null && l.packed_qty > 0 && l.packed_qty < l.delivery_qty).length;
  const noneCount    = itemsToDeliver.filter(l => l.packed_qty !== null && l.packed_qty === 0).length;

  return (
    <div className={isActive ? 'block' : 'hidden'}>
      {isManager && <ForecastBanner store={store} forecast={forecast} standard={standard} />}

      {/* Summary */}
      <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mb-4">
        <span className="text-sm font-medium text-gray-700">
          <span className="text-[#1B5E20] font-bold text-base">{itemsToDeliver.length}</span>
          {' '}item{itemsToDeliver.length !== 1 ? 's' : ''} to pack
        </span>
        {packingStarted && (
          <span className="text-xs text-gray-500 flex items-center gap-2">
            {fullCount    > 0 && <span className="flex items-center gap-1 text-green-700"><CheckCircle2 size={12} /> {fullCount} full</span>}
            {partialCount > 0 && <span className="flex items-center gap-1 text-orange-500"><CheckCircle2 size={12} /> {partialCount} partial</span>}
            {noneCount    > 0 && <span className="flex items-center gap-1 text-red-400"><XCircle size={12} /> {noneCount} skipped</span>}
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className={isManager ? 'overflow-x-auto' : ''}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 md:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                {isManager
                  ? <th className="px-3 md:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                  : <th className="hidden sm:table-cell px-3 md:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                }
                {isManager && <>
                  <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Current Inventory</th>
                  <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide">Std Target</th>
                  <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Target Today</th>
                </>}
                <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-[#1B5E20] uppercase tracking-wide">To Pack</th>
                {!isManager && <>
                  <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Packed</th>
                  <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Full/Partial</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {sections.map(section => {
                const sectionLines = lines.filter(l => l.section === section);
                return (
                  <React.Fragment key={section}>
                    <tr className="bg-gray-50">
                      <td colSpan={colCount} className="px-3 md:px-4 py-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{section}</span>
                      </td>
                    </tr>
                    {sectionLines.map(line => {
                      const deliverQty = liveDeliveryQty(line);
                      const muted = deliverQty === 0;
                      const targetVal = editingTargets[line.id] ?? String(line.target_qty);
                      const packedVal = editingPackedQty[line.id] ?? (line.packed_qty !== null ? String(line.packed_qty) : '');

                      return (
                        <tr key={line.id} className={`border-t border-gray-50 transition-colors ${muted ? 'opacity-40' : 'hover:bg-gray-50/50'}`}>
                          <td className={`px-3 md:px-4 py-2.5 font-medium ${muted ? 'text-gray-400' : 'text-gray-800'}`}>
                            {line.item_name}
                            {!isManager && <div className="text-xs text-gray-400 font-normal mt-0.5 sm:hidden">{line.unit}</div>}
                          </td>
                          {isManager
                            ? <td className="px-3 md:px-4 py-2.5 text-xs text-gray-500">{line.unit}</td>
                            : <td className="hidden sm:table-cell px-3 md:px-4 py-2.5 text-xs text-gray-500">{line.unit}</td>
                          }
                          {isManager && <>
                            <td className="px-3 md:px-4 py-2.5 text-center tabular-nums">
                              {(() => {
                                const qty = getLiveInventory(line);
                                return qty > 0
                                  ? <span className="text-[#2E7D32] font-semibold">{qty}</span>
                                  : <span className="text-gray-300">0</span>;
                              })()}
                            </td>
                            <td className="px-3 md:px-4 py-2.5 text-center text-gray-400 tabular-nums">
                              {line.standard_target_qty ?? line.target_qty}
                              {line.standard_target_qty !== line.target_qty && line.standard_target_qty != null && (
                                <span className="ml-1 text-xs text-blue-400" title="Adjusted by forecast">↗</span>
                              )}
                            </td>
                            <td className="px-3 md:px-4 py-2.5 text-center">
                              {isPreview ? (
                                <span className="tabular-nums text-gray-400">{line.target_qty}</span>
                              ) : (
                                <input
                                  type="number" min="0"
                                  value={targetVal}
                                  onChange={e => onTargetChange(line.id, e.target.value)}
                                  onBlur={e => onTargetBlur(line, e.target.value)}
                                  className="w-16 text-center border border-gray-200 rounded-md px-1.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] bg-white"
                                />
                              )}
                            </td>
                          </>}
                          <td className="px-2 md:px-4 py-2.5 text-center">
                            {deliverQty > 0 ? (
                              <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-md bg-[#1B5E20]/10 text-[#1B5E20] font-bold text-sm">{deliverQty}</span>
                            ) : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          {!isManager && (
                            <td className="px-2 md:px-4 py-2.5 text-center">
                              {deliverQty > 0 ? (
                                <input
                                  type="number" min="0" step="1"
                                  value={packedVal}
                                  placeholder="—"
                                  disabled={!canPack}
                                  onChange={e => onPackedQtyChange(line.id, e.target.value)}
                                  onBlur={e => onPackedQtyBlur(line.id, e.target.value, deliverQty)}
                                  className={`w-16 text-center border rounded-md px-1.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] tabular-nums ${!canPack ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed' : 'border-gray-200 bg-white'}`}
                                  title={!canPack ? 'Start packing first' : ''}
                                />
                              ) : <span className="text-gray-200 text-xs">—</span>}
                            </td>
                          )}
                          {!isManager && (
                            <td className="px-2 md:px-4 py-2.5 text-center">
                              {deliverQty > 0 ? (
                                <PackingStatus
                                  packedQty={editingPackedQty[line.id] !== undefined
                                    ? (editingPackedQty[line.id] === '' ? null : parseFloat(editingPackedQty[line.id]))
                                    : line.packed_qty}
                                  deliveryQty={deliverQty}
                                />
                              ) : <span className="text-gray-200 text-xs">—</span>}
                            </td>
                          )}
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

/* ─── Driver View ────────────────────────────────────────────────────────── */
function DriverView({ run, targetDate, onStart, onFinish, startingDelivery, finishingDelivery, receiptStatus }: {
  run: DeliveryRun | null;
  targetDate: string;
  onStart: () => void;
  onFinish: () => void;
  startingDelivery: boolean;
  finishingDelivery: boolean;
  receiptStatus: Partial<Record<Store, boolean>>;
}) {
  const [deliveryTimer, setDeliveryTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (run?.delivery_started_at && !run?.delivery_finished_at) {
      const startMs = new Date(run.delivery_started_at).getTime();
      const tick = () => setDeliveryTimer(Math.floor((Date.now() - startMs) / 1000));
      tick();
      timerRef.current = setInterval(tick, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [run?.delivery_started_at, run?.delivery_finished_at]);

  const canStart      = !!run?.packing_finished_at && !run?.delivery_started_at;
  const inProgress    = !!run?.delivery_started_at && !run?.delivery_finished_at;
  const done          = !!run?.delivery_finished_at;
  const allConfirmed  = STORES.every(s => receiptStatus[s]);

  return (
    <div className="max-w-md mx-auto space-y-4 pt-2">
      {/* Date card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Delivery Date</p>
        <p className="text-base font-semibold text-gray-900">{fmtDate(targetDate)}</p>
      </div>

      {/* Status / action card */}
      {!run ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 text-center">
          <Package size={36} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No delivery run for today yet.</p>
        </div>
      ) : done ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center space-y-2">
          <CheckCircle2 size={44} className="text-green-500 mx-auto" />
          <p className="text-lg font-bold text-green-800">Delivery Complete</p>
          <p className="text-sm text-green-600">
            Returned at {new Date(run.delivery_finished_at!).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
          </p>
          {run.delivery_started_at && (
            <p className="text-xs text-green-500">
              Total time: {formatDuration(Math.floor((new Date(run.delivery_finished_at!).getTime() - new Date(run.delivery_started_at).getTime()) / 1000))}
            </p>
          )}
        </div>
      ) : inProgress ? (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center space-y-5">
          <div>
            <p className="text-xs font-semibold text-blue-500 uppercase tracking-widest mb-1">In Transit</p>
            <div className="text-5xl font-mono font-bold text-blue-800 tabular-nums">{formatTimer(deliveryTimer)}</div>
            <p className="text-xs text-blue-400 mt-1">
              Departed {new Date(run.delivery_started_at!).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button
            onClick={onFinish}
            disabled={finishingDelivery}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3.5 rounded-xl font-semibold text-base hover:bg-blue-700 transition-colors disabled:opacity-60 shadow-sm"
          >
            <Flag size={18} /> {finishingDelivery ? 'Logging…' : 'Finish Delivery (Back at ZK)'}
          </button>
        </div>
      ) : canStart ? (
        <div className="bg-white border border-gray-100 rounded-xl p-8 text-center space-y-4 shadow-sm">
          <Truck size={44} className="text-gray-300 mx-auto" />
          <div>
            <p className="font-semibold text-gray-700">Packing finished — ready to depart</p>
            <p className="text-xs text-gray-400 mt-1">Press when leaving ZK</p>
          </div>
          <button
            onClick={onStart}
            disabled={startingDelivery}
            className="w-full flex items-center justify-center gap-2 bg-[#1B5E20] text-white py-3.5 rounded-xl font-semibold text-base hover:bg-[#2E7D32] transition-colors disabled:opacity-60 shadow-sm"
          >
            <Play size={18} /> {startingDelivery ? 'Logging…' : 'Start Delivery'}
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center">
          <Clock size={36} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Waiting for packing to be completed…</p>
        </div>
      )}

      {/* Store confirmation status */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Store Receipt Confirmations</p>
        <div className="space-y-2">
          {STORES.map(store => (
            <div key={store} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
              <span className="text-sm font-medium text-gray-700">{store}</span>
              {receiptStatus[store]
                ? <span className="flex items-center gap-1.5 text-xs text-green-700 font-semibold bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle2 size={12} /> Confirmed</span>
                : <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">Pending</span>
              }
            </div>
          ))}
        </div>
        {allConfirmed && done && (
          <p className="mt-3 text-xs text-center text-green-600 font-semibold">✓ All stores confirmed — run complete</p>
        )}
      </div>
    </div>
  );
}

/* ─── Store Manager Receipt View ─────────────────────────────────────────── */
function StoreManagerView({ run, lines, targetDate, myStore }: {
  run: DeliveryRun | null;
  lines: DeliveryLine[];
  targetDate: string;
  myStore: Store | null; // null = manager viewing all (shows tabs)
}) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Store>(myStore ?? 'Eschborn');
  const [notes, setNotes] = useState('');

  const currentStore = myStore ?? activeTab;
  const storeLines = lines.filter(l => l.location_name === currentStore && (l.delivery_qty > 0 || l.packed_qty !== null));

  /* Fetch receipt for current store */
  const { data: receipt, isLoading: receiptLoading } = useQuery<StoreReceipt | null>({
    queryKey: ['store-receipt', run?.id, currentStore],
    enabled: !!run?.id,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('store_delivery_receipts')
        .select('*')
        .eq('run_id', run!.id)
        .eq('location_name', currentStore)
        .maybeSingle();
      return (data as StoreReceipt | null);
    },
  });

  /* Confirm receipt */
  const confirmReceipt = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('store_delivery_receipts').upsert({
        run_id: run!.id,
        location_name: currentStore,
        received_at: new Date().toISOString(),
        received_by: user?.id ?? null,
        notes: notes.trim() || null,
        items_confirmed_count: storeLines.length,
      }, { onConflict: 'run_id,location_name' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['store-receipt', run?.id, currentStore] });
      qc.invalidateQueries({ queryKey: ['store-receipts-status', run?.id] });
      setNotes('');
    },
  });

  const isConfirmed = !!receipt?.received_at;
  const sections = [...new Set(storeLines.map(l => l.section))].sort();

  return (
    <div className="space-y-4">
      {/* Store tabs — only shown to managers viewing all stores */}
      {!myStore && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {STORES.map(s => (
            <button key={s} onClick={() => setActiveTab(s)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === s ? 'bg-white text-[#1B5E20] shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
            >{s}</button>
          ))}
        </div>
      )}

      {/* Date + store header */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{currentStore} — Delivery</p>
          <p className="text-base font-semibold text-gray-900">{fmtDate(targetDate)}</p>
        </div>
        {isConfirmed && (
          <span className="flex items-center gap-1.5 text-sm text-green-700 font-semibold bg-green-50 px-3 py-1.5 rounded-full border border-green-100">
            <CheckCircle2 size={15} /> Receipt Confirmed
          </span>
        )}
      </div>

      {/* No run yet */}
      {!run ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 text-center">
          <Package size={36} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No delivery scheduled yet for this date.</p>
        </div>
      ) : storeLines.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 text-center">
          <p className="text-sm text-gray-400">No items packed for {currentStore} on this run.</p>
        </div>
      ) : (
        <>
          {/* Packed items list */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">
                {storeLines.length} item{storeLines.length !== 1 ? 's' : ''} packed for you
              </span>
              {isConfirmed && (
                <span className="text-xs text-gray-400">
                  Confirmed at {new Date(receipt!.received_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide hidden sm:table-cell">Unit</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-[#1B5E20] uppercase tracking-wide">Qty Packed</th>
                </tr>
              </thead>
              <tbody>
                {sections.map(section => (
                  <React.Fragment key={section}>
                    <tr className="bg-gray-50">
                      <td colSpan={3} className="px-4 py-1.5">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{section}</span>
                      </td>
                    </tr>
                    {storeLines.filter(l => l.section === section).map(line => {
                      const qty = line.packed_qty ?? line.delivery_qty;
                      return (
                        <tr key={line.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-2.5 font-medium text-gray-800">{line.item_name}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-400 hidden sm:table-cell">{line.unit}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-md bg-[#1B5E20]/10 text-[#1B5E20] font-bold text-sm">
                              {qty}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Confirm receipt */}
          {!isConfirmed ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-700">Confirm delivery received</p>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any missing or damaged items? (optional)"
                rows={2}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]/40 placeholder-gray-300"
              />
              <button
                onClick={() => confirmReceipt.mutate()}
                disabled={confirmReceipt.isPending || !run.delivery_started_at}
                className="w-full flex items-center justify-center gap-2 bg-[#1B5E20] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#2E7D32] transition-colors disabled:opacity-50 shadow-sm"
                title={!run.delivery_started_at ? 'Delivery has not been started yet' : ''}
              >
                <ClipboardCheck size={17} />
                {confirmReceipt.isPending ? 'Confirming…' : 'Confirm All Received'}
              </button>
              {!run.delivery_started_at && (
                <p className="text-xs text-center text-gray-400">Delivery hasn't been started by the driver yet</p>
              )}
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-2">
              <div className="flex items-center gap-2 text-green-800 font-semibold">
                <CheckCircle2 size={18} className="text-green-500" /> Receipt confirmed
              </div>
              {receipt?.notes && (
                <p className="text-sm text-green-700 bg-white/60 rounded-lg p-2 border border-green-100">
                  <span className="font-medium">Note: </span>{receipt.notes}
                </p>
              )}
              <button
                onClick={() => confirmReceipt.mutate()}
                disabled={confirmReceipt.isPending}
                className="text-xs text-green-600 hover:text-green-800 underline"
              >
                Update confirmation
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function DeliveryPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [activeStore, setActiveStore] = useState<Store>('Eschborn');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  /* View mode */
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('delivery-view-mode') as ViewMode) ?? 'packer';
    }
    return 'packer';
  });

  const defaultDate = useMemo(() => getDefaultDeliveryDate(), []);
  const deliveryDateOptions = useMemo(() => getUpcomingDeliveryDates(24), []);

  /* Manager-selected delivery date; packer always uses default */
  const [managerDate, setManagerDate] = useState<string>(defaultDate);
  const targetDate = viewMode === 'manager' ? managerDate : defaultDate;
  const dayOfWeek = new Date(targetDate + 'T12:00:00').getDay();
  const stdDayKey = DOW_TO_STD_KEY[dayOfWeek] ?? 'mon';

  /* Inline edit state */
  const [editingTargets, setEditingTargets] = useState<Record<string, string>>({});
  const [editingPackedQty, setEditingPackedQty] = useState<Record<string, string>>({});

  /* Standard Targets modal */
  const [showStandards, setShowStandards] = useState(false);
  const [stdStore, setStdStore] = useState<Store>('Eschborn');
  const [stdEdits, setStdEdits] = useState<Record<string, { mon: number; tue: number; wed: number; fri: number; scales: boolean; scaleFactor: number }>>({});

  /* Upload Excel */
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  const setMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('delivery-view-mode', mode);
    if (mode !== 'manager') setEditingTargets({});
  };

  /* Packing timer */
  const [packingStarted, setPackingStarted] = useState(false);
  const [packingFinished, setPackingFinished] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const packingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const [startingDelivery, setStartingDelivery] = useState(false);
  const [finishingDelivery, setFinishingDelivery] = useState(false);

  useEffect(() => {
    return () => { if (packingInterval.current) clearInterval(packingInterval.current); };
  }, []);

  /* ─ Query: delivery run + live inventory (always fetched fresh) ─ */
  const { data: runData, isLoading } = useQuery({
    queryKey: ['delivery-run', targetDate],
    queryFn: async () => {
      // Always fetch the latest inventory submission per store (live, not baked-in snapshot)
      const invResults = await Promise.all(
        STORES.map(store =>
          supabase.from('inventory_submissions')
            .select('data')
            .eq('location_name', store)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        )
      );
      // Build map: store → { item_name_lower → quantity }
      const liveInventory: Partial<Record<Store, Record<string, number>>> = {};
      STORES.forEach((store, i) => {
        const sub = invResults[i].data;
        if (sub?.data) {
          const map: Record<string, number> = {};
          for (const item of sub.data as InventoryItem[]) {
            map[item.name.trim().toLowerCase()] = Number(item.quantity) || 0;
          }
          liveInventory[store] = map;
        }
      });

      const { data: run, error: runErr } = await supabase
        .from('delivery_runs').select('*').eq('delivery_date', targetDate).maybeSingle();
      if (runErr) throw runErr;

      // Run exists — return real lines
      if (run) {
        const { data: lines, error: linesErr } = await supabase
          .from('delivery_run_lines').select('*').eq('run_id', run.id)
          .order('location_name').order('section').order('item_name');
        if (linesErr) throw linesErr;
        return { run: run as DeliveryRun, lines: (lines ?? []) as DeliveryLine[], isPreview: false, liveInventory };
      }

      // No run yet — build a preview from delivery_targets (reported = 0)
      const dow = new Date(targetDate + 'T12:00:00').getDay();
      const dKey = DAY_KEY_MAP[dow] as DayKey | undefined;
      if (!dKey) return { run: null, lines: [] as DeliveryLine[], isPreview: true, liveInventory };

      const allTargetsResults = await Promise.all(
        STORES.map(store =>
          supabase.from('delivery_targets').select('*').eq('location_name', store)
            .order('section').order('item_name')
        )
      );

      const previewLines: DeliveryLine[] = [];
      STORES.forEach((store, i) => {
        const targets = (allTargetsResults[i].data ?? []) as DeliveryTarget[];
        for (const t of targets) {
          const baseTarget = (t[dKey] as number) ?? 0;
          previewLines.push({
            id: t.id,
            run_id: '',
            location_name: store,
            section: t.section,
            item_name: t.item_name,
            unit: t.unit,
            standard_target_qty: baseTarget,
            target_qty: baseTarget,
            reported_qty: 0,
            delivery_qty: baseTarget,
            is_packed: false,
            packed_qty: null,
          });
        }
      });

      return { run: null, lines: previewLines, isPreview: true, liveInventory };
    },
  });

  /* ─ Query: standards ─ */
  const { data: standards = [] } = useQuery<StoreDayStandard[]>({
    queryKey: ['store-day-standards'],
    queryFn: async () => {
      const { data, error } = await supabase.from('store_day_standards').select('*');
      if (error) throw error;
      return data as StoreDayStandard[];
    },
    staleTime: Infinity,
  });

  /* ─ Query: forecasts for selected date ─ */
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

  /* ─ Profile ─ */
  const { data: profile } = useQuery<(Profile & { locationName: string | null }) | null>({
    queryKey: ['delivery-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from('profiles').select('*, location:locations(name)').eq('id', user.id).single();
      if (!data) return null;
      return { ...(data as Profile), locationName: (data as any).location?.name ?? null };
    },
  });
  const canManage = profile?.role === 'admin' || profile?.role === 'manager';

  // For non-managers: auto-set view based on their role/location
  useEffect(() => {
    if (!profile || canManage) return;
    const locName = profile.locationName;
    if ((profile.permissions as any)?.driver) { setViewMode('driver'); return; }
    if (locName && STORES.includes(locName as Store)) { setViewMode('store'); return; }
    setViewMode('packer');
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which store does this user belong to? (for Store Manager auto-filter)
  const myStore: Store | null = (() => {
    const loc = profile?.locationName;
    return loc && STORES.includes(loc as Store) ? (loc as Store) : null;
  })();

  /* ─ Standard Targets query (modal only) ─ */
  const { data: stdTargetsData } = useQuery({
    queryKey: ['std-targets', stdStore],
    enabled: showStandards,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('delivery_targets').select('*').eq('location_name', stdStore)
        .order('section').order('item_name');
      if (error) throw error;
      return data as TargetRow[];
    },
  });
  const stdTargets = stdTargetsData ?? [];

  /* Initialise std edits when data loads */
  useEffect(() => {
    if (!stdTargetsData || stdTargetsData.length === 0) return;
    const initial: Record<string, { mon: number; tue: number; wed: number; fri: number; scales: boolean; scaleFactor: number }> = {};
    for (const t of stdTargetsData) {
      initial[t.id] = {
        mon: t.mon_target, tue: t.tue_target, wed: t.wed_target, fri: t.fri_target,
        scales: t.scales_with_demand ?? true,
        scaleFactor: t.demand_scale_factor ?? 1.0,
      };
    }
    setStdEdits(initial);
  }, [stdTargetsData]);

  /* ─ Save Standard Targets ─ */
  const saveStandards = useMutation({
    mutationFn: async () => {
      const payload = stdTargets.map(t => ({
        id: t.id,
        location_name: t.location_name,
        section: t.section,
        item_name: t.item_name,
        unit: t.unit,
        mon_target: stdEdits[t.id]?.mon ?? t.mon_target,
        tue_target: stdEdits[t.id]?.tue ?? t.tue_target,
        wed_target: stdEdits[t.id]?.wed ?? t.wed_target,
        fri_target: stdEdits[t.id]?.fri ?? t.fri_target,
        scales_with_demand: stdEdits[t.id]?.scales ?? t.scales_with_demand,
        demand_scale_factor: stdEdits[t.id]?.scaleFactor ?? t.demand_scale_factor ?? 1.0,
      }));
      const { error } = await supabase
        .from('delivery_targets').upsert(payload, { onConflict: 'location_name,item_name' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['std-targets'] });
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
      setShowStandards(false);
    },
  });

  const setStdEdit = (id: string, day: 'mon' | 'tue' | 'wed' | 'fri', val: string) => {
    const num = parseFloat(val);
    setStdEdits(prev => ({ ...prev, [id]: { ...prev[id], [day]: isNaN(num) ? 0 : num } }));
  };
  const setStdScales = (id: string, scales: boolean) => {
    setStdEdits(prev => ({ ...prev, [id]: { ...prev[id], scales } }));
  };
  const setStdScaleFactor = (id: string, val: string) => {
    const pct = parseFloat(val);
    const factor = isNaN(pct) ? 1.0 : Math.max(0, Math.min(200, pct)) / 100;
    setStdEdits(prev => ({ ...prev, [id]: { ...prev[id], scaleFactor: factor } }));
  };

  /* ─ Upload Excel ─ */
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
        scales_with_demand: true,  // always scale with forecast by default
      }));
      const { error } = await supabase
        .from('delivery_targets').upsert(payload, { onConflict: 'location_name,item_name' });
      if (error) throw error;
    },
    onSuccess: (_, rows) => {
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
      setUploadMsg(`Imported ${rows.length} items for ${activeStore}.`);
      setTimeout(() => setUploadMsg(''), 4000);
    },
    onError: (e: Error) => setUploadMsg(`Error: ${e.message}`),
  });

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
        const colD = row[3]; const colE = row[4]; const colF = row[5]; const colG = row[6];
        if (!colA) continue;
        const hasUnit = colC !== '';
        const hasNumbers = [colD, colE, colF, colG].some(v => v !== '' && !isNaN(Number(v)));
        if (!hasUnit && !hasNumbers) { currentSection = colA; continue; }
        parsed.push({
          section: currentSection, item_name: colA, unit: colC,
          mon_target: parseFloat(String(colD)) || 0,
          tue_target: parseFloat(String(colE)) || 0,
          wed_target: parseFloat(String(colF)) || 0,
          fri_target: parseFloat(String(colG)) || 0,
        });
      }
      if (parsed.length === 0) setUploadMsg('No data rows found in the file.');
      else upsertTargets.mutate(parsed);
    } catch (err: unknown) {
      setUploadMsg(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /* ─ Update target qty ─ */
  const updateTarget = useMutation({
    mutationFn: async ({ line, newTarget }: { line: DeliveryLine; newTarget: number }) => {
      const newDelivery = Math.max(0, newTarget - line.reported_qty);
      const { error } = await supabase
        .from('delivery_run_lines').update({ target_qty: newTarget, delivery_qty: newDelivery }).eq('id', line.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] }),
  });

  const handleTargetChange = (id: string, value: string) => setEditingTargets(prev => ({ ...prev, [id]: value }));
  const handleTargetBlur = (line: DeliveryLine, value: string) => {
    const parsed = parseFloat(value);
    const newTarget = isNaN(parsed) ? line.target_qty : Math.max(0, Math.round(parsed));
    if (newTarget !== line.target_qty) updateTarget.mutate({ line, newTarget });
    setEditingTargets(prev => { const next = { ...prev }; delete next[line.id]; return next; });
  };

  /* ─ Set packed qty ─ */
  const setPackedQty = useMutation({
    mutationFn: async ({ id, qty }: { id: string; qty: number | null }) => {
      const { error } = await supabase
        .from('delivery_run_lines').update({ packed_qty: qty, is_packed: qty !== null && qty > 0 }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] }),
  });

  const handlePackedQtyChange = (id: string, value: string) => setEditingPackedQty(prev => ({ ...prev, [id]: value }));
  const handlePackedQtyBlur = (id: string, value: string, _deliveryQty: number) => {
    if (value.trim() === '') setPackedQty.mutate({ id, qty: null });
    else {
      const parsed = Math.max(0, Math.round(parseFloat(value)));
      if (!isNaN(parsed)) setPackedQty.mutate({ id, qty: parsed });
    }
    setEditingPackedQty(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  /* ─ Packing timer ─ */
  const startPacking = async () => {
    setPackingStarted(true);
    packingInterval.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    if (run) {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('delivery_runs').update({
        packing_started_at: new Date().toISOString(), packed_by: user?.id ?? null,
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
        items_packed_count: totalPackStats.full + totalPackStats.partial,
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

  const finishDelivery = async () => {
    if (!run) return;
    setFinishingDelivery(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('delivery_runs').update({
        delivery_finished_at: new Date().toISOString(),
        delivery_finished_by: user?.id ?? null,
        status: 'completed',
      }).eq('id', run.id);
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    } finally {
      setFinishingDelivery(false);
    }
  };

  /* ─ Receipt status (for driver live view) ─ */
  const { data: receiptStatus = {} } = useQuery<Partial<Record<Store, boolean>>>({
    queryKey: ['store-receipts-status', run?.id],
    enabled: !!run?.id,
    refetchInterval: viewMode === 'driver' ? 15_000 : false,
    queryFn: async () => {
      const { data } = await supabase
        .from('store_delivery_receipts')
        .select('location_name, received_at')
        .eq('run_id', run!.id);
      const map: Partial<Record<Store, boolean>> = {};
      for (const r of data ?? []) map[r.location_name as Store] = !!r.received_at;
      return map;
    },
  });

  /* ─ Generate delivery list ─ */
  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError('');
    try {
      const dayKey = DAY_KEY_MAP[dayOfWeek] as DayKey;
      const { data: allStandards } = await supabase.from('store_day_standards').select('*').eq('day_of_week', stdDayKey);
      const { data: allForecasts } = await supabase.from('weekly_sales_forecasts').select('*').eq('forecast_date', targetDate).in('location_name', [...STORES]);

      const stdMap: Record<string, number> = {};
      for (const s of (allStandards ?? [])) stdMap[s.location_name] = s.standard_sales_eur;
      const forecastMap: Record<string, number> = {};
      for (const f of (allForecasts ?? [])) forecastMap[f.location_name] = f.forecasted_sales_eur;

      const storeData: { store: Store; submission: InventorySubmission | null; targets: DeliveryTarget[] }[] = [];
      for (const store of STORES) {
        const { data: submissions } = await supabase
          .from('inventory_submissions').select('*').eq('location_name', store)
          .order('submitted_at', { ascending: false }).limit(1);
        const { data: targets } = await supabase.from('delivery_targets').select('*').eq('location_name', store);
        storeData.push({
          store,
          submission: (submissions?.[0] as InventorySubmission | undefined) ?? null,
          targets: (targets ?? []) as DeliveryTarget[],
        });
      }

      const { data: runRow, error: runErr } = await supabase
        .from('delivery_runs').upsert({ delivery_date: targetDate, status: 'draft' }, { onConflict: 'delivery_date' })
        .select().single();
      if (runErr) throw runErr;

      const runId = (runRow as DeliveryRun).id;
      await supabase.from('delivery_run_lines').delete().eq('run_id', runId);

      const allLines: Omit<DeliveryLine, 'id' | 'created_at'>[] = [];
      for (const { store, submission, targets } of storeData) {
        const standardSales = stdMap[store] ?? 0;
        const forecastedSales = forecastMap[store] ?? null;
        for (const target of targets) {
          const baseTarget = target[dayKey] ?? 0;
          let effectiveTarget: number;
          if (target.scales_with_demand && forecastedSales !== null && standardSales > 0) {
            const rawRatio = forecastedSales / standardSales;
            const factor = target.demand_scale_factor ?? 1.0;
            // factor=1 → fully proportional; factor=0.5 → half the swing; factor=0 → fixed
            const adjustedRatio = 1 + (rawRatio - 1) * factor;
            effectiveTarget = Math.round(baseTarget * Math.max(0, adjustedRatio));
          } else {
            effectiveTarget = baseTarget;
          }
          effectiveTarget = Math.max(0, effectiveTarget);

          let reportedQty = 0;
          if (submission?.data && Array.isArray(submission.data)) {
            const found = (submission.data as InventoryItem[]).find(
              item => item.name.trim().toLowerCase() === target.item_name.trim().toLowerCase()
            );
            if (found) reportedQty = Number(found.quantity) || 0;
          }
          const deliveryQty = Math.max(0, effectiveTarget - reportedQty);
          allLines.push({
            run_id: runId, location_name: store, section: target.section,
            item_name: target.item_name, unit: target.unit,
            standard_target_qty: baseTarget, target_qty: effectiveTarget,
            reported_qty: reportedQty, delivery_qty: deliveryQty,
            is_packed: false, packed_qty: null,
          });
        }
      }

      if (allLines.length > 0) {
        const { error: linesErr } = await supabase.from('delivery_run_lines').insert(allLines);
        if (linesErr) throw linesErr;
      }

      const allSubmitted = storeData.every(s => s.submission !== null);
      await supabase.from('delivery_runs').update({ status: allSubmitted ? 'ready' : 'draft' }).eq('id', runId);

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
  const isPreview = runData?.isPreview ?? false;
  const liveInventory = runData?.liveInventory ?? {};

  const storeLines = (store: Store) => lines.filter(l => l.location_name === store);
  const storeHasSubmission = (store: Store) => storeLines(store).length > 0 || run !== null;

  const storePackStats = (store: Store) => {
    const sl = storeLines(store).filter(l => l.delivery_qty > 0);
    const full    = sl.filter(l => l.packed_qty !== null && l.packed_qty >= l.delivery_qty).length;
    const partial = sl.filter(l => l.packed_qty !== null && l.packed_qty > 0 && l.packed_qty < l.delivery_qty).length;
    return { full, partial, total: sl.length, complete: sl.length > 0 && full === sl.length };
  };

  const totalPackStats = STORES.reduce(
    (acc, store) => { const { full, partial, total } = storePackStats(store); return { full: acc.full + full, partial: acc.partial + partial, total: acc.total + total }; },
    { full: 0, partial: 0, total: 0 }
  );

  const getStoreForecast = (store: Store): WeeklyForecast | null => forecasts.find(f => f.location_name === store) ?? null;
  const getStoreStandard = (store: Store): number => {
    const s = standards.find(s => s.location_name === store && s.day_of_week === stdDayKey);
    return s?.standard_sales_eur ?? 0;
  };

  /* ─────────────────────────────────────────────────────────────────────── */
  return (
    <>
      {/* ── Standard Targets Modal ── */}
      {showStandards && (() => {
        const stdGrouped = SECTIONS.reduce<Record<string, TargetRow[]>>((acc, sec) => {
          acc[sec] = stdTargets.filter(t => t.section === sec);
          return acc;
        }, {});
        const stdOther = [...new Set(stdTargets.map(t => t.section).filter(s => !new Set(SECTIONS).has(s)))];
        const stdAllSections = [...SECTIONS, ...stdOther];

        return (
          <>
            <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setShowStandards(false)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none">
              <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-3xl max-h-[88vh] pointer-events-auto">
                {/* Header */}
                <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <SlidersHorizontal size={16} className="text-[#1B5E20]" />
                      <h2 className="text-base font-semibold text-gray-900">Standard Targets</h2>
                    </div>
                    <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
                      {STORES.map(store => (
                        <button key={store} onClick={() => setStdStore(store)}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${stdStore === store ? 'bg-white text-[#1B5E20] shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
                        >{store}</button>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => setShowStandards(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors mt-0.5">
                    <X size={18} />
                  </button>
                </div>
                {/* Table */}
                <div className="flex-1 overflow-y-auto">
                  {stdTargets.length === 0 ? (
                    <div className="p-8 text-center text-sm text-gray-400">No targets uploaded yet for {stdStore}.</div>
                  ) : (
                    <table className="w-full text-sm border-collapse">
                      <thead className="sticky top-0 z-10 bg-white border-b-2 border-gray-200">
                        <tr>
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                          <th className="px-2 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Unit</th>
                          {(['MON','TUE','WED','FRI'] as const).map(d => (
                            <th key={d} className="px-2 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide w-16">{d}</th>
                          ))}
                          <th className="px-2 py-2.5 text-center text-xs font-semibold text-blue-500 uppercase tracking-wide w-16" title="Does this item scale with the sales forecast?">Scales?</th>
                          <th className="px-2 py-2.5 text-center text-xs font-semibold text-blue-500 uppercase tracking-wide w-20" title="100% = fully proportional. 50% = half the swing. 0% = fixed.">Scale %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stdAllSections.map(section => {
                          const sectionRows = stdGrouped[section] ?? stdTargets.filter(t => t.section === section);
                          if (sectionRows.length === 0) return null;
                          return (
                            <React.Fragment key={section}>
                              <tr className="bg-green-50">
                                <td colSpan={8} className="px-5 py-1.5">
                                  <span className="text-[11px] font-bold text-[#1B5E20] uppercase tracking-wider">{section}</span>
                                </td>
                              </tr>
                              {sectionRows.map(row => {
                                const scales = stdEdits[row.id]?.scales ?? row.scales_with_demand ?? true;
                                const scaleFactor = stdEdits[row.id]?.scaleFactor ?? row.demand_scale_factor ?? 1.0;
                                return (
                                <tr key={row.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                                  <td className="px-5 py-2 text-sm text-gray-800">{row.item_name}</td>
                                  <td className="px-2 py-2 text-xs text-gray-400">{row.unit}</td>
                                  {(['mon','tue','wed','fri'] as const).map(day => (
                                    <td key={day} className="px-2 py-1.5 text-center">
                                      <input
                                        type="number" min={0} step={1}
                                        value={stdEdits[row.id]?.[day] ?? (row as any)[`${day}_target`]}
                                        onChange={e => setStdEdit(row.id, day, e.target.value)}
                                        className="w-14 text-center text-sm border border-gray-200 rounded-md py-1 px-1 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]/50"
                                      />
                                    </td>
                                  ))}
                                  {/* Scales toggle */}
                                  <td className="px-2 py-1.5 text-center">
                                    <input
                                      type="checkbox"
                                      checked={scales}
                                      onChange={e => setStdScales(row.id, e.target.checked)}
                                      className="w-4 h-4 rounded accent-[#1B5E20] cursor-pointer"
                                    />
                                  </td>
                                  {/* Scale % */}
                                  <td className="px-2 py-1.5 text-center">
                                    {scales ? (
                                      <div className="relative inline-flex items-center">
                                        <input
                                          type="number" min={0} max={200} step={10}
                                          value={Math.round(scaleFactor * 100)}
                                          onChange={e => setStdScaleFactor(row.id, e.target.value)}
                                          className="w-16 text-center text-sm border border-blue-200 rounded-md py-1 px-1 focus:outline-none focus:ring-2 focus:ring-blue-300/40 focus:border-blue-400/50"
                                        />
                                        <span className="absolute right-1.5 text-xs text-gray-400 pointer-events-none">%</span>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-gray-300">—</span>
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
                  )}
                </div>
                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0 flex items-center justify-between bg-gray-50/50 rounded-b-2xl">
                  <div>
                    <p className="text-xs text-gray-400">Changes update the base targets for all future runs.</p>
                    <p className="text-xs text-blue-400 mt-0.5"><span className="font-semibold">Scale %:</span> 100% = fully proportional · 50% = half the swing · 0% = fixed quantity</p>
                  </div>
                  <button
                    onClick={() => saveStandards.mutate()}
                    disabled={saveStandards.isPending || stdTargets.length === 0}
                    className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-50"
                  >
                    <Save size={15} />
                    {saveStandards.isPending ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* Hidden file input */}
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />

      <div>
        {/* ── Page header ── */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Truck size={20} className="text-[#1B5E20]" />
              <h1 className="text-2xl font-bold text-gray-900">Packing</h1>
            </div>
            <p className="text-sm text-gray-500">Mon · Tue · Wed · Fri — departs ZK at 14:00</p>
          </div>

          <div className="flex items-center gap-3 flex-wrap justify-end">
            {/* 4-toggle — managers only */}
            {canManage && (
              <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5">
                {([
                  { mode: 'manager' as ViewMode, icon: Settings2,    label: 'Manager' },
                  { mode: 'packer'  as ViewMode, icon: Eye,          label: 'Packer'  },
                  { mode: 'driver'  as ViewMode, icon: Navigation,   label: 'Driver'  },
                  { mode: 'store'   as ViewMode, icon: Store,        label: 'Store'   },
                ] as const).map(({ mode, icon: Icon, label }) => (
                  <button key={mode} onClick={() => setMode(mode)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${viewMode === mode ? 'bg-white text-[#1B5E20] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>
            )}

            {/* Packer: Start Packing / timer / Finish */}
            {viewMode === 'packer' && run && !packingFinished && (
              !packingStarted ? (
                <button onClick={startPacking} className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors shadow-sm">
                  <Play size={15} /> Start Packing
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
                    <Timer size={14} className="text-[#1B5E20]" />
                    <span className="font-mono font-bold text-gray-800 tabular-nums text-sm">{formatTimer(elapsedSeconds)}</span>
                  </div>
                  <button onClick={finishPacking} className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors shadow-sm">
                    <Flag size={15} /> Packing Finished
                  </button>
                </div>
              )
            )}

            {/* Manager: Generate */}
            {viewMode === 'manager' && (
              <button onClick={handleGenerate} disabled={generating} className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-60 shadow-sm">
                {generating ? <><RefreshCw size={15} className="animate-spin" /> Generating…</> : <><RefreshCw size={15} /> {run ? 'Regenerate' : 'Generate List'}</>}
              </button>
            )}
          </div>
        </div>

        {/* ── Manager toolbar: date picker + Standard Targets + Upload Excel ── */}
        {viewMode === 'manager' && (
          <div className="flex items-center gap-3 flex-wrap mb-5 p-3 bg-gray-50 border border-gray-100 rounded-xl">
            {/* Date picker */}
            <div className="flex items-center gap-2">
              <CalendarDays size={15} className="text-gray-400 flex-shrink-0" />
              <label className="text-xs text-gray-500 font-medium whitespace-nowrap">Delivery Date:</label>
              <select
                value={managerDate}
                onChange={e => setManagerDate(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 min-w-[180px]"
              >
                {deliveryDateOptions.map(opt => (
                  <option key={opt.date} value={opt.date}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="h-5 w-px bg-gray-200 hidden sm:block" />

            {/* Standard Targets */}
            <button
              onClick={() => { setStdStore(activeStore); setShowStandards(true); }}
              className="flex items-center gap-1.5 text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 bg-white shadow-sm hover:bg-gray-50 transition-colors"
            >
              <SlidersHorizontal size={14} /> Standard Targets
            </button>

            {/* Upload Excel */}
            {uploadMsg && (
              <span className={`text-xs font-medium px-2.5 py-1 rounded-lg ${uploadMsg.startsWith('Error') || uploadMsg.startsWith('Parse') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
                {uploadMsg}
              </span>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || upsertTargets.isPending}
              className="flex items-center gap-1.5 text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 bg-white shadow-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <Upload size={14} /> {uploading || upsertTargets.isPending ? 'Importing…' : 'Upload Excel'}
            </button>
          </div>
        )}

        {/* ── Date banner (packer view) ── */}
        {viewMode === 'packer' && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Delivery Date</p>
            <p className="text-base font-semibold text-gray-900">{fmtDate(targetDate)}</p>
          </div>
        )}

        {/* ── Packing finished banner ── */}
        {packingFinished && (
          <div className="mb-5 flex items-center gap-4 p-4 bg-green-50 border border-green-200 rounded-xl">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 size={22} className="text-[#1B5E20]" />
            </div>
            <div>
              <p className="font-semibold text-green-900">Packing complete!</p>
              <p className="text-sm text-green-700">
                {totalPackStats.full} fully packed{totalPackStats.partial > 0 && `, ${totalPackStats.partial} partial`}{' '}
                out of {totalPackStats.total} items — <strong>{formatDuration(elapsedSeconds)}</strong>
              </p>
            </div>
          </div>
        )}

        {generateError && (
          <div className="mb-4 flex items-center gap-3 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
            <AlertCircle size={16} className="flex-shrink-0" /> {generateError}
          </div>
        )}

        {/* ── Driver view ── */}
        {viewMode === 'driver' && (
          <DriverView
            run={run}
            targetDate={targetDate}
            onStart={startDelivery}
            onFinish={finishDelivery}
            startingDelivery={startingDelivery}
            finishingDelivery={finishingDelivery}
            receiptStatus={receiptStatus}
          />
        )}

        {/* ── Store manager receipt view ── */}
        {viewMode === 'store' && (
          <StoreManagerView
            run={run}
            lines={lines}
            targetDate={targetDate}
            myStore={myStore}
          />
        )}

        {/* ── Packing list (manager + packer views) ── */}
        {(viewMode === 'manager' || viewMode === 'packer') && (
          isLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}</div>
          ) : lines.length === 0 ? (
            /* No targets configured at all */
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
              <Package size={40} className="mx-auto text-gray-200 mb-4" />
              <p className="text-base font-semibold text-gray-400 mb-1">No targets configured</p>
              <p className="text-sm text-gray-300">
                Upload standard targets via the Manager view to get started.
              </p>
            </div>
          ) : (
            <>
              {/* Preview banner — shown when no real run exists yet */}
              {isPreview && (
                <div className="mb-5 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <AlertCircle size={17} className="flex-shrink-0 text-amber-500 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-amber-800">Showing standard targets — inventory not yet reported</p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      Quantities below are based on standard targets only. Once inventory reports come in,{' '}
                      {viewMode === 'manager' ? 'click "Generate List" to calculate actual delivery quantities.' : 'ask a manager to generate the list.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Store tabs */}
              <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit">
                {STORES.map(store => {
                  const { full, total, complete } = storePackStats(store);
                  const isActive = activeStore === store;
                  const isPacker = viewMode === 'packer';
                  return (
                    <button key={store} onClick={() => setActiveStore(store)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${isActive ? 'bg-white text-[#1B5E20] shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      {store}
                      {isPacker && packingStarted ? (
                        complete
                          ? <CheckCircle2 size={14} className="text-[#1B5E20]" />
                          : <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold leading-none ${isActive ? 'bg-[#1B5E20] text-white' : 'bg-gray-300 text-gray-600'}`}>{full}/{total}</span>
                      ) : (
                        total > 0 && <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold leading-none ${isActive ? 'bg-[#1B5E20] text-white' : 'bg-gray-300 text-gray-600'}`}>{total}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Store lists */}
              {STORES.map(store => (
                <div key={store} className={activeStore === store ? 'block' : 'hidden'}>
                  <StoreDeliveryList
                    store={store}
                    lines={storeLines(store)}
                    hasSubmission={storeHasSubmission(store)}
                    isActive={activeStore === store}
                    onPackedQtyBlur={handlePackedQtyBlur}
                    forecast={getStoreForecast(store)}
                    standard={getStoreStandard(store)}
                    viewMode={viewMode as 'packer' | 'manager'}
                    editingTargets={editingTargets}
                    editingPackedQty={editingPackedQty}
                    onTargetChange={handleTargetChange}
                    onTargetBlur={handleTargetBlur}
                    onPackedQtyChange={handlePackedQtyChange}
                    packingStarted={packingStarted}
                    isPreview={isPreview}
                    storeInventory={liveInventory[store] ?? {}}
                  />
                </div>
              ))}
            </>
          )
        )}
      </div>
    </>
  );
}
