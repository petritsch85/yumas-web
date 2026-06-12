'use client';

import { use, useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ChevronDown, LayoutGrid, TrendingUp, X } from 'lucide-react';
import Link from 'next/link';

const STORES = ['Eschborn', 'Taunus', 'Westend'] as const;

// ── Types ──────────────────────────────────────────────────────────────────────

type Cycle = {
  deliveryDate:  string;
  preInvDate:    string | null;
  postInvDate:   string | null;
  preInv:        Record<string, number>;
  delivery:      Record<string, number>;
  postInv:       Record<string, number> | null;
  consumption:   Record<string, number> | null;
};

type MovementsData = {
  store:  string;
  items:  { name: string; section: string; unit: string }[];
  cycles: Cycle[];
};

type Override = {
  id:             string;
  store:          string;
  delivery_date:  string;
  item_name:      string;
  overridden_qty: number;
  original_qty:   number | null;
  comment:        string | null;
  created_at:     string;
};

type OverridesMap = Record<string, Record<string, Override>>;

// ── Date helpers ──────────────────────────────────────────────────────────────

const EOD_CUTOFF = 4;

function submissionDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (d.getHours() < EOD_CUTOFF) d.setDate(d.getDate() - 1);
  return d;
}

function fmtInvDateLabel(iso: string | null): string | null {
  const d = submissionDate(iso);
  if (!d) return null;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtDateLabel(isoDate: string): string | null {
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function fmtWeekLabel(weekStart: string): string {
  const start = new Date(weekStart + 'T12:00:00');
  const end   = new Date(weekStart + 'T12:00:00');
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `Week of ${fmt(start)} – ${fmt(end)}`;
}

// ── Column definitions ─────────────────────────────────────────────────────────

type ColType = 'inv' | 'del' | 'cons';

type Col = {
  type:         ColType;
  typeLabel:    string;
  dateLabel:    string | null;
  deliveryDate: string | null; // DEL cols only
  cycleIdx:     number;
  getValue:     (item: string) => number | null;
};

const TYPE_LABELS: Record<ColType, string> = {
  inv:  'INV',
  del:  'DEL',
  cons: 'CONS',
};

function buildColumns(cycles: Cycle[]): Col[] {
  const cols: Col[] = [];
  if (!cycles.length) return cols;

  cols.push({
    type:         'inv',
    typeLabel:    TYPE_LABELS.inv,
    dateLabel:    fmtInvDateLabel(cycles[0].preInvDate),
    deliveryDate: null,
    cycleIdx:     0,
    getValue:     (item) => cycles[0].preInv[item] ?? null,
  });

  for (let i = 0; i < cycles.length; i++) {
    const c = cycles[i];

    cols.push({
      type:         'del',
      typeLabel:    TYPE_LABELS.del,
      dateLabel:    fmtDateLabel(c.deliveryDate),
      deliveryDate: c.deliveryDate,
      cycleIdx:     i,
      getValue:     (item) => {
        const v = c.delivery[item];
        return v !== undefined ? v : 0;
      },
    });

    cols.push({
      type:         'cons',
      typeLabel:    TYPE_LABELS.cons,
      dateLabel:    null,
      deliveryDate: null,
      cycleIdx:     i,
      getValue:     (item) => c.consumption?.[item] ?? null,
    });

    const postDateLabel = c.postInvDate
      ? fmtInvDateLabel(c.postInvDate)
      : i + 1 < cycles.length
      ? fmtInvDateLabel(cycles[i + 1].preInvDate)
      : null;

    cols.push({
      type:         'inv',
      typeLabel:    TYPE_LABELS.inv,
      dateLabel:    postDateLabel,
      deliveryDate: null,
      cycleIdx:     i,
      getValue:     (item) => {
        if (c.postInv) return c.postInv[item] ?? null;
        if (i + 1 < cycles.length) return cycles[i + 1].preInv[item] ?? null;
        return null;
      },
    });
  }

  return cols;
}

// ── Colour helpers ─────────────────────────────────────────────────────────────

const COL_STYLES = {
  inv:  'bg-blue-50/60',
  del:  'bg-green-50/60',
  cons: 'bg-amber-50/60',
} as const;

const HEADER_STYLES = {
  inv:  'bg-blue-100 text-blue-800',
  del:  'bg-green-100 text-green-800',
  cons: 'bg-amber-100 text-amber-800',
} as const;

// ── Edit modal ─────────────────────────────────────────────────────────────────

type EditTarget = {
  deliveryDate: string;
  itemName:     string;
  originalQty:  number;
};

function EditModal({
  target,
  existingOverride,
  storeName,
  onClose,
  onSaved,
}: {
  target:           EditTarget;
  existingOverride: Override | undefined;
  storeName:        string;
  onClose:          () => void;
  onSaved:          () => void;
}) {
  const existingAdHoc = existingOverride
    ? existingOverride.overridden_qty - (existingOverride.original_qty ?? target.originalQty)
    : 0;

  const [adHocStr, setAdHocStr] = useState(existingAdHoc === 0 ? '' : String(existingAdHoc));
  const [comment, setComment]   = useState(existingOverride?.comment ?? '');
  const [saving, setSaving]     = useState(false);

  const adHoc      = adHocStr === '' || adHocStr === '-' ? 0 : parseFloat(adHocStr);
  const totalQty   = target.originalQty + (isNaN(adHoc) ? 0 : adHoc);
  const hasChange  = existingOverride !== undefined;

  const handleSave = useCallback(async () => {
    const parsed = parseFloat(adHocStr === '' ? '0' : adHocStr);
    if (isNaN(parsed)) return;
    setSaving(true);
    const overridden = target.originalQty + parsed;
    await fetch('/api/inventory/movements/overrides', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store:          storeName,
        delivery_date:  target.deliveryDate,
        item_name:      target.itemName,
        overridden_qty: overridden,
        original_qty:   target.originalQty,
        comment:        comment.trim() || null,
      }),
    });
    onSaved();
  }, [adHocStr, comment, storeName, target, onSaved]);

  const handleRevert = useCallback(async () => {
    setSaving(true);
    await fetch('/api/inventory/movements/overrides', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store:         storeName,
        delivery_date: target.deliveryDate,
        item_name:     target.itemName,
      }),
    });
    onSaved();
  }, [storeName, target, onSaved]);

  const dateLabel = fmtDateLabel(target.deliveryDate) ?? target.deliveryDate;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Delivery Adjustment</p>
            <h2 className="text-sm font-semibold text-gray-900 leading-snug">{target.itemName}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{dateLabel}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">

          {/* Delivery report row (read-only) */}
          <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5">
            <span className="text-xs text-gray-500">Delivery report</span>
            <span className="text-sm font-semibold text-gray-700 tabular-nums">{target.originalQty}</span>
          </div>

          {/* Ad hoc input */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Ad hoc adjustment
              <span className="ml-2 text-gray-400 font-normal">positive = extra delivery · negative = items removed</span>
            </label>
            <input
              type="number"
              value={adHocStr}
              onChange={(e) => setAdHocStr(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]/50"
              autoFocus
            />
          </div>

          {/* Total preview */}
          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <span className="text-xs text-gray-500">Total delivery</span>
            <span className="text-sm font-bold tabular-nums text-gray-900">{totalQty}</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Comment <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="e.g. Transfer from Eschborn…"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]/50"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 pb-5">
          {hasChange && (
            <button
              onClick={handleRevert}
              disabled={saving}
              className="px-4 py-2 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              Revert
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || isNaN(parseFloat(adHocStr === '' ? '0' : adHocStr))}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1B5E20] text-xs font-medium text-white hover:bg-[#1B5E20]/90 transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function InventoryMovementsPage({
  params,
}: {
  params: Promise<{ store: string }>;
}) {
  const { store } = use(params);
  const storeName = decodeURIComponent(store);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<MovementsData>({
    queryKey: ['inventory-movements', storeName],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/movements/${encodeURIComponent(storeName)}`);
      if (!res.ok) throw new Error('Failed to load movement data');
      return res.json();
    },
  });

  const { data: overridesList = [] } = useQuery<Override[]>({
    queryKey: ['inventory-movement-overrides', storeName],
    queryFn: async () => {
      const res = await fetch(
        `/api/inventory/movements/overrides?store=${encodeURIComponent(storeName)}`,
      );
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const overrides = useMemo<OverridesMap>(() => {
    const map: OverridesMap = {};
    for (const ov of overridesList) {
      if (!map[ov.delivery_date]) map[ov.delivery_date] = {};
      map[ov.delivery_date][ov.item_name] = ov;
    }
    return map;
  }, [overridesList]);

  // ── Week picker ──────────────────────────────────────────────────────────────

  const weeks = useMemo(() => {
    const seen = new Set<string>();
    for (const c of data?.cycles ?? []) seen.add(getWeekStart(c.deliveryDate));
    return Array.from(seen).sort((a, b) => b.localeCompare(a));
  }, [data]);

  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const effectiveWeek = selectedWeek ?? weeks[0] ?? null;

  const filteredCycles = useMemo(
    () => (data?.cycles ?? []).filter((c) => getWeekStart(c.deliveryDate) === effectiveWeek),
    [data, effectiveWeek],
  );

  const cols = buildColumns(filteredCycles);

  // ── Override helpers ──────────────────────────────────────────────────────────

  const getEffectiveDel = useCallback(
    (deliveryDate: string, itemName: string, original: number | null): number | null => {
      return overrides[deliveryDate]?.[itemName]?.overridden_qty ?? original;
    },
    [overrides],
  );

  const getEffectiveCons = useCallback(
    (cycleIdx: number, itemName: string): number | null => {
      const cycle = filteredCycles[cycleIdx];
      if (!cycle?.postInv) return null;
      const pre    = cycle.preInv[itemName] ?? 0;
      const rawDel = cycle.delivery[itemName] ?? 0;
      const del    = overrides[cycle.deliveryDate]?.[itemName]?.overridden_qty ?? rawDel;
      const post   = cycle.postInv[itemName] ?? 0;
      return pre + del - post;
    },
    [filteredCycles, overrides],
  );

  // ── Edit modal state ──────────────────────────────────────────────────────────

  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const openEdit = useCallback(
    (col: Col, itemName: string) => {
      if (col.type !== 'del' || !col.deliveryDate) return;
      const cycle = filteredCycles[col.cycleIdx];
      const originalQty = cycle?.delivery[itemName] ?? 0;
      setEditTarget({ deliveryDate: col.deliveryDate, itemName, originalQty });
    },
    [filteredCycles],
  );

  const handleSaved = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['inventory-movement-overrides', storeName] });
    setEditTarget(null);
  }, [qc, storeName]);

  // ── Section grouping ──────────────────────────────────────────────────────────

  const sections = useMemo(() => {
    const result: { title: string; items: { name: string; unit: string }[] }[] = [];
    for (const item of data?.items ?? []) {
      const last = result[result.length - 1];
      if (!last || last.title !== item.section) {
        result.push({ title: item.section, items: [] });
      }
      result[result.length - 1].items.push({ name: item.name, unit: item.unit });
    }
    return result;
  }, [data]);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Edit modal */}
      {editTarget && (
        <EditModal
          target={editTarget}
          existingOverride={overrides[editTarget.deliveryDate]?.[editTarget.itemName]}
          storeName={storeName}
          onClose={() => setEditTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Movements</h1>
          <p className="text-sm text-gray-500 mt-0.5">Item-level movements per delivery cycle</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {weeks.length > 0 && (
            <div className="relative">
              <select
                value={effectiveWeek ?? ''}
                onChange={(e) => setSelectedWeek(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 shadow-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/20 cursor-pointer"
              >
                {weeks.map((w) => (
                  <option key={w} value={w}>
                    {fmtWeekLabel(w)}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
            </div>
          )}

          <Link
            href="/inventory/overview"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors shadow-sm whitespace-nowrap"
          >
            <LayoutGrid size={13} />
            Group
          </Link>

          {STORES.map((s) => {
            const isActive = s === storeName;
            return (
              <Link
                key={s}
                href={`/inventory/movements/${encodeURIComponent(s)}`}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors shadow-sm whitespace-nowrap ${
                  isActive
                    ? 'border-[#1B5E20] bg-[#1B5E20] text-white'
                    : 'border-[#1B5E20]/30 bg-[#1B5E20]/5 text-[#1B5E20] hover:bg-[#1B5E20]/10'
                }`}
              >
                <TrendingUp size={12} />
                {s}
              </Link>
            );
          })}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={24} className="animate-spin text-gray-300" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-sm text-red-700">
          Failed to load movement data. Please try refreshing.
        </div>
      )}

      {!isLoading && !error && data && (
        <>
          {cols.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 border border-dashed border-gray-200 rounded-xl gap-2">
              <p className="text-sm text-gray-400">No delivery cycles found for {storeName}.</p>
              <p className="text-xs text-gray-300">Make sure inventory submissions are linked to delivery dates.</p>
            </div>
          ) : (
            <div className="overflow-y-auto rounded-xl border border-gray-200 shadow-sm max-h-[calc(100vh-220px)]">
              <table className="text-xs border-separate border-spacing-0 w-full table-fixed">
                <thead>
                  <tr className="[&>th]:shadow-[0_2px_4px_rgba(0,0,0,0.08)]">
                    <th className="sticky top-0 left-0 z-30 w-[160px] bg-white px-3 py-3 text-left font-semibold text-gray-600 uppercase tracking-wide border-b-2 border-r border-b-gray-300 border-r-gray-200">
                      Item
                    </th>
                    <th className="sticky top-0 z-20 w-[70px] bg-white px-2 py-3 text-left font-semibold text-gray-500 uppercase tracking-wide border-b-2 border-r border-b-gray-300 border-r-gray-200">
                      Unit
                    </th>
                    {cols.map((col, ci) => (
                      <th
                        key={ci}
                        className={`sticky top-0 z-10 px-1 py-2.5 text-center border-b-2 border-r border-b-gray-300 border-r-gray-200 ${HEADER_STYLES[col.type]}`}
                      >
                        <div className="font-bold text-[11px] uppercase tracking-widest leading-tight">
                          {col.typeLabel}
                        </div>
                        {col.dateLabel && (
                          <div className="font-normal text-[10px] leading-tight mt-0.5 opacity-70">
                            {col.dateLabel}
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {sections.map((section) => (
                    <>
                      <tr key={`section-${section.title}`} className="bg-green-50/80">
                        <td
                          colSpan={2 + cols.length}
                          className="sticky left-0 px-4 py-2 text-xs font-bold text-[#1B5E20] uppercase tracking-widest border-b border-gray-200"
                        >
                          {section.title}
                        </td>
                      </tr>

                      {section.items.map((item, idx) => {
                        const isEven = idx % 2 === 0;
                        const rowBg  = isEven ? 'bg-white' : 'bg-gray-50/50';

                        return (
                          <tr
                            key={item.name}
                            className={`${rowBg} hover:bg-blue-50/20 transition-colors border-b border-gray-100`}
                          >
                            <td className={`sticky left-0 z-10 px-3 py-2 font-medium text-gray-800 border-r border-gray-100 truncate ${rowBg}`}>
                              {item.name}
                            </td>
                            <td className="px-2 py-2 text-gray-400 truncate border-r border-gray-100">
                              {item.unit}
                            </td>

                            {cols.map((col, ci) => {
                              if (col.type === 'del') {
                                const rawVal      = col.getValue(item.name);
                                const override    = col.deliveryDate ? overrides[col.deliveryDate]?.[item.name] : undefined;
                                const effectiveVal = col.deliveryDate
                                  ? getEffectiveDel(col.deliveryDate, item.name, rawVal)
                                  : rawVal;
                                const isOverridden = override !== undefined;

                                const adHoc = isOverridden
                                  ? override!.overridden_qty - (override!.original_qty ?? rawVal ?? 0)
                                  : 0;

                                const tooltipText = isOverridden
                                  ? [override!.comment, `Report: ${override!.original_qty ?? '?'} · Ad hoc: ${adHoc > 0 ? '+' : ''}${adHoc}`]
                                      .filter(Boolean).join('\n')
                                  : undefined;

                                return (
                                  <td
                                    key={ci}
                                    className={`relative p-0 border-r border-gray-100 ${
                                      isOverridden
                                        ? 'bg-orange-50 ring-1 ring-inset ring-orange-300'
                                        : 'bg-green-50/60'
                                    }`}
                                  >
                                    {/* Orange corner triangle */}
                                    {isOverridden && (
                                      <span
                                        className="absolute top-0 right-0 w-0 h-0 pointer-events-none z-10"
                                        style={{
                                          borderTop:  '8px solid #f97316',
                                          borderLeft: '8px solid transparent',
                                        }}
                                      />
                                    )}
                                    <button
                                      type="button"
                                      title={tooltipText}
                                      onClick={() => openEdit(col, item.name)}
                                      className="w-full py-1.5 px-1 text-center tabular-nums cursor-pointer hover:brightness-95 transition-all"
                                    >
                                      {isOverridden ? (
                                        <span className="flex items-baseline justify-center gap-0.5 leading-none">
                                          <span className="text-orange-700 font-semibold">{adHoc > 0 ? '+' : ''}{adHoc}</span>
                                          <span className="text-[9px] text-gray-400 mx-0.5">+</span>
                                          <span className="text-orange-500/80 text-[10px]">{override!.original_qty ?? rawVal ?? 0}</span>
                                        </span>
                                      ) : (
                                        <span className={effectiveVal === null || effectiveVal === 0 ? 'text-gray-300' : 'text-gray-800'}>
                                          {effectiveVal === null || effectiveVal === 0 ? '—' : effectiveVal}
                                        </span>
                                      )}
                                    </button>
                                  </td>
                                );
                              }

                              if (col.type === 'cons') {
                                const effectiveVal = getEffectiveCons(col.cycleIdx, item.name);
                                const isNegative   = effectiveVal !== null && effectiveVal < 0;

                                return (
                                  <td
                                    key={ci}
                                    className={`px-1 py-2 text-center tabular-nums border-r border-gray-100 text-gray-800 ${
                                      isNegative ? 'bg-red-100' : COL_STYLES.cons
                                    }`}
                                  >
                                    {effectiveVal === null ? (
                                      <span className="text-gray-300">—</span>
                                    ) : (
                                      effectiveVal
                                    )}
                                  </td>
                                );
                              }

                              // INV cell
                              const val = col.getValue(item.name);
                              return (
                                <td
                                  key={ci}
                                  className={`px-1 py-2 text-center tabular-nums border-r border-gray-100 text-gray-800 ${COL_STYLES.inv}`}
                                >
                                  {val === null || val === undefined ? (
                                    <span className="text-gray-300">—</span>
                                  ) : (
                                    val
                                  )}
                                </td>
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
          )}

          {cols.length > 0 && (
            <div className="flex items-center gap-4 mt-4 text-xs text-gray-500 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-blue-100 inline-block" /> Inventory snapshot
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-green-100 inline-block" /> Delivery — click to edit
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-100 inline-block" /> Consumption (Inv + Del − Next Inv)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-orange-100 border border-orange-300 inline-block" /> Override applied
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
