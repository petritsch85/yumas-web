'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

const LOCATIONS = ['Eschborn', 'Taunus', 'Westend', 'ZK'] as const;
type LocationName = (typeof LOCATIONS)[number];
type TabView = 'group' | LocationName;

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
function formatDate(iso: string) {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(iso: string): string {
  const diffMins = (Date.now() - new Date(iso).getTime()) / 60_000;
  const r = Math.round(diffMins / 30) * 30;
  if (r < 30)  return 'just now';
  if (r < 60)  return '30 min ago';
  const totalHours = r / 60;
  const days  = Math.floor(totalHours / 24);
  const hours = totalHours - days * 24;
  const hLabel = hours === 0 ? '' : hours === 0.5 ? ' 30 min' : ` ${hours}h`;
  if (days === 0) return `${hours}h ago`;
  if (days === 1) return `1 day${hLabel} ago`;
  return `${days} days${hLabel} ago`;
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localDateStrFromIso(iso: string): string {
  const d = new Date(iso);
  return toLocalDateStr(d);
}

/** Returns Mon–Sun of the week at the given offset (0 = current week) */
function getWeekDays(offset: number): Date[] {
  const now = new Date();
  const dow = now.getDay(); // 0 Sun … 6 Sat
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

function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

function fmtWeekRange(days: Date[]): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${days[0].toLocaleDateString('en-GB', opts)} – ${days[6].toLocaleDateString('en-GB', opts)}`;
}

/* ─── Tab bar ──────────────────────────────────────────────────────────────── */
function TabBar({ active, onChange }: { active: TabView; onChange: (v: TabView) => void }) {
  const tabs: { key: TabView; label: string }[] = [
    { key: 'group',   label: 'Group'   },
    { key: 'Westend', label: 'Westend' },
    { key: 'Eschborn',label: 'Eschborn'},
    { key: 'Taunus',  label: 'Taunus'  },
    { key: 'ZK',      label: 'ZK'      },
  ];
  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
            active === t.key
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ─── Group View (current view) ─────────────────────────────────────────────── */
type ItemRow = {
  section: string;
  name: string;
  unit: string;
  quantities: Partial<Record<LocationName, number>>;
  total: number;
};

type SectionGroup = { title: string; items: ItemRow[] };

function GroupView() {
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['inventory-overview'],
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data: submissions, error } = await supabase
        .from('inventory_submissions')
        .select('id, location_name, submitted_at, data')
        .order('submitted_at', { ascending: false });
      if (error) throw error;

      const latestByLocation: Partial<Record<LocationName, { submitted_at: string; data: { section: string; name: string; unit: string; quantity: number }[] }>> = {};
      for (const sub of submissions ?? []) {
        const loc = sub.location_name as LocationName;
        if (LOCATIONS.includes(loc) && !latestByLocation[loc]) {
          latestByLocation[loc] = { submitted_at: sub.submitted_at, data: sub.data ?? [] };
        }
      }

      const sectionMap: Record<string, Record<string, { unit: string; quantities: Partial<Record<LocationName, number>> }>> = {};
      for (const loc of LOCATIONS) {
        const sub = latestByLocation[loc];
        if (!sub) continue;
        for (const item of sub.data) {
          if (!sectionMap[item.section]) sectionMap[item.section] = {};
          if (!sectionMap[item.section][item.name]) {
            sectionMap[item.section][item.name] = { unit: item.unit, quantities: {} };
          }
          sectionMap[item.section][item.name].quantities[loc] = item.quantity;
        }
      }

      const sections: SectionGroup[] = Object.entries(sectionMap).map(([title, items]) => ({
        title,
        items: Object.entries(items).map(([name, { unit, quantities }]) => ({
          section: title, name, unit, quantities,
          total: Object.values(quantities).reduce((s, q) => s + (q ?? 0), 0),
        })),
      }));

      return { sections, latestByLocation };
    },
  });

  const sections = data?.sections ?? [];
  const latestByLocation = data?.latestByLocation ?? {};

  return (
    <>
      {/* As-of timestamps */}
      <div className="flex flex-wrap gap-3 mb-5">
        {LOCATIONS.map((loc) => {
          const sub = latestByLocation[loc];
          return (
            <div key={loc} className="bg-white border border-gray-100 rounded-lg px-3 py-2 text-xs shadow-sm">
              <div className="flex items-baseline gap-1.5">
                <span className="font-semibold text-gray-700">{loc}</span>
                {sub
                  ? <span className="text-gray-400">as of {formatDate(sub.submitted_at)}</span>
                  : <span className="text-red-400">no data</span>
                }
              </div>
              {sub && (
                <div className="text-gray-400 mt-0.5 font-medium" style={{ color: '#1B5E20', opacity: 0.7 }}>
                  {timeAgo(sub.submitted_at)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      ) : sections.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-100 p-10 text-center text-gray-400 text-sm">
          No inventory submissions found.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide min-w-[200px] z-10">Item</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide min-w-[60px]">Unit</th>
                  {LOCATIONS.map((loc) => (
                    <th key={loc} className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide min-w-[90px]">{loc}</th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-900 uppercase tracking-wide min-w-[80px] border-l border-gray-100">Total</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <>
                    <tr key={`s-${section.title}`} className="bg-[#F1F8E9] border-y border-green-100">
                      <td colSpan={2 + LOCATIONS.length + 1} className="sticky left-0 px-4 py-2 text-xs font-bold text-[#2E7D32] uppercase tracking-wider bg-[#F1F8E9]">
                        {section.title}
                      </td>
                    </tr>
                    {section.items.map((item, idx) => {
                      const isEven = idx % 2 === 0;
                      return (
                        <tr key={item.name} className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${isEven ? 'bg-white' : 'bg-gray-50/40'}`}>
                          <td className={`sticky left-0 px-4 py-2.5 font-medium text-gray-800 ${isEven ? 'bg-white' : 'bg-gray-50/40'} z-10`}>{item.name}</td>
                          <td className="px-3 py-2.5 text-gray-400 text-xs">{item.unit}</td>
                          {LOCATIONS.map((loc) => {
                            const qty = item.quantities[loc];
                            return (
                              <td key={loc} className="px-4 py-2.5 text-right tabular-nums">
                                {qty == null ? <span className="text-gray-200">—</span>
                                  : qty === 0 ? <span className="text-gray-300">0</span>
                                  : <span className="text-[#2E7D32] font-semibold">{qty}</span>}
                              </td>
                            );
                          })}
                          <td className="px-4 py-2.5 text-right tabular-nums font-bold text-gray-900 border-l border-gray-100">
                            {item.total === 0 ? <span className="text-gray-300">0</span> : item.total}
                          </td>
                        </tr>
                      );
                    })}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Store Weekly View ─────────────────────────────────────────────────────── */
