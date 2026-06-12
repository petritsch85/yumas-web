'use client';

import { use, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ChevronDown, LayoutGrid, TrendingUp } from 'lucide-react';
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

// ── Date helpers ──────────────────────────────────────────────────────────────

const EOD_CUTOFF = 4;

function submissionDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (d.getHours() < EOD_CUTOFF) d.setDate(d.getDate() - 1);
  return d;
}

function fmtInvHeader(iso: string | null): string {
  const d = submissionDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtDeliveryHeader(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Short versions for compact two-row header
function fmtInvDateLabel(iso: string | null): string | null {
  const d = submissionDate(iso);
  if (!d) return null;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtDateLabel(isoDate: string): string | null {
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Returns the Monday (YYYY-MM-DD) of the ISO week containing dateStr. */
function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun … 6=Sat
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
  type:      ColType;
  typeLabel: string;        // e.g. "INV" / "DEL" / "CONS"
  dateLabel: string | null; // e.g. "Mon 8 Jun"  (null for Consumption)
  getValue:  (item: string) => number | null;
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
    type:      'inv',
    typeLabel: TYPE_LABELS.inv,
    dateLabel: fmtInvDateLabel(cycles[0].preInvDate),
    getValue:  (item) => cycles[0].preInv[item] ?? null,
  });

  for (let i = 0; i < cycles.length; i++) {
    const c = cycles[i];

    cols.push({
      type:      'del',
      typeLabel: TYPE_LABELS.del,
      dateLabel: fmtDateLabel(c.deliveryDate),
      getValue:  (item) => {
        const v = c.delivery[item];
        return v !== undefined ? v : 0;
      },
    });

    cols.push({
      type:      'cons',
      typeLabel: TYPE_LABELS.cons,
      dateLabel: null,
      getValue:  (item) => c.consumption?.[item] ?? null,
    });

    const postDateLabel = c.postInvDate
      ? fmtInvDateLabel(c.postInvDate)
      : i + 1 < cycles.length
      ? fmtInvDateLabel(cycles[i + 1].preInvDate)
      : null;

    cols.push({
      type:      'inv',
      typeLabel: TYPE_LABELS.inv,
      dateLabel: postDateLabel,
      getValue:  (item) => {
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function InventoryMovementsPage({
  params,
}: {
  params: Promise<{ store: string }>;
}) {
  const { store } = use(params);
  const storeName = decodeURIComponent(store);

  const { data, isLoading, error } = useQuery<MovementsData>({
    queryKey: ['inventory-movements', storeName],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/movements/${encodeURIComponent(storeName)}`);
      if (!res.ok) throw new Error('Failed to load movement data');
      return res.json();
    },
  });

  // ── Week picker ──────────────────────────────────────────────────────────────

  const weeks = useMemo(() => {
    const seen = new Set<string>();
    for (const c of data?.cycles ?? []) seen.add(getWeekStart(c.deliveryDate));
    return Array.from(seen).sort((a, b) => b.localeCompare(a)); // newest first
  }, [data]);

  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);

  // Always track the effective week — default to most recent once data arrives
  const effectiveWeek = selectedWeek ?? weeks[0] ?? null;

  const filteredCycles = useMemo(
    () => (data?.cycles ?? []).filter((c) => getWeekStart(c.deliveryDate) === effectiveWeek),
    [data, effectiveWeek],
  );

  const cols = buildColumns(filteredCycles);

  // Group items by section
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

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Movements</h1>
          <p className="text-sm text-gray-500 mt-0.5">Item-level movements per delivery cycle</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Week picker */}
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

          {/* Group button */}
          <Link
            href="/inventory/overview"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors shadow-sm whitespace-nowrap"
          >
            <LayoutGrid size={13} />
            Group
          </Link>

          {/* Store buttons */}
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
            <div className="rounded-xl border border-gray-200 shadow-sm">
              <table className="text-xs border-collapse w-full table-fixed">
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
                        const rowBg = isEven ? 'bg-white' : 'bg-gray-50/50';

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
                              const val = col.getValue(item.name);
                              const isConsumption = col.type === 'cons';
                              const isNegative    = isConsumption && val !== null && val < 0;

                              return (
                                <td
                                  key={ci}
                                  className={`px-1 py-2 text-center tabular-nums border-r border-gray-100 ${COL_STYLES[col.type]} ${
                                    isNegative ? 'text-red-600 font-semibold' : 'text-gray-800'
                                  }`}
                                >
                                  {val === null || val === undefined ? (
                                    <span className="text-gray-300">—</span>
                                  ) : col.type === 'del' && val === 0 ? (
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
                <span className="w-3 h-3 rounded bg-green-100 inline-block" /> Delivery (packed qty)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-100 inline-block" /> Consumption (Inv + Del − Next Inv)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-red-500 font-semibold">negative</span> = more in stock than expected
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
