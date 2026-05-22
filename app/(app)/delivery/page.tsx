'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  RefreshCw, CheckCircle2, AlertCircle, Package, TrendingUp,
  Eye, Settings2, Truck, Play, Timer, Flag, XCircle,
  SlidersHorizontal, Save, X, CalendarDays,
  Navigation, Store, ClipboardCheck, Clock, Lock, LockOpen,
  ClipboardList,
} from 'lucide-react';
import type { Profile } from '@/types';
import { useT } from '@/lib/i18n';

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

/* ─── Fallback section order (used while DB loads) ───────────────────────── */
const SECTION_ORDER_FALLBACK = ['Kühlhaus', 'Tiefkühler', 'Trockenware', 'Regale', 'Lager'];

function canonicalSections(sectionNames: string[], sectionOrder: string[]): string[] {
  return [...sectionNames].sort((a, b) => {
    const ia = sectionOrder.indexOf(a);
    const ib = sectionOrder.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

function canonicalItems<T extends { item_name: string }>(items: T[], itemRank: Record<string, number>): T[] {
  return [...items].sort((a, b) => {
    const ia = itemRank[a.item_name] ?? 9999;
    const ib = itemRank[b.item_name] ?? 9999;
    return ia !== ib ? ia - ib : a.item_name.localeCompare(b.item_name);
  });
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
  lists_checked_at: string | null;
  lists_checked_by: string | null;
  list_confirmed_eschborn_at: string | null;
  list_confirmed_taunus_at:   string | null;
  list_confirmed_westend_at:  string | null;
  day_locked_at:  string | null;
  day_locked_by:  string | null;
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
const STORES = ['Eschborn', 'Taunus', 'Westend', 'ZK'] as const;
type Store = typeof STORES[number];

const STORE_CONFIRM_COL: Partial<Record<Store, keyof DeliveryRun>> = {
  Eschborn: 'list_confirmed_eschborn_at',
  Taunus:   'list_confirmed_taunus_at',
  Westend:  'list_confirmed_westend_at',
};

const SECTIONS_FALLBACK = ['Kühlhaus', 'Tiefkühler', 'Trockenware', 'Regale', 'Lager'];

const DELIVERY_DAYS = [1, 2, 3, 5]; // Mon=1 Tue=2 Wed=3 Fri=5
type DayKey = 'mon_target' | 'tue_target' | 'wed_target' | 'fri_target';

const DELIVERY_DAY_BUTTONS = [
  { dow: 1, label: 'Mon', offset: 0 },
  { dow: 2, label: 'Tue', offset: 1 },
  { dow: 3, label: 'Wed', offset: 2 },
  { dow: 5, label: 'Fri', offset: 4 },
] as const;

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

/** Packer's current delivery: today if delivery day and before 16:00, else next delivery day. */
function getPackerDeliveryDate(): string {
  const now = new Date();
  const CUTOFF_HOUR = 16; // 14:00 departs + 2 h grace
  // If today is a delivery day and we're before the cutoff, today is still active
  if (DELIVERY_DAYS.includes(now.getDay()) && now.getHours() < CUTOFF_HOUR) {
    return toLocalDateString(now);
  }
  // Otherwise advance to the next delivery day
  for (let i = 1; i <= 7; i++) {
    const next = new Date(now);
    next.setDate(now.getDate() + i);
    if (DELIVERY_DAYS.includes(next.getDay())) return toLocalDateString(next);
  }
  return toLocalDateString(now);
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

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return toLocalDateString(d);
}

function getISOWeek(d: Date): number {
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Returns surrounding delivery weeks: 2 past + current + 4 future */
function getDeliveryWeeks(): { weekStart: string; label: string }[] {
  const now  = new Date();
  const curMonday = new Date(now);
  const curDow = now.getDay();
  curMonday.setDate(now.getDate() - (curDow === 0 ? 6 : curDow - 1));
  curMonday.setHours(0, 0, 0, 0);

  const weeks = [];
  for (let i = -2; i <= 4; i++) {
    const mon = new Date(curMonday);
    mon.setDate(curMonday.getDate() + i * 7);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const weekNum = getISOWeek(mon);
    const monLbl  = mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const sunLbl  = sun.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const isCur   = i === 0;
    weeks.push({
      weekStart: toLocalDateString(mon),
      label: `W${weekNum} — ${monLbl} – ${sunLbl}${isCur ? '  (this week)' : ''}`,
    });
  }
  return weeks;
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
  if (packedQty === deliveryQty) return <CheckCircle2 size={17} className="text-green-600 mx-auto" />;
  if (packedQty > deliveryQty)   return <CheckCircle2 size={17} className="text-orange-400 mx-auto" />;
  if (packedQty > 0)             return <CheckCircle2 size={17} className="text-orange-400 mx-auto" />;
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
  storeInventory, storeTimestamp, stdScaleMode, onScaleChange, scalingTargets, storeConfirmed,
  sectionOrder, itemRank,
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
  storeInventory: Record<string, number>;
  storeTimestamp?: string;
  stdScaleMode: 'low' | 'std' | 'high';
  onScaleChange: (mode: 'low' | 'std' | 'high') => void;
  scalingTargets?: boolean;
  storeConfirmed?: boolean;
  sectionOrder: string[];
  itemRank: Record<string, number>;
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
  const colCount = isManager ? 8 : 5;

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
  const sections = canonicalSections([...new Set(lines.map(l => l.section))], sectionOrder);

  const fullCount    = itemsToDeliver.filter(l => l.packed_qty !== null && l.packed_qty >= l.delivery_qty).length;
  const partialCount = itemsToDeliver.filter(l => l.packed_qty !== null && l.packed_qty > 0 && l.packed_qty < l.delivery_qty).length;
  const noneCount    = itemsToDeliver.filter(l => l.packed_qty !== null && l.packed_qty === 0).length;

  return (
    <div className={isActive ? 'block' : 'hidden'}>
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
              {/* Row 1 (manager only): scale toggle spanning the 3 STD columns */}
              {isManager && (
                <tr className="border-b border-gray-100">
                  <th colSpan={3} />
                  <th colSpan={3} className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1">
                      {(['low', 'std', 'high'] as const).map(mode => {
                        const label = mode === 'low' ? 'STD −25%' : mode === 'high' ? 'STD +25%' : 'STD';
                        const active = stdScaleMode === mode;
                        return (
                          <button
                            key={mode}
                            onClick={() => onScaleChange(mode)}
                            disabled={scalingTargets || storeConfirmed}
                            title={storeConfirmed ? 'De-confirm the store to change scale' : undefined}
                            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${
                              active
                                ? 'bg-[#1B5E20] text-white shadow-sm'
                                : 'text-gray-500 hover:bg-gray-200'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </th>
                  <th colSpan={2} />
                </tr>
              )}
              {/* Row 2: column headers */}
              <tr>
                <th className="px-3 md:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                {isManager
                  ? <th className="px-3 md:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                  : <th className="hidden sm:table-cell px-3 md:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                }
                {isManager && <>
                  <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Current Inventory
                    {storeTimestamp && (
                      <div className="text-gray-400 font-medium normal-case tracking-normal mt-0.5 text-xs">
                        {new Date(storeTimestamp).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </th>
                  <th className={`px-3 md:px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide ${stdScaleMode === 'low' ? 'text-[#1B5E20]' : 'text-gray-400'}`}>STD −25%</th>
                  <th className={`px-3 md:px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide ${stdScaleMode === 'std' ? 'text-[#1B5E20]' : 'text-gray-400'}`}>Std Target</th>
                  <th className={`px-3 md:px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide ${stdScaleMode === 'high' ? 'text-[#1B5E20]' : 'text-gray-400'}`}>STD +25%</th>
                  <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Target Today</th>
                </>}
                <th className={`px-3 md:px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide ${isManager ? 'text-[#1B5E20]' : 'text-[#1B5E20]'}`}>To Pack</th>
                {!isManager && <>
                  <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Packed</th>
                  <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Full / Partial</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {sections.map((section, sIdx) => {
                const sectionLines = canonicalItems(lines.filter(l => l.section === section), itemRank);
                return (
                  <React.Fragment key={section}>
                    {/* Section separator gap (packer only, not first section) */}
                    {!isManager && sIdx > 0 && (
                      <tr><td colSpan={colCount} className="pt-2 bg-gray-50" /></tr>
                    )}
                    {/* Section header */}
                    <tr className={isManager ? 'bg-gray-50' : 'bg-[#1B5E20]'}>
                      <td colSpan={colCount} className={isManager ? 'px-3 md:px-4 py-2' : 'px-4 py-2.5'}>
                        <span className={isManager
                          ? 'text-xs font-semibold text-gray-500 uppercase tracking-wider'
                          : 'text-xs font-bold text-white uppercase tracking-widest'
                        }>{section}</span>
                      </td>
                    </tr>
                    {sectionLines.map((line, lineIdx) => {
                      const deliverQty = liveDeliveryQty(line);
                      const muted = deliverQty === 0;
                      const targetVal = editingTargets[line.id] ?? String(line.target_qty);
                      const packedVal = editingPackedQty[line.id] ?? (line.packed_qty !== null ? String(line.packed_qty) : '');
                      const isEven = lineIdx % 2 === 0;

                      return (
                        <tr key={line.id} className={`border-t border-gray-100 transition-colors ${
                          muted
                            ? 'opacity-30'
                            : isManager
                              ? 'hover:bg-gray-50/50'
                              : isEven ? 'bg-white hover:bg-green-50/30' : 'bg-gray-50/50 hover:bg-green-50/30'
                        }`}>
                          <td className={`px-3 md:px-4 ${isManager ? 'py-2.5' : 'py-3'} font-medium ${muted ? 'text-gray-400' : 'text-gray-800'}`}>
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
                            {/* STD −25% */}
                            <td className={`px-3 md:px-4 py-2.5 text-center tabular-nums ${stdScaleMode === 'low' ? 'text-[#1B5E20] font-semibold' : 'text-gray-400'}`}>
                              {Math.round(line.standard_target_qty * 0.75)}
                            </td>
                            {/* STD TARGET */}
                            <td className={`px-3 md:px-4 py-2.5 text-center tabular-nums ${stdScaleMode === 'std' ? 'text-[#1B5E20] font-semibold' : 'text-gray-400'}`}>
                              {line.standard_target_qty}
                            </td>
                            {/* STD +25% */}
                            <td className={`px-3 md:px-4 py-2.5 text-center tabular-nums ${stdScaleMode === 'high' ? 'text-[#1B5E20] font-semibold' : 'text-gray-400'}`}>
                              {Math.round(line.standard_target_qty * 1.25)}
                            </td>
                            <td className="px-3 md:px-4 py-2.5 text-center">
                              {isPreview || storeConfirmed ? (
                                <span className={`tabular-nums ${storeConfirmed ? 'text-gray-500' : 'text-gray-400'}`}>
                                  {line.target_qty}
                                </span>
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
                              <span className={`inline-flex items-center justify-center tabular-nums font-bold rounded-lg ${
                                isManager
                                  ? 'min-w-[2rem] px-2 py-0.5 bg-[#1B5E20]/10 text-[#1B5E20] text-sm'
                                  : 'min-w-[2.5rem] px-3 py-1 bg-[#1B5E20] text-white text-base shadow-sm'
                              }`}>{deliverQty}</span>
                            ) : <span className="text-gray-200 text-xs">—</span>}
                          </td>
                          {!isManager && (
                            <td className="px-2 md:px-4 py-3 text-center">
                              {deliverQty > 0 ? (
                                <input
                                  type="number" min="0" step="1"
                                  value={packedVal}
                                  placeholder="—"
                                  disabled={!canPack}
                                  onChange={e => onPackedQtyChange(line.id, e.target.value)}
                                  onBlur={e => onPackedQtyBlur(line.id, e.target.value, deliverQty)}
                                  className={`w-16 text-center border rounded-lg px-1.5 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#1B5E20] tabular-nums ${!canPack ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed' : 'border-gray-300 bg-white'}`}
                                  title={!canPack ? 'Start packing first' : ''}
                                />
                              ) : <span className="text-gray-200 text-xs">—</span>}
                            </td>
                          )}
                          {!isManager && (
                            <td className="px-2 md:px-4 py-3 text-center">
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
function StoreManagerView({ run, lines, targetDate, myStore, sectionOrder, itemRankByStore }: {
  run: DeliveryRun | null;
  lines: DeliveryLine[];
  targetDate: string;
  myStore: Store | null; // null = manager viewing all (shows tabs)
  sectionOrder: string[];
  itemRankByStore: Partial<Record<Store, Record<string, number>>>;
}) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Store>(myStore ?? 'Eschborn');
  const [notes, setNotes] = useState('');
  const [itemComplete, setItemComplete] = useState<Record<string, boolean>>({});
  const [itemActualQty, setItemActualQty] = useState<Record<string, string>>({});

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
  const storeItemRank = itemRankByStore[currentStore] ?? {};
  const sections = canonicalSections([...new Set(storeLines.map(l => l.section))], sectionOrder);

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
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between min-w-[320px]">
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                  <th className="hidden sm:table-cell px-3 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide">Unit</th>
                  <th className="py-3 text-center text-xs font-semibold text-[#1B5E20] uppercase tracking-wide" style={{ width: '60px' }}>Packed</th>
                  <th className="py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ width: '72px' }}>Received</th>
                  <th className="py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ width: '60px' }}>OK?</th>
                </tr>
              </thead>
              <tbody>
                {sections.map(section => (
                  <React.Fragment key={section}>
                    <tr className="bg-gray-50">
                      <td colSpan={5} className="px-4 py-2">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{section}</span>
                      </td>
                    </tr>
                    {canonicalItems(storeLines.filter(l => l.section === section), storeItemRank).map(line => {
                      const qty = line.packed_qty ?? line.delivery_qty;
                      const isComplete = !!itemComplete[line.id];
                      return (
                        <tr key={line.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3 font-medium text-gray-800 text-sm leading-snug">{line.item_name}</td>
                          <td className="hidden sm:table-cell px-3 py-3 text-xs text-gray-400 text-center">{line.unit}</td>
                          <td className="py-3 text-center">
                            <span className="inline-flex items-center justify-center w-9 h-7 rounded-md bg-[#1B5E20]/10 text-[#1B5E20] font-bold text-sm">
                              {qty}
                            </span>
                          </td>
                          <td className="py-3 text-center">
                            {!isComplete ? (
                              <input
                                type="number"
                                min={0}
                                value={itemActualQty[line.id] ?? ''}
                                onChange={e => setItemActualQty(prev => ({ ...prev, [line.id]: e.target.value }))}
                                placeholder={String(qty)}
                                className="w-14 text-center text-sm border border-gray-200 rounded-md px-1 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]/40"
                              />
                            ) : (
                              <span className="text-sm text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-3 text-center">
                            <button
                              onClick={() => setItemComplete(prev => ({ ...prev, [line.id]: !prev[line.id] }))}
                              className={`w-10 h-8 rounded-full text-sm font-bold transition-colors ${
                                isComplete
                                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                  : 'bg-red-100 text-red-600 hover:bg-red-200'
                              }`}
                            >
                              {isComplete ? '✓' : '✗'}
                            </button>
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
  const { t } = useT();

  /* ── DB: canonical sections + item order (Inventory Lists source of truth) ── */
  const { data: dbSections = [] } = useQuery<{ id: string; name: string; sort_order: number }[]>({
    queryKey: ['inventory-sections'],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_sections').select('id, name, sort_order').order('sort_order');
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const { data: dbItems = [] } = useQuery<{ id: string; name: string; sort_order: number; store_sort_orders: Record<string, number> | null }[]>({
    queryKey: ['inventory-items-all'],
    queryFn: async () => {
      const { data } = await supabase.from('inventory_items').select('id, name, sort_order, store_sort_orders').order('sort_order');
      return data ?? [];
    },
    staleTime: 60_000,
  });

  /* ── ZK-specific sections + items (packing list mirrors ZK Inventory Lists) ── */
  const { data: zkSections = [] } = useQuery<{ name: string; sort_order: number }[]>({
    queryKey: ['inventory-sections', 'ZK'],
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory_sections')
        .select('name, sort_order')
        .contains('stores', ['ZK'])
        .order('sort_order');
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const { data: zkItemsRaw = [] } = useQuery<{ name: string; section: string; sort_order: number; store_sort_orders: Record<string, number> | null }[]>({
    queryKey: ['inventory-items', 'ZK'],
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory_items')
        .select('name, section, sort_order, store_sort_orders')
        .contains('stores', ['ZK'])
        .order('sort_order');
      return data ?? [];
    },
    staleTime: 60_000,
  });

  /** ZK section order — used for packing list */
  const zkSectionOrder = useMemo(
    () => zkSections.length > 0 ? zkSections.map(s => s.name) : SECTION_ORDER_FALLBACK,
    [zkSections],
  );

  /** item_name → ZK physical section */
  const zkItemSection = useMemo<Record<string, string>>(
    () => Object.fromEntries(zkItemsRaw.map(i => [i.name, i.section])),
    [zkItemsRaw],
  );

  /** item_name → ZK sort rank */
  const zkItemRank = useMemo<Record<string, number>>(
    () => Object.fromEntries(zkItemsRaw.map(i => [
      i.name,
      (i.store_sort_orders as Record<string, number> | null)?.['ZK'] ?? i.sort_order ?? 9999,
    ])),
    [zkItemsRaw],
  );

  const sectionOrder = useMemo(
    () => dbSections.length > 0 ? dbSections.map(s => s.name) : SECTION_ORDER_FALLBACK,
    [dbSections],
  );

  /**
   * Per-store item ranks — mirrors exactly how Inventory Lists sorts items:
   * uses store_sort_orders[store] as primary key, falls back to global sort_order.
   */
  const itemRankByStore = useMemo<Partial<Record<Store, Record<string, number>>>>(() => {
    const result: Partial<Record<Store, Record<string, number>>> = {};
    for (const store of STORES) {
      const rank: Record<string, number> = {};
      for (const item of dbItems) {
        rank[item.name] = (item.store_sort_orders as Record<string, number> | null)?.[store] ?? item.sort_order ?? 9999;
      }
      result[store] = rank;
    }
    return result;
  }, [dbItems]);

  /** Global fallback rank (used when store is unknown) */
  const itemRank = useMemo<Record<string, number>>(
    () => Object.fromEntries(dbItems.map(item => [item.name, item.sort_order ?? 9999])),
    [dbItems],
  );

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

  const defaultDate  = useMemo(() => getDefaultDeliveryDate(), []);
  const deliveryWeeks = useMemo(() => getDeliveryWeeks(), []);

  /* Manager date selection: week + day-of-week */
  const [selectedWeek, setSelectedWeek] = useState<string>(() => getMondayOfWeek(getDefaultDeliveryDate()));
  const [selectedDow,  setSelectedDow]  = useState<number>(() => new Date(getDefaultDeliveryDate() + 'T12:00:00').getDay());

  const managerDate = useMemo(() => {
    const btn = DELIVERY_DAY_BUTTONS.find(b => b.dow === selectedDow);
    if (!btn) return defaultDate;
    const d = new Date(selectedWeek + 'T12:00:00');
    d.setDate(d.getDate() + btn.offset);
    return toLocalDateString(d);
  }, [selectedWeek, selectedDow, defaultDate]);

  // Packer date: auto-advances past 16:00; re-evaluated every minute
  const [packerDate, setPackerDate] = useState<string>(() => getPackerDeliveryDate());
  useEffect(() => {
    const id = setInterval(() => setPackerDate(getPackerDeliveryDate()), 60_000);
    return () => clearInterval(id);
  }, []);

  const targetDate = viewMode === 'manager' ? managerDate : packerDate;
  const dayOfWeek = new Date(targetDate + 'T12:00:00').getDay();
  const stdDayKey = DOW_TO_STD_KEY[dayOfWeek] ?? 'mon';

  /* Inline edit state */
  const [editingTargets, setEditingTargets] = useState<Record<string, string>>({});
  const [editingPackedQty, setEditingPackedQty] = useState<Record<string, string>>({});

  /* Standard Targets modal */
  const [showStandards, setShowStandards] = useState(false);
  const [stdStore, setStdStore] = useState<Store>('Eschborn');
  const [stdEdits, setStdEdits] = useState<Record<string, { mon: number; tue: number; wed: number; fri: number }>>({});

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
  const [confirmingList, setConfirmingList] = useState(false);
  const [confirmingStore, setConfirmingStore] = useState<Store | null>(null);
  const [lockingDay, setLockingDay] = useState(false);

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
            .select('data, submitted_at')
            .eq('location_name', store)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        )
      );
      // Build map: store → { item_name_lower → quantity }
      const liveInventory: Partial<Record<Store, Record<string, number>>> = {};
      const liveInventoryTimestamps: Partial<Record<Store, string>> = {};
      STORES.forEach((store, i) => {
        const sub = invResults[i].data;
        if (sub?.data) {
          const map: Record<string, number> = {};
          for (const item of sub.data as InventoryItem[]) {
            map[item.name.trim().toLowerCase()] = Number(item.quantity) || 0;
          }
          liveInventory[store] = map;
          if ((sub as any).submitted_at) liveInventoryTimestamps[store] = (sub as any).submitted_at;
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
        return { run: run as DeliveryRun, lines: (lines ?? []) as DeliveryLine[], isPreview: false, liveInventory, liveInventoryTimestamps };
      }

      // No run yet — build a preview from delivery_targets (reported = 0)
      const dow = new Date(targetDate + 'T12:00:00').getDay();
      const dKey = DAY_KEY_MAP[dow] as DayKey | undefined;
      if (!dKey) return { run: null, lines: [] as DeliveryLine[], isPreview: true, liveInventory, liveInventoryTimestamps };

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

      return { run: null, lines: previewLines, isPreview: true, liveInventory, liveInventoryTimestamps };
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

  // For non-managers: auto-set view based on their role/location/permissions
  const permsKey = JSON.stringify(profile?.permissions ?? null);
  useEffect(() => {
    if (!profile || canManage) return;
    const perms = profile.permissions as any;
    const locName = profile.locationName;
    // Packer takes priority — check BEFORE location-based store routing
    if (perms?.driver)                              { setViewMode('driver'); return; }
    if (perms?.packer)                              { setViewMode('packer'); return; }
    if (perms?.store_receiver)                      { setViewMode('store');  return; }
    if (locName && STORES.includes(locName as Store)) { setViewMode('store');  return; }
    // Fallback: default to packer
    setViewMode('packer');
  }, [profile?.id, permsKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const initial: Record<string, { mon: number; tue: number; wed: number; fri: number }> = {};
    for (const t of stdTargetsData) {
      initial[t.id] = {
        mon: t.mon_target, tue: t.tue_target, wed: t.wed_target, fri: t.fri_target,
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
      }));
      const { error } = await supabase
        .from('delivery_targets').upsert(payload, { onConflict: 'location_name,item_name' });
      if (error) throw error;

      // Sync standard_target_qty on any already-generated run lines
      if (run) {
        const dow = new Date(targetDate + 'T12:00:00').getDay();
        const dKey = DAY_KEY_MAP[dow] as DayKey | undefined;
        if (dKey) {
          await Promise.all(payload.map(p => {
            const newStd = Math.max(0, p[dKey as keyof typeof p] as number ?? 0);
            return supabase
              .from('delivery_run_lines')
              .update({ standard_target_qty: newStd })
              .eq('run_id', run.id)
              .eq('location_name', p.location_name)
              .eq('item_name', p.item_name);
          }));
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['std-targets'] });
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
      setShowStandards(false);
    },
  });

  /* ─ Delete all Standard Targets for current store ─ */
  const deleteStandards = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('delivery_targets').delete().eq('location_name', stdStore);
      if (error) throw error;

      // Zero out standard_target_qty on any already-generated run lines
      if (run) {
        await supabase
          .from('delivery_run_lines')
          .update({ standard_target_qty: 0 })
          .eq('run_id', run.id)
          .eq('location_name', stdStore);
      }
    },
    onSuccess: () => {
      setStdEdits({});
      qc.invalidateQueries({ queryKey: ['std-targets', stdStore] });
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    },
  });

  const setStdEdit = (id: string, day: 'mon' | 'tue' | 'wed' | 'fri', val: string) => {
    const num = parseFloat(val);
    setStdEdits(prev => ({ ...prev, [id]: { ...prev[id], [day]: isNaN(num) ? 0 : num } }));
  };

  /* ─ Std scale mode (per store) ─ */
  type ScaleMode = 'low' | 'std' | 'high';
  const [stdScaleMode, setStdScaleMode] = useState<Record<Store, ScaleMode>>({
    Eschborn: 'std', Taunus: 'std', Westend: 'std', ZK: 'std',
  });

  const scaleTargets = useMutation({
    mutationFn: async ({ store, mode }: { store: Store; mode: ScaleMode }) => {
      if (!run) return;
      const factor = mode === 'low' ? 0.75 : mode === 'high' ? 1.25 : 1.0;
      const storeInv = liveInventory[store] ?? {};
      const storeLines = lines.filter(l => l.location_name === store);
      await Promise.all(storeLines.map(l => {
        const newTarget = Math.round(l.standard_target_qty * factor);
        const inv = storeInv[l.item_name.trim().toLowerCase()] ?? l.reported_qty;
        const newDelivery = Math.max(0, newTarget - inv);
        return supabase.from('delivery_run_lines')
          .update({ target_qty: newTarget, delivery_qty: newDelivery })
          .eq('id', l.id);
      }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] }),
  });

  const handleScaleChange = (store: Store, mode: ScaleMode) => {
    setStdScaleMode(prev => ({ ...prev, [store]: mode }));
    scaleTargets.mutate({ store, mode });
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

      // Capture inventory snapshot at time of delivery completion
      const invResults = await Promise.all(
        STORES.map(store =>
          supabase.from('inventory_submissions')
            .select('submitted_at')
            .eq('location_name', store)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        )
      );
      const inventorySnapshot: Record<string, { submitted_at: string }> = {};
      STORES.forEach((store, i) => {
        const sub = invResults[i].data;
        if (sub?.submitted_at) inventorySnapshot[store] = { submitted_at: sub.submitted_at };
      });

      await supabase.from('delivery_runs').update({
        delivery_finished_at: new Date().toISOString(),
        delivery_finished_by: user?.id ?? null,
        status: 'completed',
        delivery_snapshot: { inventories: inventorySnapshot, snapped_at: new Date().toISOString() },
      }).eq('id', run.id);
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    } finally {
      setFinishingDelivery(false);
    }
  };

  /* ─ Derived state (needed before receiptStatus query) ─ */
  const run = runData?.run ?? null;
  const lines = runData?.lines ?? [];
  const isPreview = runData?.isPreview ?? false;
  const liveInventory = runData?.liveInventory ?? {};
  const liveInventoryTimestamps = runData?.liveInventoryTimestamps ?? {};

  const confirmList = async () => {
    if (!run) return;
    setConfirmingList(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('delivery_runs').update({
        lists_checked_at: new Date().toISOString(),
        lists_checked_by: user?.id ?? null,
      }).eq('id', run.id);
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    } finally {
      setConfirmingList(false);
    }
  };

  const confirmStore = async (store: Store) => {
    if (!run) return;
    setConfirmingStore(store);
    try {
      const col = STORE_CONFIRM_COL[store];
      if (!col) return; // ZK has no confirm column
      const now = new Date().toISOString();
      await supabase.from('delivery_runs').update({ [col]: now }).eq('id', run.id);
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    } finally {
      setConfirmingStore(null);
    }
  };

  const [deconfirmingStore, setDeconfirmingStore] = useState<Store | null>(null);
  const deconfirmStore = async (store: Store) => {
    if (!run) return;
    setDeconfirmingStore(store);
    try {
      const col = STORE_CONFIRM_COL[store];
      if (!col) return; // ZK has no confirm column
      await supabase.from('delivery_runs').update({ [col]: null }).eq('id', run.id);
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    } finally {
      setDeconfirmingStore(null);
    }
  };

  const lockDay = async () => {
    if (!run) return;
    setLockingDay(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('delivery_runs').update({
        day_locked_at: new Date().toISOString(),
        day_locked_by: user?.id ?? null,
        lists_checked_at: new Date().toISOString(),
        lists_checked_by: user?.id ?? null,
      }).eq('id', run.id);
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    } finally {
      setLockingDay(false);
    }
  };

  const unlockDay = async () => {
    if (!run) return;
    setLockingDay(true);
    try {
      await supabase.from('delivery_runs').update({
        day_locked_at: null,
        day_locked_by: null,
      }).eq('id', run.id);
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    } finally {
      setLockingDay(false);
    }
  };

  /* ─ Per-store confirmation derived state ─ */
  const storeConfirmedAt = (store: Store): string | null => {
    const col = STORE_CONFIRM_COL[store];
    return (run && col) ? (run[col] as string | null) : null;
  };
  // ZK has no confirm column — only require the 3 restaurant stores to be confirmed
  const allStoresConfirmed = STORES.filter(s => s in STORE_CONFIRM_COL).every(s => !!storeConfirmedAt(s));
  const dayLocked = !!run?.day_locked_at;
  const deliveryStarted = !!run?.delivery_started_at;

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
      // ZK is the production kitchen — excluded from delivery runs
      const deliveryStores = STORES.filter(s => s !== 'ZK');

      type InvItemRow = { name: string; section: string; unit: string; sort_order: number; store_sort_orders: Record<string, number> | null };
      const storeData: {
        store: Store;
        submission: InventorySubmission | null;
        invItems: InvItemRow[];
        targetMap: Map<string, DeliveryTarget>;
      }[] = [];

      for (const store of deliveryStores) {
        const { data: submissions } = await supabase
          .from('inventory_submissions').select('*').eq('location_name', store)
          .order('submitted_at', { ascending: false }).limit(1);

        const { data: invItemsRaw } = await supabase
          .from('inventory_items')
          .select('name, section, unit, sort_order, store_sort_orders')
          .contains('stores', [store])
          .order('sort_order', { ascending: true });

        const { data: targets } = await supabase
          .from('delivery_targets').select('*').eq('location_name', store);

        // Build target lookup by item name (case-insensitive)
        const targetMap = new Map<string, DeliveryTarget>();
        for (const t of (targets ?? []) as DeliveryTarget[]) {
          targetMap.set(t.item_name.trim().toLowerCase(), t);
        }

        // Sort items by per-store rank, falling back to global sort_order
        const invItems = ((invItemsRaw ?? []) as InvItemRow[]).sort((a, b) => {
          const ra = a.store_sort_orders?.[store] ?? a.sort_order ?? 9999;
          const rb = b.store_sort_orders?.[store] ?? b.sort_order ?? 9999;
          return ra - rb;
        });

        storeData.push({
          store,
          submission: (submissions?.[0] as InventorySubmission | undefined) ?? null,
          invItems,
          targetMap,
        });
      }

      const { data: runRow, error: runErr } = await supabase
        .from('delivery_runs').upsert({ delivery_date: targetDate, status: 'draft' }, { onConflict: 'delivery_date' })
        .select().single();
      if (runErr) throw runErr;

      const runId = (runRow as DeliveryRun).id;
      await supabase.from('delivery_run_lines').delete().eq('run_id', runId);

      const allLines: Omit<DeliveryLine, 'id' | 'created_at'>[] = [];
      for (const { store, submission, invItems, targetMap } of storeData) {
        for (const item of invItems) {
          const target = targetMap.get(item.name.trim().toLowerCase());
          const effectiveTarget = Math.max(0, (target?.[dayKey] as number | undefined) ?? 0);

          let reportedQty = 0;
          if (submission?.data && Array.isArray(submission.data)) {
            const found = (submission.data as InventoryItem[]).find(
              i => i.name.trim().toLowerCase() === item.name.trim().toLowerCase()
            );
            if (found) reportedQty = Number(found.quantity) || 0;
          }
          const deliveryQty = Math.max(0, effectiveTarget - reportedQty);
          allLines.push({
            run_id: runId, location_name: store, section: item.section,
            item_name: item.name, unit: item.unit,
            standard_target_qty: effectiveTarget, target_qty: effectiveTarget,
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
        const activeSections = sectionOrder.length > 0 ? sectionOrder : SECTIONS_FALLBACK;
        const stdGrouped = activeSections.reduce<Record<string, TargetRow[]>>((acc, sec) => {
          acc[sec] = stdTargets.filter(t => t.section === sec);
          return acc;
        }, {});
        const stdOther = [...new Set(stdTargets.map(t => t.section).filter(s => !new Set(activeSections).has(s)))];
        const stdAllSections = [...activeSections, ...stdOther];

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
                        </tr>
                      </thead>
                      <tbody>
                        {stdAllSections.map(section => {
                          const sectionRows = stdGrouped[section] ?? stdTargets.filter(t => t.section === section);
                          if (sectionRows.length === 0) return null;
                          return (
                            <React.Fragment key={section}>
                              <tr className="bg-green-50">
                                <td colSpan={6} className="px-5 py-1.5">
                                  <span className="text-[11px] font-bold text-[#1B5E20] uppercase tracking-wider">{section}</span>
                                </td>
                              </tr>
                              {sectionRows.map(row => (
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
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0 flex items-center justify-between bg-gray-50/50 rounded-b-2xl">
                  <p className="text-xs text-gray-400">Changes update the base targets for all future runs.</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (!window.confirm(`Delete ALL standard targets for ${stdStore}? This cannot be undone.`)) return;
                        deleteStandards.mutate();
                      }}
                      disabled={saveStandards.isPending || deleteStandards.isPending || stdTargets.length === 0}
                      className="flex items-center gap-2 border border-red-200 text-red-500 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      {deleteStandards.isPending ? 'Deleting…' : 'Reset'}
                    </button>
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
            </div>
          </>
        );
      })()}

      <div>
        {/* ── Page header ── */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {viewMode === 'manager'
                ? <ClipboardList size={20} className="text-[#1B5E20]" />
                : viewMode === 'packer'
                  ? <Package size={20} className="text-[#1B5E20]" />
                  : <Truck size={20} className="text-[#1B5E20]" />}
              <h1 className="text-2xl font-bold text-gray-900">
                {viewMode === 'manager' ? 'List confirmation' : viewMode === 'packer' ? 'Packing' : viewMode === 'driver' ? 'Delivery' : 'Delivery'}
              </h1>
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
              <button
                onClick={handleGenerate}
                disabled={generating || dayLocked}
                title={dayLocked ? 'Day is locked — unlock to regenerate' : undefined}
                className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-60 shadow-sm"
              >
                {generating ? <><RefreshCw size={15} className="animate-spin" /> Generating…</> : <><RefreshCw size={15} /> {run ? 'Regenerate' : 'Generate List'}</>}
              </button>
            )}
          </div>
        </div>

        {/* ── Manager toolbar: week + day picker + Standard Targets ── */}
        {viewMode === 'manager' && (
          <div className="mb-5 p-3 bg-gray-50 border border-gray-100 rounded-xl space-y-3">

            {/* Row 1: Week selector */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <CalendarDays size={15} className="text-gray-400 flex-shrink-0" />
                <label className="text-xs text-gray-500 font-medium whitespace-nowrap">Week:</label>
                <select
                  value={selectedWeek}
                  onChange={e => setSelectedWeek(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 min-w-[220px]"
                >
                  {deliveryWeeks.map(w => (
                    <option key={w.weekStart} value={w.weekStart}>{w.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2: Delivery day buttons + lock controls + Standard Targets (right-aligned) */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Delivery Day:</span>
              {DELIVERY_DAY_BUTTONS.map(btn => {
                const isActive = selectedDow === btn.dow;
                const isLocked = isActive && dayLocked;
                const d = new Date(selectedWeek + 'T12:00:00');
                d.setDate(d.getDate() + btn.offset);
                const dayNum = d.getDate();
                const monAbbr = d.toLocaleDateString('en-GB', { month: 'short' });
                return (
                  <button
                    key={btn.dow}
                    onClick={() => setSelectedDow(btn.dow)}
                    className={`relative flex flex-col items-center px-5 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                      isActive
                        ? isLocked
                          ? 'bg-gray-700 border-gray-700 text-white shadow-sm'
                          : 'bg-[#1B5E20] border-[#1B5E20] text-white shadow-sm'
                        : 'border-gray-200 text-gray-600 bg-white hover:border-[#1B5E20] hover:text-[#1B5E20]'
                    }`}
                  >
                    <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide leading-tight">
                      {isLocked && <Lock size={9} />}
                      {btn.label}
                    </span>
                    <span className={`text-[10px] leading-tight mt-0.5 ${isActive ? 'text-gray-200' : 'text-gray-400'}`}>{dayNum} {monAbbr}</span>
                  </button>
                );
              })}

              {/* Lock / Unlock controls */}
              {run && !isPreview && (
                dayLocked ? (
                  !deliveryStarted && (
                    <button
                      onClick={unlockDay}
                      disabled={lockingDay}
                      className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-600 bg-white shadow-sm hover:bg-gray-50 transition-colors disabled:opacity-50 ml-2"
                    >
                      <LockOpen size={13} /> {lockingDay ? 'Unlocking…' : 'Unlock'}
                    </button>
                  )
                ) : (
                  allStoresConfirmed && (
                    <button
                      onClick={lockDay}
                      disabled={lockingDay}
                      className="flex items-center gap-1.5 text-sm border border-gray-700 rounded-lg px-3 py-2 text-gray-700 bg-white shadow-sm hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-50 ml-2"
                    >
                      <Lock size={13} /> {lockingDay ? 'Locking…' : 'Lock Day'}
                    </button>
                  )
                )
              )}

              {/* Standard Targets — right-aligned */}
              <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                <button
                  onClick={() => { setStdStore(activeStore); setShowStandards(true); }}
                  className="flex items-center gap-1.5 text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 bg-white shadow-sm hover:bg-gray-50 transition-colors"
                >
                  <SlidersHorizontal size={14} /> Standard Targets
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Date + confirmation banner (packer view) ── */}
        {viewMode === 'packer' && (
          <div className="flex gap-3 mb-5 flex-wrap">
            {/* Date card */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex-1 min-w-[160px]">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Delivery Date</p>
              <p className="text-base font-semibold text-gray-900">{fmtDate(targetDate)}</p>
            </div>

            {/* Confirmation status card */}
            {allStoresConfirmed ? (
              <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 shadow-sm p-4 flex-1 min-w-[220px]">
                <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 size={20} className="text-green-600" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-0.5">Status</p>
                  <p className="text-base font-bold text-green-800">Delivery confirmed ✓</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 shadow-sm p-4 flex-1 min-w-[220px]">
                <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertCircle size={20} className="text-red-500" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-0.5">Status</p>
                  <p className="text-base font-bold text-red-700">Delivery NOT confirmed yet</p>
                  <p className="text-xs text-red-400 mt-0.5">{STORES.filter(s => !!storeConfirmedAt(s)).length} of 3 stores confirmed</p>
                </div>
              </div>
            )}
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
            sectionOrder={sectionOrder}
            itemRankByStore={itemRankByStore}
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

              {/* Store tabs — with per-store confirmation badges */}
              <div className="flex gap-1 mb-3 bg-gray-100 rounded-xl p-1 w-fit">
                {STORES.map(store => {
                  const { full, total, complete } = storePackStats(store);
                  const isActive = activeStore === store;
                  const isPacker = viewMode === 'packer';
                  const confirmed = !!storeConfirmedAt(store);
                  return (
                    <button key={store} onClick={() => setActiveStore(store)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${isActive ? 'bg-white text-[#1B5E20] shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      {store}
                      {/* Manager view: show confirmation checkmark */}
                      {viewMode === 'manager' && run && !isPreview && (
                        confirmed
                          ? <CheckCircle2 size={13} className={isActive ? 'text-[#1B5E20]' : 'text-green-500'} />
                          : <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-amber-400' : 'bg-gray-300'}`} />
                      )}
                      {/* Packer view: show item counts */}
                      {isPacker && packingStarted && (
                        complete
                          ? <CheckCircle2 size={14} className="text-[#1B5E20]" />
                          : total > 0 && <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold leading-none ${isActive ? 'bg-[#1B5E20] text-white' : 'bg-gray-300 text-gray-600'}`}>{full}/{total}</span>
                      )}
                      {!isPacker && (viewMode !== 'manager' || isPreview || !run) && total > 0 && (
                        <span className={`text-xs rounded-full px-1.5 py-0.5 font-bold leading-none ${isActive ? 'bg-[#1B5E20] text-white' : 'bg-gray-300 text-gray-600'}`}>{total}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* ── Overall confirmation status banner (manager only, run exists, not preview) ── */}
              {viewMode === 'manager' && run && !isPreview && (
                allStoresConfirmed ? (
                  <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
                    <CheckCircle2 size={18} className="text-green-600 flex-shrink-0" />
                    <div className="flex-1">
                      <span className="text-sm font-bold text-green-800">All stores confirmed ✓</span>
                      <span className="text-xs text-green-600 ml-2">Ready to lock the day</span>
                    </div>
                  </div>
                ) : (
                  <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
                    <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
                    <div className="flex-1">
                      <span className="text-sm font-bold text-red-700">Delivery NOT confirmed yet</span>
                      <span className="text-xs text-red-400 ml-2">{STORES.filter(s => !!storeConfirmedAt(s)).length} of 3 stores confirmed</span>
                    </div>
                  </div>
                )
              )}

              {/* ── Per-store confirm banner (manager only, run exists, not preview, not locked) ── */}
              {viewMode === 'manager' && run && !isPreview && (() => {
                const confirmedAt = storeConfirmedAt(activeStore);
                if (confirmedAt) {
                  return (
                    <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
                      <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-green-800">{activeStore} confirmed</span>
                        <span className="text-xs text-green-600 ml-2">
                          {new Date(confirmedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-xs text-green-500 ml-2">· Table locked</span>
                      </div>
                      {!dayLocked && (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => confirmStore(activeStore)}
                            disabled={confirmingStore === activeStore || deconfirmingStore === activeStore}
                            className="text-xs text-green-600 hover:text-green-800 underline whitespace-nowrap"
                          >
                            Re-confirm
                          </button>
                          <button
                            onClick={() => deconfirmStore(activeStore)}
                            disabled={confirmingStore === activeStore || deconfirmingStore === activeStore}
                            className="text-xs text-red-500 hover:text-red-700 underline whitespace-nowrap"
                          >
                            {deconfirmingStore === activeStore ? 'De-confirming…' : 'De-confirm'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl shadow-sm">
                    <AlertCircle size={16} className="text-amber-500 flex-shrink-0" />
                    <p className="text-sm text-gray-700 flex-1">
                      Review the {activeStore} packing quantities, then confirm the list.
                    </p>
                    <button
                      onClick={() => confirmStore(activeStore)}
                      disabled={confirmingStore === activeStore}
                      className="flex items-center gap-1.5 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-60 whitespace-nowrap shadow-sm"
                    >
                      <CheckCircle2 size={14} />
                      {confirmingStore === activeStore ? 'Confirming…' : `Confirm ${activeStore}`}
                    </button>
                  </div>
                );
              })()}

              {/* Store lists */}
              {STORES.map(store => {
                // In packer view, remap each line's section to ZK's physical section
                // so the packing list mirrors ZK's Inventory Lists layout exactly.
                const isPacker = viewMode === 'packer';
                const displayLines = isPacker
                  ? storeLines(store).map(l => ({
                      ...l,
                      section: zkItemSection[l.item_name] ?? l.section,
                    }))
                  : storeLines(store);
                return (
                  <div key={store} className={activeStore === store ? 'block' : 'hidden'}>
                    <StoreDeliveryList
                      store={store}
                      lines={displayLines}
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
                      storeTimestamp={liveInventoryTimestamps[store]}
                      stdScaleMode={stdScaleMode[store]}
                      onScaleChange={mode => handleScaleChange(store, mode)}
                      scalingTargets={scaleTargets.isPending}
                      storeConfirmed={!!storeConfirmedAt(store)}
                      sectionOrder={isPacker ? zkSectionOrder : sectionOrder}
                      itemRank={isPacker ? zkItemRank : (itemRankByStore[store] ?? itemRank)}
                    />
                  </div>
                );
              })}
            </>
          )
        )}
      </div>
    </>
  );
}