type DayData = {
  start:     number | null; // Starting Inventory
  requested: number | null; // Requested Delivery (delivery_qty)
  actual:    number | null; // Actual Delivery (packed_qty ?? delivery_qty)
  ending:    number | null; // Ending Inventory
  usage:     number | null; // Calculated
  isPartial: boolean;       // packed_qty differs from delivery_qty
};

type WeekTableData = Record<string, Record<string, DayData>>; // itemName -> dateStr -> DayData
type WeekSectionGroup = { title: string; items: string[] };

const DAY_COLS = ['Start', 'Req', 'Act', 'Usage', 'End'] as const;

function StoreWeeklyView({ location, weekOffset, onOffsetChange }: {
  location: LocationName;
  weekOffset: number;
  onOffsetChange: (o: number) => void;
}) {
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);

  const weekStart = toLocalDateStr(weekDays[0]);
  const weekEnd   = toLocalDateStr(weekDays[6]);

  // Extended query range: day before Mon → Sun (for Mon's Starting Inventory)
  const queryRangeStart = useMemo(() => {
    const d = new Date(weekDays[0]);
    d.setDate(d.getDate() - 1);
    return toLocalDateStr(d);
  }, [weekDays]);

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-weekly', location, weekStart],
    staleTime: 60_000,
    queryFn: async () => {
      // 1. Inventory submissions for this location in extended range
      const { data: submissions } = await supabase
        .from('inventory_submissions')
        .select('submitted_at, data')
        .eq('location_name', location)
        .gte('submitted_at', `${queryRangeStart}T00:00:00`)
        .lte('submitted_at', `${weekEnd}T23:59:59`)
        .order('submitted_at', { ascending: true });

      // 2. Delivery runs in the week
      const { data: runs } = await supabase
        .from('delivery_runs')
        .select('id, delivery_date')
        .gte('delivery_date', weekStart)
        .lte('delivery_date', weekEnd);

      const runIds = (runs ?? []).map(r => r.id);
      const runDateMap: Record<string, string> = Object.fromEntries(
        (runs ?? []).map(r => [r.id, r.delivery_date])
      );

      // 3. Delivery lines for those runs, filtered by location
      let lines: { run_id: string; item_name: string; section: string; unit: string; delivery_qty: number; packed_qty: number | null }[] = [];
      if (runIds.length > 0) {
        const { data: linesData } = await supabase
          .from('delivery_run_lines')
          .select('run_id, item_name, section, unit, delivery_qty, packed_qty')
          .in('run_id', runIds)
          .eq('location_name', location)
          .gt('delivery_qty', 0);
        lines = (linesData ?? []) as typeof lines;
      }

      return { submissions: submissions ?? [], lines, runDateMap };
    },
  });

  /* ── Process into table data ── */
  const { tableData, sections, itemUnit } = useMemo<{ tableData: WeekTableData; sections: WeekSectionGroup[]; itemUnit: Record<string, string> }>(() => {
    if (!data) return { tableData: {}, sections: [] };
    const { submissions, lines, runDateMap } = data;

    // Group submissions by local date; sorted ascending so last = latest
    const subsByDate: Record<string, { items: Record<string, number>; meta: Record<string, { section: string; unit: string }> }[]> = {};
    for (const sub of submissions) {
      const dk = localDateStrFromIso(sub.submitted_at);
      if (!subsByDate[dk]) subsByDate[dk] = [];
      const items: Record<string, number> = {};
      const meta: Record<string, { section: string; unit: string }> = {};
      for (const item of (sub.data ?? []) as { section: string; name: string; unit: string; quantity: number }[]) {
        items[item.name] = item.quantity;
        meta[item.name]  = { section: item.section, unit: item.unit };
      }
      subsByDate[dk].push({ items, meta });
    }

    const getInventory = (dk: string): Record<string, number> | null => {
      const subs = subsByDate[dk];
      if (!subs?.length) return null;
      return subs[subs.length - 1].items;
    };

    // Delivery data by date and item
    const deliveryByDate: Record<string, Record<string, { requested: number; actual: number; isPartial: boolean }>> = {};
    for (const line of lines) {
      const dk = runDateMap[line.run_id];
      if (!dk) continue;
      if (!deliveryByDate[dk]) deliveryByDate[dk] = {};
      const actual = line.packed_qty ?? line.delivery_qty;
      deliveryByDate[dk][line.item_name] = {
        requested:  line.delivery_qty,
        actual,
        isPartial: line.packed_qty !== null && line.packed_qty < line.delivery_qty,
      };
    }

    // Master item list from all submissions in range
    const allItems = new Map<string, { section: string; unit: string }>();
    for (const subs of Object.values(subsByDate)) {
      for (const sub of subs) {
        for (const [name, m] of Object.entries(sub.meta)) {
          if (!allItems.has(name)) allItems.set(name, m);
        }
      }
    }
    for (const line of lines) {
      if (!allItems.has(line.item_name)) {
        allItems.set(line.item_name, { section: line.section ?? '', unit: line.unit ?? '' });
      }
    }

    // Build per-item per-day data
    const tableData: WeekTableData = {};
    for (const [itemName] of allItems) {
      tableData[itemName] = {};
      for (const day of weekDays) {
        const dk     = toLocalDateStr(day);
        const prevDk = toLocalDateStr(new Date(day.getTime() - 86_400_000));

        const start  = getInventory(prevDk)?.[itemName] ?? null;
        const ending = getInventory(dk)?.[itemName]    ?? null;
        const del    = deliveryByDate[dk]?.[itemName]  ?? null;

        const requested  = del?.requested  ?? null;
        const actual     = del?.actual     ?? null;
        const isPartial  = del?.isPartial  ?? false;

        // Usage = Start + Actual − End  (Actual = 0 on non-delivery days)
        let usage: number | null = null;
        if (start !== null && ending !== null) {
          usage = start + (actual ?? 0) - ending;
        }

        tableData[itemName][dk] = { start, requested, actual, ending, usage, isPartial };
      }
    }

    // Build section groups
    const sectionMap: Record<string, string[]> = {};
    for (const [name, { section }] of allItems) {
      if (!sectionMap[section]) sectionMap[section] = [];
      sectionMap[section].push(name);
    }
    const sections: WeekSectionGroup[] = Object.entries(sectionMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, items]) => ({ title, items: items.sort() }));

    // Unit lookup map (itemName → unit string)
    const itemUnit: Record<string, string> = {};
    for (const [name, { unit }] of allItems) itemUnit[name] = unit;

    return { tableData, sections, itemUnit };
  }, [data, weekDays]);

  const isEmpty = sections.length === 0 && !isLoading;

  /* ── Cell renderers ── */
  function InvCell({ v }: { v: number | null }) {
    if (v === null) return <span className="text-gray-200">—</span>;
    if (v === 0)    return <span className="text-gray-300">0</span>;
    return <span className="text-gray-800 font-semibold">{v}</span>;
  }

  function DelivCell({ v, isPartial }: { v: number | null; isPartial?: boolean }) {
    if (v === null) return <span className="text-gray-200">—</span>;
    if (v === 0)    return <span className="text-gray-300">0</span>;
    return (
      <span className={isPartial ? 'text-amber-600 font-semibold' : 'text-blue-600 font-semibold'}>
        {v}
      </span>
    );
  }

  function UsageCell({ v }: { v: number | null }) {
    if (v === null) return <span className="text-gray-200">—</span>;
    if (v === 0)    return <span className="text-gray-400">0</span>;
    if (v < 0)      return <span className="text-red-500 font-semibold">{v}</span>;
    return <span className="text-[#2E7D32] font-semibold">{v}</span>;
  }

  return (
    <>
      {/* Week navigation */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => onOffsetChange(weekOffset - 1)}
          className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-gray-500"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="text-sm font-semibold text-gray-700 min-w-[160px] text-center">
          {fmtWeekRange(weekDays)}
        </span>
        <button
          onClick={() => onOffsetChange(weekOffset + 1)}
          disabled={weekOffset >= 0}
          className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-gray-500 disabled:opacity-30"
        >
          <ChevronRight size={15} />
        </button>
        {weekOffset < 0 && (
          <button
            onClick={() => onOffsetChange(0)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-500 hover:bg-gray-50 transition-colors"
          >
            This week
          </button>
        )}

        {/* Legend */}
        <div className="ml-auto flex items-center gap-4 text-xs text-gray-400">
          <span><span className="text-gray-800 font-semibold">12</span> Start/End inventory</span>
          <span><span className="text-blue-600 font-semibold">5</span> Delivery</span>
          <span><span className="text-amber-600 font-semibold">3</span> Partial delivery</span>
          <span><span className="text-[#2E7D32] font-semibold">10</span> Usage</span>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="bg-white rounded-lg border border-gray-100 p-10 text-center text-gray-400 text-sm">
          No inventory data found for {location} in this week.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              {/* ── Column groups for visual separation ── */}
              <colgroup>
                <col style={{ minWidth: 200 }} />  {/* Item + unit subtitle */}
                {weekDays.map((_, di) => (
                  <>
                    <col key={`c-s-${di}`}  style={{ minWidth: 52 }} />
                    <col key={`c-rq-${di}`} style={{ minWidth: 52 }} />
                    <col key={`c-ac-${di}`} style={{ minWidth: 52 }} />
                    <col key={`c-us-${di}`} style={{ minWidth: 52 }} />
                    <col key={`c-e-${di}`}  style={{ minWidth: 52 }} />
                  </>
                ))}
              </colgroup>

              <thead>
                {/* Row 1: Day headers */}
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="sticky left-0 z-20 bg-gray-50 px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide" rowSpan={2}>
                    Item
                  </th>
                  {weekDays.map((day, di) => (
                    <th
                      key={di}
                      colSpan={5}
                      className={`px-2 py-2 text-center text-xs font-bold tracking-wide border-l-2 ${
                        toLocalDateStr(day) === toLocalDateStr(new Date())
                          ? 'text-[#1B5E20] border-[#1B5E20] bg-[#F1F8E9]'
                          : 'text-gray-600 border-gray-300'
                      }`}
                    >
                      {fmtDayLabel(day)}
                    </th>
                  ))}
                </tr>

                {/* Row 2: Sub-column headers */}
                <tr className="bg-gray-50 border-b border-gray-200">
                  {weekDays.map((day, di) => (
                    DAY_COLS.map((col, ci) => {
                      const isToday = toLocalDateStr(day) === toLocalDateStr(new Date());
                      const isFirst = ci === 0;
                      return (
                        <th
                          key={`${di}-${col}`}
                          className={`px-1 py-1.5 text-center font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap ${
                            isFirst ? 'border-l-2 border-gray-300' : ''
                          } ${isToday ? 'bg-[#F1F8E9]' : ''}`}
                        >
                          {col}
                        </th>
                      );
                    })
                  ))}
                </tr>
              </thead>

              <tbody>
                {sections.map((section) => (
                  <>
                    {/* Section header */}
                    <tr key={`s-${section.title}`} className="bg-[#F1F8E9] border-y border-green-100">
                      <td
                        colSpan={1 + weekDays.length * 5}
                        className="sticky left-0 px-4 py-1.5 text-xs font-bold text-[#2E7D32] uppercase tracking-wider bg-[#F1F8E9]"
                      >
                        {section.title}
                      </td>
                    </tr>

                    {/* Item rows */}
                    {section.items.map((itemName, idx) => {
                      const isEven = idx % 2 === 0;
                      const rowBg = isEven ? 'bg-white' : 'bg-gray-50/40';
                      const unit = itemUnit[itemName] ?? '';

                      return (
                        <tr key={itemName} className={`border-b border-gray-50 hover:bg-blue-50/20 transition-colors ${rowBg}`}>
                          <td className={`sticky left-0 px-4 py-2 z-10 ${rowBg}`}>
                            <span className="font-medium text-gray-800">{itemName}</span>
                            {unit && <span className="block text-gray-400 text-[10px] leading-tight mt-0.5">{unit}</span>}
                          </td>

                          {weekDays.map((day, di) => {
                            const dk = toLocalDateStr(day);
                            const d  = tableData[itemName]?.[dk];
                            const isToday = dk === toLocalDateStr(new Date());
                            const dayBg   = isToday ? 'bg-[#F1F8E9]/60' : '';

                            return (
                              <>
                                <td key={`${di}-s`}  className={`px-1 py-2 text-right tabular-nums border-l-2 border-gray-200 ${dayBg}`}>
                                  <InvCell v={d?.start ?? null} />
                                </td>
                                <td key={`${di}-rq`} className={`px-1 py-2 text-right tabular-nums ${dayBg}`}>
                                  <DelivCell v={d?.requested ?? null} />
                                </td>
                                <td key={`${di}-ac`} className={`px-1 py-2 text-right tabular-nums ${dayBg}`}>
                                  <DelivCell v={d?.actual ?? null} isPartial={d?.isPartial} />
                                </td>
                                <td key={`${di}-us`} className={`px-1 py-2 text-right tabular-nums ${dayBg}`}>
                                  <UsageCell v={d?.usage ?? null} />
                                </td>
                                <td key={`${di}-e`}  className={`px-1 py-2 text-right tabular-nums ${dayBg}`}>
                                  <InvCell v={d?.ending ?? null} />
                                </td>
                              </>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────────── */
export default function InventoryOverviewPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabView>('group');
  const [weekOffset, setWeekOffset] = useState(0);
  const [refreshedAt, setRefreshedAt] = useState<number>(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Compute weekStart here so main page can build the correct store query key
  const weekStart = useMemo(() => toLocalDateStr(getWeekDays(weekOffset)[0]), [weekOffset]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (activeTab === 'group') {
        await qc.refetchQueries({ queryKey: ['inventory-overview'] });
      } else {
        await qc.refetchQueries({ queryKey: ['inventory-weekly', activeTab, weekStart] });
      }
      setRefreshedAt(Date.now());
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Current Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeTab === 'group'
              ? 'Latest submitted quantities per location'
              : `Weekly inventory flow — ${activeTab}`}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <TabBar active={activeTab} onChange={(v) => { setActiveTab(v); }} />
          <span className="text-xs text-gray-400 whitespace-nowrap">
            Updated {new Date(refreshedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-[#1B5E20]' : ''} />
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {activeTab === 'group' ? (
        <GroupView />
      ) : (
        <StoreWeeklyView
          location={activeTab}
          weekOffset={weekOffset}
          onOffsetChange={setWeekOffset}
        />
      )}
    </div>
  );
}
