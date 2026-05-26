'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  RefreshCw, CheckCircle2, AlertCircle, Package, TrendingUp,
  Eye, Settings2, Truck, Play, Timer, Flag, XCircle,
  Save, X, CalendarDays,
  Navigation, Store, ClipboardCheck, Clock,
  ClipboardList, MessageSquare,
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
  store_packing_finished_at:  Record<string, string> | null;
  store_notes:                Record<string, string> | null;
  store_inventory_comments:   Record<string, string> | null;
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
type DayKey = 'mon' | 'tue' | 'wed' | 'fri';

const DELIVERY_DAY_BUTTONS = [
  { dow: 1, label: 'Mon', offset: 0 },
  { dow: 2, label: 'Tue', offset: 1 },
  { dow: 3, label: 'Wed', offset: 2 },
  { dow: 5, label: 'Fri', offset: 4 },
] as const;

const DAY_KEY_MAP: Record<number, DayKey> = {
  1: 'mon', 2: 'tue', 3: 'wed', 5: 'fri',
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
  sectionOrder, itemRank, packingFinished,
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
  packingFinished?: boolean;
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
  const canPack = !isPreview && (isManager || packingStarted) && !packingFinished;
  const colCount = isManager ? 8 : 5;

  // Packer toggle: true = "Yes, packed" (auto-fills packed = deliverQty), false = manual input
  const [packedYes, setPackedYes] = React.useState<Record<string, boolean>>({});

  function togglePackedYes(lineId: string, deliverQty: number) {
    const newVal = !packedYes[lineId];
    setPackedYes(p => ({ ...p, [lineId]: newVal }));
    if (newVal) {
      // Auto-save packed = deliverQty
      onPackedQtyBlur(lineId, String(deliverQty), deliverQty);
    } else {
      // Reset to empty so packer can enter manually
      onPackedQtyBlur(lineId, '', deliverQty);
    }
  }

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
                {isManager
                  ? <th className="px-3 md:px-4 py-3 text-center text-xs font-semibold text-[#1B5E20] uppercase tracking-wide">To Pack</th>
                  : <th className="py-3 text-center text-xs font-semibold text-[#1B5E20] uppercase tracking-wide" style={{ width: '52px' }}>To Pack</th>
                }
                {!isManager && <>
                  <th className="py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ width: '56px' }}>Packed?</th>
                  <th className="py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ width: '68px' }}>Packed</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {sections.map((section, sIdx) => {
                const sectionLines = canonicalItems(lines.filter(l => l.section === section), itemRank);
                // In packer view, skip entire section if nothing to pack
                const packerVisibleLines = !isManager ? sectionLines.filter(l => liveDeliveryQty(l) > 0) : sectionLines;
                if (!isManager && packerVisibleLines.length === 0) return null;
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
                      // Packer only sees items they actually need to pack
                      if (!isManager && muted) return null;
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
                          <td className={isManager ? 'px-2 md:px-4 py-2.5 text-center' : 'px-1 py-2.5 text-center'}>
                            {deliverQty > 0 ? (
                              <span className={`inline-flex items-center justify-center tabular-nums font-bold rounded-lg ${
                                isManager
                                  ? 'min-w-[2rem] px-2 py-0.5 bg-[#1B5E20]/10 text-[#1B5E20] text-sm'
                                  : 'min-w-[2.25rem] px-2 py-1 bg-blue-600 text-white text-base shadow-sm'
                              }`}>{deliverQty}</span>
                            ) : <span className="text-gray-200 text-xs">—</span>}
                          </td>
                          {!isManager && (() => {
                            const isYes = !!packedYes[line.id];
                            const currentPacked = isYes
                              ? deliverQty
                              : editingPackedQty[line.id] !== undefined
                                ? (editingPackedQty[line.id] === '' ? null : parseFloat(editingPackedQty[line.id]))
                                : line.packed_qty;
                            const packedColor = !canPack
                              ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                              : currentPacked === null || currentPacked === undefined
                                ? 'border-gray-300 bg-white text-gray-700'
                                : currentPacked >= deliverQty
                                  ? 'border-green-500 bg-green-500 text-white'
                                  : currentPacked > 0
                                    ? 'border-amber-400 bg-amber-400 text-white'
                                    : 'border-red-500 bg-red-500 text-white';
                            return (
                              <>
                                {/* Packed? toggle */}
                                <td className="px-1 py-3 text-center">
                                  {deliverQty > 0 ? (
                                    <button
                                      disabled={!canPack}
                                      onClick={() => togglePackedYes(line.id, deliverQty)}
                                      title={isYes ? 'Mark as not packed' : 'Mark as packed'}
                                      className={`w-9 h-9 rounded-lg flex items-center justify-center mx-auto transition-colors shadow-sm border ${
                                        !canPack
                                          ? 'bg-gray-50 border-gray-100 cursor-not-allowed opacity-40'
                                          : isYes
                                            ? 'bg-green-500 border-green-500 hover:bg-green-600 text-white'
                                            : 'bg-red-500 border-red-500 hover:bg-red-600 text-white'
                                      }`}
                                    >
                                      {isYes
                                        ? <CheckCircle2 size={16} />
                                        : <XCircle size={16} />
                                      }
                                    </button>
                                  ) : <span className="text-gray-200 text-xs">—</span>}
                                </td>
                                {/* Packed qty — auto-filled when Yes, manual when No */}
                                <td className="px-1 py-3 text-center">
                                  {deliverQty > 0 ? (
                                    isYes ? (
                                      <span className="inline-flex items-center justify-center w-14 py-1.5 text-base font-bold rounded-lg border border-green-500 bg-green-500 text-white tabular-nums shadow-sm">
                                        {deliverQty}
                                      </span>
                                    ) : (
                                      <input
                                        type="number" min="0" step="1"
                                        value={packedVal}
                                        placeholder="—"
                                        disabled={!canPack}
                                        onChange={e => onPackedQtyChange(line.id, e.target.value)}
                                        onBlur={e => onPackedQtyBlur(line.id, e.target.value, deliverQty)}
                                        className={`w-14 text-center border rounded-lg px-1 py-1.5 text-base font-bold focus:outline-none focus:ring-2 focus:ring-blue-400 tabular-nums shadow-sm ${packedColor}`}
                                        title={!canPack ? 'Start packing first' : ''}
                                      />
                                    )
                                  ) : <span className="text-gray-200 text-xs">—</span>}
                                </td>
                              </>
                            );
                          })()}
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

  // Packing done: use new per-store system if available, else fall back to legacy field
  const DELIVERY_STORES_DV = ['Eschborn', 'Taunus', 'Westend'];
  const dvStoreTs   = run?.store_packing_finished_at ?? null;
  const dvStoreMap  = dvStoreTs ?? {};
  const dvAllPacked = DELIVERY_STORES_DV.every(s => !!dvStoreMap[s]);
  const packingDone = run ? (dvStoreTs !== null ? dvAllPacked : !!run.packing_finished_at) : false;
  const canStart      = packingDone && !run?.delivery_started_at;
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
  const [editing, setEditing] = useState(false); // true = re-editing after confirmed
  // itemOk: undefined = untouched (red X), true = green ✓, false = red X (after toggle)
  const [itemOk, setItemOk] = useState<Record<string, boolean | undefined>>({});
  // itemManualQty: manual received qty entered when OK? is red
  const [itemManualQty, setItemManualQty] = useState<Record<string, string>>({});

  const currentStore = myStore ?? activeTab;
  // Only show rows actually in the van:
  // - packed_qty > 0 (packer confirmed a qty), OR
  // - packed_qty is null AND delivery_qty > 0 (scheduled but not individually confirmed — assumed in van)
  // Excludes: delivery_qty = 0, or packed_qty explicitly set to 0
  const storeLines = lines.filter(l =>
    l.location_name === currentStore &&
    (
      (l.packed_qty !== null && l.packed_qty > 0) ||
      (l.packed_qty === null && l.delivery_qty > 0)
    )
  );

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
      setEditing(false);
    },
  });

  const isConfirmed = !!receipt?.received_at;
  const locked = isConfirmed && !editing; // inputs locked once confirmed, unlocked when editing

  // When receipt is deleted externally (e.g. Reports page Reset), clear all local UI state
  useEffect(() => {
    if (!isConfirmed) {
      setItemOk({});
      setItemManualQty({});
      setEditing(false);
      setNotes('');
    }
  }, [isConfirmed]);
  const storeItemRank = itemRankByStore[currentStore] ?? {};
  const sections = canonicalSections([...new Set(storeLines.map(l => l.section))], sectionOrder);

  return (
    <div className="space-y-4">
      {/* Store tabs — only shown to managers viewing all stores */}
      {!myStore && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {STORES.filter(s => s !== 'ZK').map(s => (
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
            <div className="px-4 py-3 border-b border-gray-100 min-w-[320px]">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">
                  {storeLines.length} item{storeLines.length !== 1 ? 's' : ''} packed for you
                </span>
                {isConfirmed && (
                  <span className="text-xs text-gray-400">
                    Confirmed at {new Date(receipt!.received_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <span className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="inline-flex items-center justify-center w-6 h-5 rounded bg-[#1B5E20]/10 text-[#1B5E20] font-bold text-xs">n</span>
                  confirmed packed qty
                </span>
                <span className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="inline-flex items-center justify-center w-6 h-5 rounded bg-gray-100 text-gray-400 font-bold text-xs border border-dashed border-gray-300">n</span>
                  scheduled qty (not confirmed)
                </span>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                  <th className="hidden sm:table-cell px-3 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide">Unit</th>
                  <th className="py-3 text-center text-xs font-semibold text-[#1B5E20] uppercase tracking-wide" style={{ width: '60px' }}>Packed</th>
                  <th className="py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ width: '60px' }}>OK?</th>
                  <th className="py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ width: '72px' }}>Received</th>
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
                      const isConfirmedPacked = line.packed_qty !== null;
                      const packedQty = isConfirmedPacked ? line.packed_qty! : line.delivery_qty;
                      const okState = itemOk[line.id]; // undefined=untouched (red), true=green, false=red
                      const isOk = okState === true;
                      return (
                        <tr key={line.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3 font-medium text-gray-800 text-sm leading-snug">{line.item_name}</td>
                          <td className="hidden sm:table-cell px-3 py-3 text-xs text-gray-400 text-center">{line.unit}</td>
                          {/* Packed */}
                          <td className="py-3 text-center">
                            {isConfirmedPacked ? (
                              <span className="inline-flex items-center justify-center w-9 h-7 rounded-md bg-[#1B5E20]/10 text-[#1B5E20] font-bold text-sm">
                                {packedQty}
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center justify-center w-9 h-7 rounded-md bg-gray-100 text-gray-400 font-bold text-sm border border-dashed border-gray-300"
                                title="Scheduled quantity — packer did not confirm individual items"
                              >
                                {packedQty}
                              </span>
                            )}
                          </td>
                          {/* OK? toggle — locked after Send */}
                          <td className="py-3 text-center">
                            {locked ? (
                              <span className={`w-10 h-8 rounded-full text-sm font-bold inline-flex items-center justify-center ${
                                isOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                              }`}>
                                {isOk ? '✓' : '✗'}
                              </span>
                            ) : (
                              <button
                                onClick={() => setItemOk(prev => ({ ...prev, [line.id]: !prev[line.id] }))}
                                className={`w-10 h-8 rounded-full text-sm font-bold transition-colors ${
                                  isOk
                                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                    : 'bg-red-100 text-red-600 hover:bg-red-200'
                                }`}
                              >
                                {isOk ? '✓' : '✗'}
                              </button>
                            )}
                          </td>
                          {/* Received — locked after Send */}
                          <td className="py-3 text-center">
                            {isOk ? (
                              <span className="inline-flex items-center justify-center w-9 h-7 rounded-md bg-green-50 text-green-700 font-bold text-sm border border-green-200">
                                {packedQty}
                              </span>
                            ) : locked ? (
                              <span className="text-gray-400 text-sm font-bold">
                                {itemManualQty[line.id] || '—'}
                              </span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                value={itemManualQty[line.id] ?? ''}
                                onChange={e => setItemManualQty(prev => ({ ...prev, [line.id]: e.target.value }))}
                                placeholder="—"
                                className="w-14 text-center text-sm border border-gray-200 rounded-md px-1 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]/40"
                              />
                            )}
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
          {(!isConfirmed || editing) ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Confirm delivery received</p>
                {editing && (
                  <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:text-gray-600">
                    Cancel
                  </button>
                )}
              </div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any missing or damaged items? (optional)"
                rows={2}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]/40 placeholder-gray-300"
              />
              <button
                onClick={() => confirmReceipt.mutate()}
                disabled={confirmReceipt.isPending}
                className="w-full flex items-center justify-center gap-2 bg-[#1B5E20] text-white py-3 rounded-xl font-semibold text-sm hover:bg-[#2E7D32] transition-colors disabled:opacity-50 shadow-sm"
              >
                <ClipboardCheck size={17} />
                {confirmReceipt.isPending ? 'Sending…' : 'Send'}
              </button>
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
                onClick={() => { setNotes(receipt?.notes ?? ''); setEditing(true); }}
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
  const [finishingPackingStore, setFinishingPackingStore] = useState<Store | null>(null);
  const [confirmingList, setConfirmingList] = useState(false);
  const [confirmingStore, setConfirmingStore] = useState<Store | null>(null);
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
            .select('data, submitted_at, comment')
            .eq('location_name', store)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        )
      );
      // Build map: store → { item_name_lower → quantity }
      const liveInventory: Partial<Record<Store, Record<string, number>>> = {};
      const liveInventoryTimestamps: Partial<Record<Store, string>> = {};
      const liveInventoryComments: Partial<Record<Store, string>> = {};
      STORES.forEach((store, i) => {
        const sub = invResults[i].data;
        if (sub?.data) {
          const map: Record<string, number> = {};
          for (const item of sub.data as InventoryItem[]) {
            map[item.name.trim().toLowerCase()] = Number(item.quantity) || 0;
          }
          liveInventory[store] = map;
          if ((sub as any).submitted_at) liveInventoryTimestamps[store] = (sub as any).submitted_at;
          if ((sub as any).comment)      liveInventoryComments[store]  = (sub as any).comment;
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
        return { run: run as DeliveryRun, lines: (lines ?? []) as DeliveryLine[], isPreview: false, liveInventory, liveInventoryTimestamps, liveInventoryComments };
      }

      // No run yet — build a preview from store_targets (reported = 0)
      const dow = new Date(targetDate + 'T12:00:00').getDay();
      const dKey = DAY_KEY_MAP[dow] as DayKey | undefined;
      if (!dKey) return { run: null, lines: [] as DeliveryLine[], isPreview: true, liveInventory, liveInventoryTimestamps };

      type PreviewItemRow = { id: string; name: string; section: string; unit: string; sort_order: number; store_sort_orders: Record<string, number> | null; store_targets: Record<string, Record<string, number>> | null };
      const deliveryStores = STORES.filter(s => s !== 'ZK');
      const previewItemResults = await Promise.all(
        deliveryStores.map(store =>
          supabase.from('inventory_items')
            .select('id, name, section, unit, sort_order, store_sort_orders, store_targets')
            .contains('stores', [store])
        )
      );

      const previewLines: DeliveryLine[] = [];
      deliveryStores.forEach((store, i) => {
        const items = ((previewItemResults[i].data ?? []) as PreviewItemRow[])
          .filter(item => (item.store_targets?.[store]?.[dKey] ?? 0) > 0)
          .sort((a, b) => {
            const ra = a.store_sort_orders?.[store] ?? a.sort_order ?? 9999;
            const rb = b.store_sort_orders?.[store] ?? b.sort_order ?? 9999;
            return ra - rb;
          });
        for (const item of items) {
          const baseTarget = item.store_targets![store][dKey] as number;
          previewLines.push({
            id: item.id,
            run_id: '',
            location_name: store,
            section: item.section,
            item_name: item.name,
            unit: item.unit,
            standard_target_qty: baseTarget,
            target_qty: baseTarget,
            reported_qty: 0,
            delivery_qty: baseTarget,
            is_packed: false,
            packed_qty: null,
          });
        }
      });

      return { run: null, lines: previewLines, isPreview: true, liveInventory, liveInventoryTimestamps, liveInventoryComments };
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

  const markStorePacked = async (store: Store) => {
    if (!run) return;
    setFinishingPackingStore(store);
    try {
      // Auto-confirm: set packed_qty = 0 for any line in this store still null (not individually confirmed)
      const unconfirmedLines = lines.filter(
        l => l.location_name === store && l.packed_qty === null
      );
      if (unconfirmedLines.length > 0) {
        await Promise.all(
          unconfirmedLines.map(l =>
            supabase.from('delivery_run_lines')
              .update({ packed_qty: 0, is_packed: false })
              .eq('id', l.id)
          )
        );
      }
      const current = run.store_packing_finished_at ?? {};
      await supabase.from('delivery_runs').update({
        store_packing_finished_at: { ...current, [store]: new Date().toISOString() },
      }).eq('id', run.id);
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    } finally {
      setFinishingPackingStore(null);
    }
  };

  const [undoingPackingStore, setUndoingPackingStore] = useState<Store | null>(null);
  const unmarkStorePacked = async (store: Store) => {
    if (!run) return;
    setUndoingPackingStore(store);
    try {
      // Reset auto-zeroed lines back to null so packer can re-enter
      const autoConfirmedLines = lines.filter(
        l => l.location_name === store && l.packed_qty === 0
      );
      if (autoConfirmedLines.length > 0) {
        await Promise.all(
          autoConfirmedLines.map(l =>
            supabase.from('delivery_run_lines')
              .update({ packed_qty: null, is_packed: false })
              .eq('id', l.id)
          )
        );
      }
      const current = { ...(run.store_packing_finished_at ?? {}) };
      delete current[store];
      await supabase.from('delivery_runs').update({
        store_packing_finished_at: current,
      }).eq('id', run.id);
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    } finally {
      setUndoingPackingStore(null);
    }
  };

  const [deConfirmingAll, setDeConfirmingAll] = useState(false);
  const deConfirmAllPacking = async () => {
    if (!run) return;
    setDeConfirmingAll(true);
    try {
      await supabase.from('delivery_runs').update({
        store_packing_finished_at: {},
      }).eq('id', run.id);
      setPackingFinished(false);
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
    } finally {
      setDeConfirmingAll(false);
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
  const liveInventoryComments = runData?.liveInventoryComments ?? {};

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

  /* ─ Per-store packer note (manager-editable override of inventory comment) ─ */
  const [editingNoteStore, setEditingNoteStore] = useState<Store | null>(null);
  const [noteText, setNoteText] = useState('');

  const saveNote = useMutation({
    mutationFn: async ({ store, text }: { store: Store; text: string }) => {
      if (!run) return;
      const current = run.store_notes ?? {};
      const updated = text ? { ...current, [store]: text } : Object.fromEntries(Object.entries(current).filter(([k]) => k !== store));
      const { error } = await supabase.from('delivery_runs').update({ store_notes: updated }).eq('id', run.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery-run', targetDate] });
      setEditingNoteStore(null);
    },
  });

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

  /* ─ Per-store confirmation derived state ─ */
  const storeConfirmedAt = (store: Store): string | null => {
    const col = STORE_CONFIRM_COL[store];
    return (run && col) ? (run[col] as string | null) : null;
  };
  // ZK has no confirm column — only require the 3 restaurant stores to be confirmed
  const allStoresConfirmed = STORES.filter(s => s in STORE_CONFIRM_COL).every(s => !!storeConfirmedAt(s));
  const deliveryStarted = !!run?.delivery_started_at;
  const storePackingDone: Record<string, string> = run?.store_packing_finished_at ?? {};
  const deliveryStores = STORES.filter(s => s !== 'ZK') as Store[];
  const allStoresPacked = deliveryStores.every(s => !!storePackingDone[s]);

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

      type InvItemRow = { name: string; section: string; unit: string; sort_order: number; store_sort_orders: Record<string, number> | null; store_targets: Record<string, Record<string, number>> | null };
      const storeData: {
        store: Store;
        submission: InventorySubmission | null;
        invItems: InvItemRow[];
      }[] = [];

      for (const store of deliveryStores) {
        const { data: submissions } = await supabase
          .from('inventory_submissions').select('*').eq('location_name', store)
          .order('submitted_at', { ascending: false }).limit(1);

        const { data: invItemsRaw } = await supabase
          .from('inventory_items')
          .select('name, section, unit, sort_order, store_sort_orders, store_targets')
          .contains('stores', [store])
          .order('sort_order', { ascending: true });

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
        });
      }

      const { data: runRow, error: runErr } = await supabase
        .from('delivery_runs').upsert({ delivery_date: targetDate, status: 'draft' }, { onConflict: 'delivery_date' })
        .select().single();
      if (runErr) throw runErr;

      const runId = (runRow as DeliveryRun).id;
      await supabase.from('delivery_run_lines').delete().eq('run_id', runId);

      const allLines: Omit<DeliveryLine, 'id' | 'created_at'>[] = [];
      for (const { store, submission, invItems } of storeData) {
        for (const item of invItems) {
          const storeTarget = item.store_targets?.[store];
          const effectiveTarget = Math.max(0, storeTarget?.[dayKey] ?? 0);

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

      // Snapshot inventory comments from the submissions used to build this run.
      // Stored separately from manager overrides (store_notes) so that:
      //  - the comment is permanently linked to THIS delivery's inventory
      //  - a new submission without a comment won't wipe the stored one
      //  - managers can still override per-run via store_notes
      const inventoryComments: Record<string, string> = {};
      for (const { store, submission } of storeData) {
        const comment = (submission as any)?.comment;
        if (comment?.trim()) inventoryComments[store] = comment.trim();
      }

      await supabase.from('delivery_runs').update({
        status: allSubmitted ? 'ready' : 'draft',
        store_inventory_comments: inventoryComments,
      }).eq('id', runId);

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

            {/* Packer: Start Packing / timer / Finish — desktop only (mobile version shown below header) */}
            {viewMode === 'packer' && run && (
              <div className="hidden sm:flex items-center gap-3">
                {allStoresPacked || packingFinished ? (
                  <>
                    <span className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg text-sm font-semibold">
                      <CheckCircle2 size={15} /> Packing Finished
                    </span>
                    <button
                      onClick={deConfirmAllPacking}
                      disabled={deConfirmingAll}
                      className="text-sm font-semibold text-gray-400 underline underline-offset-2 hover:text-gray-600 transition-colors disabled:opacity-50"
                    >
                      {deConfirmingAll ? 'Undoing…' : 'De-Confirm'}
                    </button>
                  </>
                ) : !packingStarted ? (
                  <button onClick={startPacking} className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors shadow-sm">
                    <Play size={15} /> Start Packing
                  </button>
                ) : (
                  <>
                    <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
                      <Timer size={14} className="text-[#1B5E20]" />
                      <span className="font-mono font-bold text-gray-800 tabular-nums text-sm">{formatTimer(elapsedSeconds)}</span>
                    </div>
                    {allStoresPacked && (
                      <button onClick={finishPacking} className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors shadow-sm">
                        <Flag size={15} /> Finished Packing
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Manager: Generate */}
            {viewMode === 'manager' && (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-60 shadow-sm"
              >
                {generating ? <><RefreshCw size={15} className="animate-spin" /> Generating…</> : <><RefreshCw size={15} /> {run ? 'Regenerate' : 'Generate List'}</>}
              </button>
            )}
          </div>
        </div>

        {/* Packer action button — full-width bar on mobile only */}
        {viewMode === 'packer' && run && (
          <div className="sm:hidden mb-4">
            {allStoresPacked || packingFinished ? (
              <div className="flex items-center justify-between gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
                <span className="flex items-center gap-2 text-green-700 text-sm font-semibold">
                  <CheckCircle2 size={16} /> Packing Finished
                </span>
                <button
                  onClick={deConfirmAllPacking}
                  disabled={deConfirmingAll}
                  className="text-sm font-semibold text-gray-400 underline underline-offset-2 hover:text-gray-600 transition-colors disabled:opacity-50"
                >
                  {deConfirmingAll ? 'Undoing…' : 'De-Confirm'}
                </button>
              </div>
            ) : !packingStarted ? (
              <button onClick={startPacking} className="w-full flex items-center justify-center gap-2 bg-[#1B5E20] text-white px-4 py-3 rounded-xl text-sm font-semibold hover:bg-[#2E7D32] transition-colors shadow-sm">
                <Play size={15} /> Start Packing
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2.5 flex-1 justify-center">
                  <Timer size={14} className="text-[#1B5E20]" />
                  <span className="font-mono font-bold text-gray-800 tabular-nums text-sm">{formatTimer(elapsedSeconds)}</span>
                </div>
                {allStoresPacked && (
                  <button onClick={finishPacking} className="flex items-center gap-2 bg-[#1B5E20] text-white px-4 py-3 rounded-xl text-sm font-semibold hover:bg-[#2E7D32] transition-colors shadow-sm">
                    <Flag size={15} /> Finish
                  </button>
                )}
              </div>
            )}
          </div>
        )}

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
                        ? 'bg-[#1B5E20] border-[#1B5E20] text-white shadow-sm'
                        : 'border-gray-200 text-gray-600 bg-white hover:border-[#1B5E20] hover:text-[#1B5E20]'
                    }`}
                  >
                    <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide leading-tight">
                      {btn.label}
                    </span>
                    <span className={`text-[10px] leading-tight mt-0.5 ${isActive ? 'text-gray-200' : 'text-gray-400'}`}>{dayNum} {monAbbr}</span>
                  </button>
                );
              })}

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
        {(packingFinished || allStoresPacked) && viewMode === 'packer' && (
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
                {STORES.filter(s => viewMode !== 'packer' || s !== 'ZK').map(store => {
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
                      {/* Packer view: green tick when store marked done, else item counts */}
                      {isPacker && packingStarted && (
                        storePackingDone[store]
                          ? <CheckCircle2 size={14} className="text-green-500" />
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
              {STORES.filter(s => viewMode !== 'packer' || s !== 'ZK').map(store => {
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
                    {/* ── Store note (inventory comment / manager override) ── */}
                    {(() => {
                      const managerNote: string = run?.store_notes?.[store] ?? '';
                      // Prefer the comment that was snapshotted when the list was generated;
                      // fall back to the live latest-submission comment (covers preview / no-run state)
                      const inventoryComment: string =
                        run?.store_inventory_comments?.[store] ?? liveInventoryComments[store] ?? '';
                      const displayNote = managerNote || inventoryComment;
                      const isEditing = editingNoteStore === store;
                      const canEdit = viewMode === 'manager' && !!run && !isPreview;

                      if (isEditing) {
                        return (
                          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                              Note for Packer — {store}
                            </p>
                            {inventoryComment && (
                              <p className="text-xs text-amber-600 italic">
                                Inventory note: &ldquo;{inventoryComment}&rdquo;
                              </p>
                            )}
                            <textarea
                              value={noteText}
                              onChange={e => setNoteText(e.target.value)}
                              rows={3}
                              autoFocus
                              placeholder="Type a note for the packer…"
                              className="w-full text-sm border border-amber-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white placeholder-gray-300"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => saveNote.mutate({ store, text: noteText.trim() })}
                                disabled={saveNote.isPending}
                                className="flex items-center gap-1.5 bg-[#1B5E20] hover:bg-[#2E7D32] text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                              >
                                <Save size={12} />{saveNote.isPending ? 'Saving…' : 'Save note'}
                              </button>
                              <button
                                onClick={() => setEditingNoteStore(null)}
                                className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 border border-gray-200 rounded-lg"
                              >
                                Cancel
                              </button>
                              {managerNote && (
                                <button
                                  onClick={() => saveNote.mutate({ store, text: '' })}
                                  disabled={saveNote.isPending}
                                  className="ml-auto text-xs text-red-400 hover:text-red-600"
                                >
                                  Remove override
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      }

                      if (displayNote) {
                        return (
                          <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                            <MessageSquare size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">
                                {managerNote ? "Manager's note for packer" : 'Note from inventory report'}
                              </p>
                              <p className="text-sm text-amber-800 leading-relaxed whitespace-pre-wrap">{displayNote}</p>
                            </div>
                            {canEdit && (
                              <button
                                onClick={() => { setEditingNoteStore(store); setNoteText(managerNote || inventoryComment); }}
                                className="flex-shrink-0 text-xs text-amber-600 hover:text-amber-800 font-semibold underline whitespace-nowrap"
                              >
                                Edit
                              </button>
                            )}
                          </div>
                        );
                      }

                      // No note yet — let the manager add one
                      if (canEdit) {
                        return (
                          <button
                            onClick={() => { setEditingNoteStore(store); setNoteText(''); }}
                            className="mb-4 w-full flex items-center gap-2 px-4 py-2.5 border border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:border-amber-300 hover:text-amber-600 transition-colors"
                          >
                            <MessageSquare size={13} /> Add note for packer
                          </button>
                        );
                      }

                      return null;
                    })()}

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
                      packingFinished={isPacker && !!storePackingDone[store]}
                    />

                    {/* Per-store packing finish button (packer only, delivery stores only) */}
                    {viewMode === 'packer' && packingStarted && store !== 'ZK' && (
                      storePackingDone[store] ? (
                        <div className="mt-4 flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-green-200 bg-green-50 text-green-700 text-sm font-semibold">
                          <span className="flex items-center gap-2">
                            <CheckCircle2 size={16} /> {store} packed ✓
                          </span>
                          <button
                            onClick={() => unmarkStorePacked(store as Store)}
                            disabled={undoingPackingStore === store}
                            className="text-xs font-semibold text-green-600 underline underline-offset-2 hover:text-green-800 transition-colors disabled:opacity-50"
                          >
                            {undoingPackingStore === store ? 'Undoing…' : 'Undo'}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => markStorePacked(store)}
                          disabled={finishingPackingStore === store}
                          className="mt-4 w-full flex items-center justify-center gap-2 bg-[#1B5E20] text-white py-3 rounded-xl text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-60 shadow-sm"
                        >
                          <CheckCircle2 size={15} />
                          {finishingPackingStore === store ? 'Saving…' : `Finished ${store}`}
                        </button>
                      )
                    )}
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
