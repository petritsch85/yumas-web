'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

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

// ── Column definitions ─────────────────────────────────────────────────────────

type Col =
  | { type: 'inv';  label: string; getValue: (item: string, cycles: Cycle[]) => number | null }
  | { type: 'del';  label: string; getValue: (item: string, cycles: Cycle[]) => number | null }
  | { type: 'cons'; label: string; getValue: (item: string, cycles: Cycle[]) => number | null };

function buildColumns(cycles: Cycle[]): Col[] {
  const cols: Col[] = [];
  if (!cycles.length) return cols;

  // Opening inventory (preInv of first cycle)
  cols.push({
    type: 'inv',
    label: `Inv ${fmtInvHeader(cycles[0].preInvDate)}`,
    getValue: (item) => cycles[0].preInv[item] ?? null,
  });

  for (let i = 0; i < cycles.length; i++) {
    const c = cycles[i];

    cols.push({
      type: 'del',
      label: `Del ${fmtDeliveryHeader(c.deliveryDate)}`,
      getValue: (item) => {
        const v = c.delivery[item];
        return v !== undefined ? v : 0;
      },
    });

    cols.push({
      type: 'cons',
      label: 'Consumption',
      getValue: (item) => c.consumption?.[item] ?? null,
    });

    // Closing inventory for this cycle
    // Use postInvDate directly; fall back to preInvDate of next cycle for label
    const postLabel = c.postInvDate
      ? fmtInvHeader(c.postInvDate)
      : i + 1 < cycles.length
      ? fmtInvHeader(cycles[i + 1].preInvDate)
      : '—';

    cols.push({
      type: 'inv',
      label: `Inv ${postLabel}`,
      getValue: (item) => {
        // postInv of this cycle == preInv of next cycle (same data, deduplicated)
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

  const cols = buildColumns(data?.cycles ?? []);

  // Group items by section
  const sections: { title: string; items: { name: string; unit: string }[] }[] = [];
  for (const item of data?.items ?? []) {
    const last = sections[sections.length - 1];
    if (!last || last.title !== item.section) {
      sections.push({ title: item.section, items: [] });
    }
    sections[sections.length - 1].items.push({ name: item.name, unit: item.unit });
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <Link
            href="/inventory/overview"
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={16} />
            Current Inventory
          </Link>
          <span className="text-gray-300">/</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Inventory Movements — {storeName}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Item-level movements per delivery cycle
            </p>
          </div>
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
            <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
              <table className="text-xs border-collapse min-w-full">
                <thead>
                  <tr>
                    {/* Fixed columns */}
                    <th className="sticky left-0 z-20 bg-gray-50 px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap border-b border-r border-gray-200 min-w-[200px]">
                      Item
                    </th>
                    <th className="bg-gray-50 px-3 py-3 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap border-b border-r border-gray-200">
                      Unit
                    </th>

                    {/* Dynamic columns */}
                    {cols.map((col, ci) => (
                      <th
                        key={ci}
                        className={`px-3 py-3 text-right font-semibold uppercase tracking-wide whitespace-nowrap border-b border-r border-gray-200 ${HEADER_STYLES[col.type]}`}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {sections.map((section) => (
                    <>
                      {/* Section header row */}
                      <tr key={`section-${section.title}`} className="bg-green-50/80">
                        <td
                          colSpan={2 + cols.length}
                          className="sticky left-0 px-4 py-2 text-xs font-bold text-[#1B5E20] uppercase tracking-widest border-b border-gray-200"
                        >
                          {section.title}
                        </td>
                      </tr>

                      {/* Item rows */}
                      {section.items.map((item, idx) => {
                        const isEven = idx % 2 === 0;
                        const rowBg = isEven ? 'bg-white' : 'bg-gray-50/50';

                        return (
                          <tr key={item.name} className={`${rowBg} hover:bg-blue-50/20 transition-colors border-b border-gray-100`}>
                            {/* Item name — sticky */}
                            <td className={`sticky left-0 z-10 px-4 py-2.5 font-medium text-gray-800 border-r border-gray-100 ${rowBg}`}>
                              {item.name}
                            </td>

                            {/* Unit */}
                            <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap border-r border-gray-100">
                              {item.unit}
                            </td>

                            {/* Dynamic columns */}
                            {cols.map((col, ci) => {
                              const val = col.getValue(item.name, data.cycles);
                              const isConsumption = col.type === 'cons';
                              const isNegative    = isConsumption && val !== null && val < 0;

                              return (
                                <td
                                  key={ci}
                                  className={`px-3 py-2.5 text-right tabular-nums border-r border-gray-100 ${COL_STYLES[col.type]} ${
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

          {/* Legend */}
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
