'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { RefreshCw, ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react';
import { useT } from '@/lib/i18n';

const LOCATIONS = ['Eschborn', 'Taunus', 'Westend'] as const;

/* ─── Fallback section order (used while DB loads) ──────────────────────────── */
const SECTION_ORDER_FALLBACK = ['Kühlhaus', 'Tiefkühler', 'Trockenware', 'Regale', 'Lager'];

/* ─── DB types ──────────────────────────────────────────────────────────────── */
type DbSection = { id: string; name: string; sort_order: number };
type DbItem    = { id: string; name: string; section: string; unit: string; sort_order: number; store_sort_orders: Record<string, number> | null };

/* ─── Sorting helpers (DB-driven order passed as params) ────────────────────── */
function sortSections<T extends { title: string; items: unknown[] }>(
  sections: T[],
  sectionOrder: string[],
): T[] {
  return sections.slice().sort((a, b) => {
    const ia = sectionOrder.indexOf(a.title);
    const ib = sectionOrder.indexOf(b.title);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

function sortItemNames(names: string[], itemRank: Record<string, number>): string[] {
  return names.slice().sort((a, b) => {
    const ia = itemRank[a] ?? 9999;
    const ib = itemRank[b] ?? 9999;
    return ia !== ib ? ia - ib : a.localeCompare(b);
  });
}

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

/**
 * Submissions before 04:00 are treated as end-of-the-previous-day.
 * e.g. 00:12 on May 22nd → assigned to May 21st (end-of-evening inventory).
 */
const EOD_CUTOFF_HOUR = 4;

function localDateStrFromIso(iso: string): string {
  const d = new Date(iso);
  if (d.getHours() < EOD_CUTOFF_HOUR) d.setDate(d.getDate() - 1);
  return toLocalDateStr(d);
}

/** Returns Mon–Sun of the week at the given offset (0 = current week) */
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
    { key: 'group',    label: 'Group'   },
    { key: 'Westend',  label: 'Westend' },
    { key: 'Eschborn', label: 'Eschborn'},
    { key: 'Taunus',   label: 'Taunus'  },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
            active === t.key
              ? 'bg-[#1B5E20] text-white border-[#1B5E20] shadow-sm'
              : 'bg-white text-gray-600 border-gray-300 hover:border-[#1B5E20] hover:text-[#1B5E20]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ─── Group View ─────────────────────────────────────────────────────────────── */
type ItemRow = {
  section: string;
  name: string;
  unit: string;
  quantities: Partial<Record<LocationName, number>>;
  total: number;
};
type SectionGroup = { title: string; items: ItemRow[] };

function GroupView() {
  /* ── DB: canonical sections + items ── */
  const { data: dbSections = [], isLoading: sectionsLoading } = useQuery<DbSection[]>({
    queryKey: ['inventory-sections'],
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory_sections')
        .select('id, name, sort_order')
        .order('sort_order', { ascending: true });
      return (data ?? []) as DbSection[];
    },
    staleTime: 60_000,
  });

  const { data: dbItems = [], isLoading: itemsLoading } = useQuery<DbItem[]>({
    queryKey: ['inventory-items-all'],
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory_items')
        .select('id, name, section, unit, sort_order, store_sort_orders')
        .order('sort_order', { ascending: true });
      return (data ?? []) as DbItem[];
    },
    staleTime: 60_000,
  });

  const sectionOrder = useMemo(
    () => dbSections.length > 0 ? dbSections.map(s => s.name) : SECTION_ORDER_FALLBACK,
    [dbSections],
  );

  /* ── Latest submissions per location ── */
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

      // Collect item metadata from ALL submissions (not just latest per store).
      // This ensures items that were counted historically but not in the most
      // recent submission still appear in the group view (legacy path).
      const allItemMeta: Record<string, { section: string; unit: string }> = {};
      for (const sub of submissions ?? []) {
        for (const item of (sub.data ?? []) as { section: string; name: string; unit: string; quantity: number }[]) {
          if (item.name && !allItemMeta[item.name]) {
            allItemMeta[item.name] = { section: item.section ?? 'Other', unit: item.unit ?? '' };
          }
        }
      }

      return { latestByLocation, allItemMeta };
    },
  });

  /* ── Build section groups: DB as canonical, quantities from submissions ── */
  const sections = useMemo<SectionGroup[]>(() => {
    const latestByLocation = data?.latestByLocation ?? {};
    // allItemMeta covers ALL items ever seen across all submissions
    const allItemMeta = data?.allItemMeta ?? {};

    // Quantity lookup: itemName -> location -> qty (from latest submission per store only)
    const quantityMap: Record<string, Partial<Record<LocationName, number>>> = {};

    for (const loc of LOCATIONS) {
      const sub = latestByLocation[loc];
      if (!sub) continue;
      for (const item of sub.data) {
        if (!quantityMap[item.name]) quantityMap[item.name] = {};
        quantityMap[item.name][loc] = item.quantity;
      }
    }

    const dbItemNames = new Set(dbItems.map(i => i.name));

    // ── Step 1: group ALL inventory_items by section (single source of truth) ──
    // Walk dbItems directly — no intermediate map that could silently drop rows.
    const sectionMap = new Map<string, ItemRow[]>();
    const seenNames  = new Set<string>();

    for (const item of dbItems) {
      if (seenNames.has(item.name)) continue; // deduplicate by name
      seenNames.add(item.name);
      const quantities = quantityMap[item.name] ?? {};
      const row: ItemRow = {
        section: item.section,
        name:    item.name,
        unit:    item.unit,
        quantities,
        total: Object.values(quantities).reduce((s, q) => s + (q ?? 0), 0),
      };
      if (!sectionMap.has(item.section)) sectionMap.set(item.section, []);
      sectionMap.get(item.section)!.push(row);
    }

    // ── Step 2: sort items within each section by sort_order ──
    for (const rows of sectionMap.values()) {
      rows.sort((a, b) => {
        const ia = dbItems.find(d => d.name === a.name)?.sort_order ?? 0;
        const ib = dbItems.find(d => d.name === b.name)?.sort_order ?? 0;
        return ia - ib;
      });
    }

    // ── Step 3: order sections — registered order first, then extras ──
    const result: SectionGroup[] = [];
    const addedSections = new Set<string>();

    for (const secName of sectionOrder) {
      const rows = sectionMap.get(secName);
      if (rows && rows.length > 0) {
        result.push({ title: secName, items: rows });
        addedSections.add(secName);
      }
    }
    for (const [secName, rows] of sectionMap) {
      if (addedSections.has(secName)) continue;
      if (rows.length > 0) result.push({ title: secName, items: rows });
    }

    // ── Step 4: append legacy items — any item ever counted in ANY submission
    //           that is NOT already in inventory_items (i.e. not in dbItemNames).
    //           We use allItemMeta which spans all submissions, not just the latest.
    //           Quantities come from the latest submission per store (may be —).
    const legacyBySec: Record<string, ItemRow[]> = {};
    for (const [itemName, meta] of Object.entries(allItemMeta)) {
      if (dbItemNames.has(itemName)) continue;   // already shown via DB path
      if (seenNames.has(itemName)) continue;      // already added somehow
      seenNames.add(itemName);
      const quantities = quantityMap[itemName] ?? {};
      const secName = meta.section || 'Other';
      if (!legacyBySec[secName]) legacyBySec[secName] = [];
      legacyBySec[secName].push({
        section: secName, name: itemName, unit: meta.unit ?? '',
        quantities,
        total: Object.values(quantities).reduce((s, q) => s + (q ?? 0), 0),
      });
    }
    for (const [secName, rows] of Object.entries(legacyBySec)) {
      const existing = result.find(s => s.title === secName);
      if (existing) existing.items.push(...rows);
      else result.push({ title: secName, items: rows });
    }

    return result;
  }, [data, dbItems, sectionOrder]);

  const latestByLocation = data?.latestByLocation ?? {};
  const anySubmissions = Object.keys(latestByLocation).length > 0;
  const allLoading = isLoading || itemsLoading || sectionsLoading;

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

      {allLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      ) : sections.length === 0 && !anySubmissions ? (
        <div className="bg-white rounded-lg border border-gray-100 p-10 text-center text-gray-400 text-sm">
          No inventory submissions found.
        </div>
      ) : sections.length === 0 && anySubmissions ? (
        <div className="bg-white rounded-lg border border-gray-100 p-10 text-center text-sm">
          <p className="text-gray-500 font-medium mb-1">Submissions found but items could not be loaded.</p>
          <p className="text-gray-400 text-xs">Try clicking Refresh. If this persists, the inventory items list may be empty in the database.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="sticky left-0 bg-gray-50 px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide min-w-[130px] sm:min-w-[200px] z-10">Item</th>
                  <th className="hidden sm:table-cell px-3 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide min-w-[60px]">Unit</th>
                  {LOCATIONS.map((loc) => (
                    <th key={loc} className="px-2 sm:px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide min-w-[48px] sm:min-w-[90px]">
                      <span className="hidden sm:inline">{loc}</span>
                      <span className="sm:hidden">{loc.slice(0, 3)}</span>
                    </th>
                  ))}
                  <th className="px-2 sm:px-4 py-3 text-right text-xs font-semibold text-gray-900 uppercase tracking-wide min-w-[48px] sm:min-w-[80px] border-l border-gray-100">Tot</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <>
                    <tr key={`s-${section.title}`} className="bg-[#F1F8E9] border-y border-green-100">
                      <td colSpan={1 + LOCATIONS.length + 1} className="sticky left-0 px-3 py-2 text-xs font-bold text-[#2E7D32] uppercase tracking-wider bg-[#F1F8E9]">
                        {section.title}
                      </td>
                    </tr>
                    {section.items.map((item, idx) => {
                      const isEven = idx % 2 === 0;
                      return (
                        <tr key={item.name} className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${isEven ? 'bg-white' : 'bg-gray-50/40'}`}>
                          <td className={`sticky left-0 px-3 py-2.5 font-medium text-gray-800 ${isEven ? 'bg-white' : 'bg-gray-50/40'} z-10`}>
                            {item.name}
                            {item.unit && <span className="sm:hidden block text-gray-400 text-[11px] leading-tight mt-0.5">{item.unit}</span>}
                          </td>
                          <td className="hidden sm:table-cell px-3 py-2.5 text-gray-400 text-xs">{item.unit}</td>
                          {LOCATIONS.map((loc) => {
                            const qty = item.quantities[loc];
                            return (
                              <td key={loc} className="px-2 sm:px-4 py-2.5 text-right tabular-nums text-xs sm:text-sm">
                                {qty == null ? <span className="text-gray-200">—</span>
                                  : qty === 0 ? <span className="text-gray-300">0</span>
                                  : <span className="text-[#2E7D32] font-semibold">{qty}</span>}
                              </td>
                            );
                          })}
                          <td className="px-2 sm:px-4 py-2.5 text-right tabular-nums text-xs sm:text-sm font-bold text-gray-900 border-l border-gray-100">
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

/* ─── Day Edit Modal ─────────────────────────────────────────────────────────── */
type DayEditTarget = { dateKey: string; location: LocationName };
type EditTab = 'items' | 'delete';

type DeliveryLineEdit = {
  id: string;
  item_name: string;
  section: string;
  unit: string;
  delivery_qty: number;
  packed_qty: number | null;
};

function DayEditModal({
  target, onClose, onDeleted, itemRank,
}: {
  target: DayEditTarget;
  onClose: () => void;
  onDeleted: () => void;
  itemRank: Record<string, number>;
}) {
  const [tab, setTab] = useState<EditTab>('items');
  const [deleting, setDeleting] = useState<'delivery' | 'inventory' | 'both' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [edits, setEdits] = useState<Record<string, { req: string; act: string; assumed: boolean }>>({});
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);

  const { data: deliveryLines = [], isLoading: loadingLines } = useQuery({
    queryKey: ['day-edit-lines', target.dateKey, target.location],
    queryFn: async () => {
      const { data: runs } = await supabase
        .from('delivery_runs')
        .select('id')
        .eq('delivery_date', target.dateKey);
      const runIds = (runs ?? []).map((r: { id: string }) => r.id);
      if (runIds.length === 0) return [];
      const { data: lines } = await supabase
        .from('delivery_run_lines')
        .select('id, item_name, section, unit, delivery_qty, packed_qty')
        .in('run_id', runIds)
        .eq('location_name', target.location);
      return ((lines ?? []) as DeliveryLineEdit[]).sort((a, b) => {
        const ia = itemRank[a.item_name] ?? 9999;
        const ib = itemRank[b.item_name] ?? 9999;
        return ia !== ib ? ia - ib : a.item_name.localeCompare(b.item_name);
      });
    },
    enabled: tab === 'items',
  });

  const initEdits = () => {
    const init: Record<string, { req: string; act: string; assumed: boolean }> = {};
    for (const l of deliveryLines) {
      if (!edits[l.id]) {
        const assumed = l.packed_qty === null;
        init[l.id] = {
          req:     String(l.delivery_qty),
          act:     String(l.packed_qty ?? l.delivery_qty),
          assumed,
        };
      }
    }
    if (Object.keys(init).length > 0) setEdits(prev => ({ ...init, ...prev }));
  };

  useMemo(initEdits, [deliveryLines]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      for (const line of deliveryLines) {
        const e = edits[line.id];
        if (!e) continue;
        const newReq = Math.max(0, parseInt(e.req) || 0);
        const newAct = e.assumed ? null : (e.act.trim() === '' ? null : Math.max(0, parseInt(e.act) || 0));
        if (newReq === line.delivery_qty && newAct === line.packed_qty) continue;
        const { error: err } = await supabase
          .from('delivery_run_lines')
          .update({ delivery_qty: newReq, packed_qty: newAct })
          .eq('id', line.id);
        if (err) throw new Error(err.message);
      }
      setSaveOk(true);
      onDeleted();
      setTimeout(() => setSaveOk(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (what: 'delivery' | 'inventory' | 'both') => {
    setDeleting(what);
    setError(null);
    try {
      if (what === 'delivery' || what === 'both') {
        const { data: runs } = await supabase
          .from('delivery_runs').select('id').eq('delivery_date', target.dateKey);
        const runIds = (runs ?? []).map((r: { id: string }) => r.id);
        if (runIds.length > 0) {
          const { error: err } = await supabase
            .from('delivery_run_lines').delete()
            .in('run_id', runIds).eq('location_name', target.location);
          if (err) throw new Error(err.message);
        }
      }
      if (what === 'inventory' || what === 'both') {
        const { error: err } = await supabase
          .from('inventory_submissions').delete()
          .eq('location_name', target.location)
          .gte('submitted_at', `${target.dateKey}T00:00:00`)
          .lte('submitted_at', `${target.dateKey}T23:59:59`);
        if (err) throw new Error(err.message);
      }
      onDeleted();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  const d = new Date(target.dateKey + 'T12:00:00Z');
  const label = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-xl flex flex-col"
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-900 text-base">Edit Day Data</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              <span className="font-semibold text-gray-700">{target.location}</span> · {label}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors mt-0.5">
            <X size={17} />
          </button>
        </div>

        <div className="flex border-b border-gray-100 px-5">
          {([['items', 'Edit Items'], ['delete', 'Delete']] as [EditTab, string][]).map(([key, lbl]) => (
            <button
              key={key}
              onClick={() => { setTab(key as EditTab); setError(null); }}
              className={`py-2.5 px-1 mr-5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key ? 'border-[#1B5E20] text-[#1B5E20]' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {error && (
          <div className="mx-5 mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {tab === 'items' && (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {loadingLines ? (
                <div className="py-8 text-center text-xs text-gray-400">Loading delivery data…</div>
              ) : deliveryLines.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400">No delivery data found for this day.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="text-left py-2 font-medium">Item</th>
                      <th className="text-left py-2 font-medium text-gray-300">Unit</th>
                      <th className="text-center py-2 font-medium w-20">REQ</th>
                      <th className="text-center py-2 font-medium w-20">ACT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {deliveryLines.map(line => {
                      const e = edits[line.id] ?? { req: String(line.delivery_qty), act: String(line.packed_qty ?? line.delivery_qty), assumed: line.packed_qty === null };
                      return (
                        <tr key={line.id} className="hover:bg-gray-50/50">
                          <td className="py-2 font-medium text-gray-800 pr-2">{line.item_name}</td>
                          <td className="py-2 text-xs text-gray-400 pr-3 whitespace-nowrap">{line.unit}</td>
                          <td className="py-2 text-center">
                            <input
                              type="number" min="0"
                              value={e.req}
                              onChange={ev => setEdits(prev => ({ ...prev, [line.id]: { ...e, req: ev.target.value } }))}
                              className="w-16 text-center border border-gray-200 rounded-md px-1.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/40 bg-white tabular-nums"
                            />
                          </td>
                          <td className="py-2 text-center">
                            <input
                              type="number" min="0"
                              value={e.act}
                              onChange={ev => setEdits(prev => ({
                                ...prev,
                                [line.id]: { ...e, act: ev.target.value, assumed: false },
                              }))}
                              title={e.assumed ? 'Assumed = REQ (not confirmed). Edit to set actual.' : 'Confirmed actual delivery'}
                              className={`w-16 text-center border rounded-md px-1.5 py-1 text-sm focus:outline-none focus:ring-2 bg-white tabular-nums ${
                                e.assumed
                                  ? 'border-dashed border-gray-300 text-gray-400 italic focus:ring-gray-300'
                                  : 'border-gray-200 text-gray-800 focus:ring-blue-400/40'
                              }`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {deliveryLines.length > 0 && (
              <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3">
                <p className="text-xs text-gray-400">REQ = requested · ACT: <span className="italic border-b border-dashed border-gray-400">grey dashed</span> = assumed (= REQ), solid = confirmed</p>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-[#1B5E20] text-white text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? 'Saving…' : saveOk ? '✓ Saved' : 'Save changes'}
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'delete' && (
          <div className="px-5 py-4 space-y-2">
            <p className="text-xs text-gray-400 mb-3">Permanently remove data for this location and date.</p>
            <button
              disabled={!!deleting}
              onClick={() => handleDelete('delivery')}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition-colors disabled:opacity-50 text-left"
            >
              <Trash2 size={14} />
              {deleting === 'delivery' ? 'Deleting…' : 'Delete delivery data (REQ / ACT)'}
            </button>
            <button
              disabled={!!deleting}
              onClick={() => handleDelete('inventory')}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition-colors disabled:opacity-50 text-left"
            >
              <Trash2 size={14} />
              {deleting === 'inventory' ? 'Deleting…' : 'Delete inventory count (START / END)'}
            </button>
            <button
              disabled={!!deleting}
              onClick={() => handleDelete('both')}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 font-semibold hover:bg-red-100 transition-colors disabled:opacity-50 text-left"
            >
              <Trash2 size={14} />
              {deleting === 'both' ? 'Deleting…' : 'Delete ALL data for this day'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Store Weekly View ─────────────────────────────────────────────────────── */
type DayData = {
  start:       number | null;
  usageLunch:  number | null;
  delivery:    number | null;
  usageDinner: number | null;
  ending:      number | null;
};

type WeekTableData    = Record<string, Record<string, DayData>>;
type WeekSectionGroup = { title: string; items: string[] };

const DAY_COLS = ['Start', 'Lunch', 'Delivery', 'Dinner', 'End'] as const;
const NO_DELIVERY_DAYS = new Set(['saturday', 'sunday']);

function StoreWeeklyView({ location, weekOffset, onOffsetChange }: {
  location: LocationName;
  weekOffset: number;
  onOffsetChange: (o: number) => void;
}) {
  const qc = useQueryClient();
  const [editDay, setEditDay] = useState<DayEditTarget | null>(null);

  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);
  const weekStart = toLocalDateStr(weekDays[0]);
  const weekEnd   = toLocalDateStr(weekDays[6]);

  /* ── DB: canonical sections + items for this location ── */
  const { data: dbSections = [] } = useQuery<DbSection[]>({
    queryKey: ['inventory-sections', location],
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory_sections')
        .select('id, name, sort_order')
        .contains('stores', [location])
        .order('sort_order', { ascending: true });
      return (data ?? []) as DbSection[];
    },
    staleTime: 60_000,
  });

  const { data: dbItems = [] } = useQuery<DbItem[]>({
    queryKey: ['inventory-items', location],
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory_items')
        .select('id, name, section, unit, sort_order, store_sort_orders')
        .contains('stores', [location])
        .order('sort_order', { ascending: true });
      return (data ?? []) as DbItem[];
    },
    staleTime: 60_000,
  });

  const sectionOrder = useMemo(
    () => dbSections.length > 0 ? dbSections.map(s => s.name) : SECTION_ORDER_FALLBACK,
    [dbSections],
  );

  /* Item rank: prefer store-specific sort order, fall back to global sort_order */
  const itemRank = useMemo<Record<string, number>>(() => {
    const rank: Record<string, number> = {};
    for (const item of dbItems) {
      rank[item.name] = (item.store_sort_orders as Record<string, number> | null)?.[location] ?? item.sort_order ?? 9999;
    }
    return rank;
  }, [dbItems, location]);

  /* ── Shift usage ── */
  const { data: shiftUsageRows = [] } = useQuery({
    queryKey: ['shift-usage-overview', location, weekStart, weekEnd],
    enabled: !!weekStart,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('shift_usage')
        .select('usage_date, item_name, quantity, shift')
        .eq('location_name', location)
        .gte('usage_date', weekStart)
        .lte('usage_date', weekEnd);
      return (data ?? []) as { usage_date: string; item_name: string; quantity: number; shift: string }[];
    },
  });

  const shiftUsageLunch = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const r of shiftUsageRows.filter(r => r.shift === 'lunch')) {
      if (!m[r.item_name]) m[r.item_name] = {};
      m[r.item_name][r.usage_date] = (m[r.item_name][r.usage_date] ?? 0) + (r.quantity ?? 0);
    }
    return m;
  }, [shiftUsageRows]);

  const shiftUsageDinner = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const r of shiftUsageRows.filter(r => r.shift === 'dinner')) {
      if (!m[r.item_name]) m[r.item_name] = {};
      m[r.item_name][r.usage_date] = (m[r.item_name][r.usage_date] ?? 0) + (r.quantity ?? 0);
    }
    return m;
  }, [shiftUsageRows]);

  const queryRangeStart = useMemo(() => {
    const d = new Date(weekDays[0]);
    d.setDate(d.getDate() - 1);
    return toLocalDateStr(d);
  }, [weekDays]);

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-weekly', location, weekStart, weekEnd],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: submissions } = await supabase
        .from('inventory_submissions')
        .select('submitted_at, data')
        .eq('location_name', location)
        .gte('submitted_at', `${queryRangeStart}T00:00:00`)
        .lte('submitted_at', `${(() => { const d = new Date(weekEnd + 'T12:00:00'); d.setDate(d.getDate() + 1); return toLocalDateStr(d); })()}T03:59:59`)
        .order('submitted_at', { ascending: true });

      const { data: runs } = await supabase
        .from('delivery_runs')
        .select('id, delivery_date')
        .gte('delivery_date', weekStart)
        .lte('delivery_date', weekEnd);

      const runIds = (runs ?? []).map(r => r.id);
      const runDateMap: Record<string, string> = Object.fromEntries(
        (runs ?? []).map(r => [r.id, r.delivery_date])
      );

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
  const { tableData, sections, itemUnit } = useMemo<{
    tableData: WeekTableData;
    sections: WeekSectionGroup[];
    itemUnit: Record<string, string>;
  }>(() => {
    if (!data) return { tableData: {}, sections: [], itemUnit: {} };
    const { submissions, lines, runDateMap } = data;

    const subsByDate: Record<string, { items: Record<string, number>; meta: Record<string, { section: string; unit: string }> }[]> = {};
    for (const sub of submissions) {
      const dk = localDateStrFromIso(sub.submitted_at);
      if (!subsByDate[dk]) subsByDate[dk] = [];
      const items: Record<string, number> = {};
      const meta:  Record<string, { section: string; unit: string }> = {};
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

    const deliveryByDate: Record<string, Record<string, { packedQty: number | null }>> = {};
    for (const line of lines) {
      const dk = runDateMap[line.run_id];
      if (!dk) continue;
      if (!deliveryByDate[dk]) deliveryByDate[dk] = {};
      deliveryByDate[dk][line.item_name] = { packedQty: line.packed_qty };
    }

    // Master item list: from submissions + delivery lines
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

    const todayStr = toLocalDateStr(new Date());

    const tableData: WeekTableData = {};
    for (const [itemName] of allItems) {
      tableData[itemName] = {};
      for (const day of weekDays) {
        const dk      = toLocalDateStr(day);
        const prevDk  = toLocalDateStr(new Date(day.getTime() - 86_400_000));
        const dayName = day.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const isNoDelivery = NO_DELIVERY_DAYS.has(dayName);

        const start   = getInventory(prevDk)?.[itemName] ?? null;
        const ending  = getInventory(dk)?.[itemName]    ?? null;
        const del     = isNoDelivery ? null : (deliveryByDate[dk]?.[itemName] ?? null);
        const delivery = del?.packedQty ?? null;
        const usageLunch  = shiftUsageLunch[itemName]?.[dk]  ?? null;
        const usageDinner = shiftUsageDinner[itemName]?.[dk] ?? null;

        tableData[itemName][dk] = { start, usageLunch, delivery, usageDinner, ending };
      }

      for (let i = 1; i < weekDays.length; i++) {
        const day    = weekDays[i];
        const dk     = toLocalDateStr(day);
        const prevDk = toLocalDateStr(weekDays[i - 1]);
        const isFutureOrToday = dk >= todayStr;
        if (!isFutureOrToday) continue;

        const d    = tableData[itemName][dk];
        const prev = tableData[itemName][prevDk];
        if (!d || !prev) continue;

        const dayName      = day.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const isNoDelivery = NO_DELIVERY_DAYS.has(dayName);

        const effectiveStart = d.start !== null ? d.start : (prev.ending ?? null);
        const deliveryVal    = isNoDelivery ? null : d.delivery;
        const lunchVal       = shiftUsageLunch[itemName]?.[dk]  ?? d.usageLunch;
        const dinnerVal      = shiftUsageDinner[itemName]?.[dk] ?? d.usageDinner;

        const computedEnding = effectiveStart !== null
          ? effectiveStart - (lunchVal ?? 0) + (deliveryVal ?? 0) - (dinnerVal ?? 0)
          : null;

        tableData[itemName][dk] = {
          start:       effectiveStart,
          usageLunch:  lunchVal,
          delivery:    deliveryVal,
          usageDinner: dinnerVal,
          ending:      d.ending ?? computedEnding,
        };
      }
    }

    // Build section groups using DB order
    const sectionMap: Record<string, string[]> = {};
    for (const [name, { section }] of allItems) {
      if (!sectionMap[section]) sectionMap[section] = [];
      sectionMap[section].push(name);
    }
    const sections: WeekSectionGroup[] = sortSections(
      Object.entries(sectionMap).map(([title, items]) => ({
        title,
        items: sortItemNames(items, itemRank),
      })),
      sectionOrder,
    );

    const itemUnit: Record<string, string> = {};
    for (const [name, { unit }] of allItems) itemUnit[name] = unit;

    return { tableData, sections, itemUnit };
  }, [data, weekDays, location, shiftUsageLunch, shiftUsageDinner, sectionOrder, itemRank]);

  const isEmpty   = sections.length === 0 && !isLoading;
  const todayStr  = toLocalDateStr(new Date());

  function InvCell({ v }: { v: number | null }) {
    if (v === null) return <span className="text-gray-200">—</span>;
    if (v === 0)    return <span className="text-gray-300">0</span>;
    return <span className="text-gray-800 font-semibold">{v}</span>;
  }

  function DelivCell({ v }: { v: number | null }) {
    if (v === null) return <span className="text-gray-200">—</span>;
    if (v === 0)    return <span className="text-gray-300">0</span>;
    return <span className="text-blue-600 font-semibold">{v}</span>;
  }

  function UsageCell({ v }: { v: number | null }) {
    if (v === null) return <span className="text-gray-200">—</span>;
    if (v === 0)    return <span className="text-gray-400">0</span>;
    if (v < 0)      return <span className="text-orange-500 font-semibold">{v}</span>;
    return <span className="text-blue-600 font-semibold">{v}</span>;
  }

  function ForecastCell({ v, dim }: { v: number | null; dim?: boolean }) {
    if (v === null) return <span className="text-gray-200">—</span>;
    if (v === 0)    return <span className="text-gray-300 italic">0</span>;
    return <span className={`italic ${dim ? 'text-red-300' : 'text-red-500 font-semibold'}`}>{v}</span>;
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => onOffsetChange(weekOffset - 1)}
          className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-gray-500"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="text-sm font-semibold text-gray-700 min-w-[190px] text-center">
          {fmtWeekRange(weekDays)}
        </span>
        <button
          onClick={() => onOffsetChange(weekOffset + 1)}
          className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-gray-500"
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
        <div className="ml-auto flex items-center gap-4 text-xs text-gray-400">
          <span><span className="text-gray-800 font-semibold">12</span> Start/End</span>
          <span><span className="text-blue-600 font-semibold">5</span> Confirmed delivery</span>
          <span><span className="text-blue-600 font-semibold">10</span> Usage (actual)</span>
          <span><span className="text-red-500 font-semibold italic">8</span> Forecast</span>
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
              <colgroup>
                <col style={{ minWidth: 130 }} />
                {weekDays.map((_, di) => (
                  <>
                    <col key={`c-s-${di}`}  style={{ minWidth: 30 }} />
                    <col key={`c-lu-${di}`} style={{ minWidth: 30 }} />
                    <col key={`c-dl-${di}`} style={{ minWidth: 30 }} />
                    <col key={`c-di-${di}`} style={{ minWidth: 30 }} />
                    <col key={`c-e-${di}`}  style={{ minWidth: 30 }} />
                  </>
                ))}
              </colgroup>

              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="sticky left-0 z-20 bg-gray-50 px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide" rowSpan={2}>
                    Item
                  </th>
                  {weekDays.map((day, di) => {
                    const dk      = toLocalDateStr(day);
                    const isToday = dk === todayStr;
                    return (
                      <th
                        key={di}
                        colSpan={5}
                        onClick={() => setEditDay({ dateKey: dk, location })}
                        className={`px-2 py-2 text-center text-xs font-bold tracking-wide border-l-2 cursor-pointer select-none group/dayhead ${
                          isToday
                            ? 'text-[#1B5E20] border-[#1B5E20] bg-[#F1F8E9] hover:bg-green-100'
                            : 'text-gray-600 border-gray-300 hover:bg-gray-100'
                        }`}
                        title="Click to edit / delete data for this day"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {fmtDayLabel(day)}
                          {isToday && (
                            <span className="px-1.5 py-0.5 rounded-full bg-[#1B5E20] text-white text-[10px] font-bold leading-none">
                              Today
                            </span>
                          )}
                          <span className="opacity-40 group-hover/dayhead:opacity-80 transition-opacity text-gray-400">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </span>
                        </span>
                      </th>
                    );
                  })}
                </tr>

                <tr className="bg-gray-50 border-b border-gray-200">
                  {weekDays.map((day, di) => {
                    const dk      = toLocalDateStr(day);
                    const isToday = dk === todayStr;
                    return DAY_COLS.map((col, ci) => (
                      <th
                        key={`${di}-${col}`}
                        className={`px-1 py-1.5 text-center font-medium uppercase tracking-wide whitespace-nowrap ${
                          ci === 0 ? 'border-l-2 border-gray-300' : ''
                        } ${isToday ? 'bg-[#F1F8E9] text-gray-400' : 'text-gray-400'}`}
                      >
                        {col}
                      </th>
                    ));
                  })}
                </tr>
              </thead>

              <tbody>
                {sections.map((section) => (
                  <>
                    <tr key={`s-${section.title}`} className="bg-[#F1F8E9] border-y border-green-100">
                      <td className="sticky left-0 px-4 py-1.5 text-xs font-bold text-[#2E7D32] uppercase tracking-wider bg-[#F1F8E9]">
                        {section.title}
                      </td>
                      {weekDays.map((_, di) =>
                        DAY_COLS.map((col, ci) => (
                          <td
                            key={`sh-${di}-${col}`}
                            className={ci === 0 ? 'border-l-2 border-gray-300 bg-[#F1F8E9]' : 'bg-[#F1F8E9]'}
                          />
                        ))
                      )}
                    </tr>

                    {section.items.map((itemName, idx) => {
                      const isEven = idx % 2 === 0;
                      const rowBg  = isEven ? 'bg-white' : 'bg-gray-50/40';
                      const unit   = itemUnit[itemName] ?? '';

                      return (
                        <tr key={itemName} className={`border-b border-gray-50 hover:bg-blue-50/20 transition-colors ${rowBg}`}>
                          <td className={`sticky left-0 px-4 py-2 z-10 ${isEven ? 'bg-white' : 'bg-gray-50'}`}>
                            <span className="font-medium text-gray-800">{itemName}</span>
                            {unit && <span className="block text-gray-400 text-[10px] leading-tight mt-0.5">{unit}</span>}
                          </td>

                          {weekDays.map((day, di) => {
                            const dk         = toLocalDateStr(day);
                            const d          = tableData[itemName]?.[dk];
                            const isToday    = dk === todayStr;
                            const isForecast = dk >= todayStr;
                            const dayBg      = isToday ? 'bg-[#F1F8E9]/60' : '';
                            const borderL    = 'border-l-2 border-gray-300';

                            return (
                              <>
                                <td key={`${di}-s`}  className={`px-1 py-2 text-center tabular-nums ${borderL} ${dayBg}`}>
                                  <InvCell v={d?.start ?? null} />
                                </td>
                                <td key={`${di}-lu`} className={`px-1 py-2 text-center tabular-nums ${dayBg}`}>
                                  {isForecast ? <ForecastCell v={d?.usageLunch ?? null} /> : <UsageCell v={d?.usageLunch ?? null} />}
                                </td>
                                <td key={`${di}-dl`} className={`px-1 py-2 text-center tabular-nums ${dayBg}`}>
                                  <DelivCell v={d?.delivery ?? null} />
                                </td>
                                <td key={`${di}-di`} className={`px-1 py-2 text-center tabular-nums ${dayBg}`}>
                                  {isForecast ? <ForecastCell v={d?.usageDinner ?? null} /> : <UsageCell v={d?.usageDinner ?? null} />}
                                </td>
                                <td key={`${di}-e`}  className={`px-1 py-2 text-center tabular-nums ${dayBg}`}>
                                  {isForecast && d?.ending !== null
                                    ? <ForecastCell v={d?.ending ?? null} dim />
                                    : <InvCell v={d?.ending ?? null} />}
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

      {editDay && (
        <DayEditModal
          target={editDay}
          onClose={() => setEditDay(null)}
          itemRank={itemRank}
          onDeleted={() => {
            qc.invalidateQueries({ queryKey: ['inventory-weekly', location, weekStart, weekEnd] });
          }}
        />
      )}
    </>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────────── */
export default function InventoryOverviewPage() {
  const qc = useQueryClient();
  const { t } = useT();
  const [refreshedAt,  setRefreshedAt]  = useState<number>(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await qc.refetchQueries({ queryKey: ['inventory-overview'] });
      setRefreshedAt(Date.now());
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('inventory.overview.title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Latest submitted quantities per location</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
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

      <GroupView />
    </div>
  );
}
