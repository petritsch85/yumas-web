'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { RefreshCw } from 'lucide-react';

const LOCATIONS = ['Eschborn', 'Taunus', 'Westend', 'ZK'] as const;
type LocationName = typeof LOCATIONS[number];

type ItemRow = {
  section: string;
  name: string;
  unit: string;
  quantities: Partial<Record<LocationName, number>>;
  total: number;
};

type SectionGroup = {
  title: string;
  items: ItemRow[];
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(iso: string): string {
  const diffMins = (Date.now() - new Date(iso).getTime()) / 60_000;
  // Round to nearest 30 minutes
  const r = Math.round(diffMins / 30) * 30;
  if (r < 30)  return 'just now';
  if (r < 60)  return '30 min ago';

  const totalHours = r / 60;
  const days  = Math.floor(totalHours / 24);
  const hours = totalHours - days * 24; // 0, 0.5, 1, 1.5 … 23.5

  const hLabel = hours === 0 ? '' : hours === 0.5 ? ' 30 min' : ` ${hours}h`;

  if (days === 0) return `${hours}h ago`;
  if (days === 1) return `1 day${hLabel} ago`;
  return `${days} days${hLabel} ago`;
}

export default function InventoryOverviewPage() {
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['inventory-overview'],
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      // Fetch all submissions, newest first
      const { data: submissions, error } = await supabase
        .from('inventory_submissions')
        .select('id, location_name, submitted_at, data')
        .order('submitted_at', { ascending: false });

      if (error) throw error;

      // Pick the latest submission per location
      const latestByLocation: Partial<Record<LocationName, { submitted_at: string; data: { section: string; name: string; unit: string; quantity: number }[] }>> = {};
      for (const sub of submissions ?? []) {
        const loc = sub.location_name as LocationName;
        if (LOCATIONS.includes(loc) && !latestByLocation[loc]) {
          latestByLocation[loc] = { submitted_at: sub.submitted_at, data: sub.data ?? [] };
        }
      }

      // Build unified item map: section -> name -> { unit, quantities }
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

      // Convert to sorted section groups
      const sections: SectionGroup[] = Object.entries(sectionMap).map(([title, items]) => ({
        title,
        items: Object.entries(items).map(([name, { unit, quantities }]) => {
          const total = Object.values(quantities).reduce((sum, q) => sum + (q ?? 0), 0);
          return { section: title, name, unit, quantities, total };
        }),
      }));

      return { sections, latestByLocation };
    },
  });

  const sections = data?.sections ?? [];
  const latestByLocation = data?.latestByLocation ?? {};

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Current Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">Latest submitted quantities per location</p>
        </div>
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && !isFetching && (
            <span className="text-xs text-gray-400">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin text-[#1B5E20]' : ''} />
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* "As of" dates per location */}
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
          No inventory submissions found. Submit inventory from the app first.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide min-w-[200px] z-10">
                    Item
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide min-w-[100px]">
                    Unit
                  </th>
                  {LOCATIONS.map((loc) => (
                    <th key={loc} className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide min-w-[90px]">
                      {loc}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-900 uppercase tracking-wide min-w-[80px] border-l border-gray-100">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <>
                    {/* Section header */}
                    <tr key={`section-${section.title}`} className="bg-[#F1F8E9] border-y border-green-100">
                      <td
                        colSpan={2 + LOCATIONS.length + 1}
                        className="sticky left-0 px-4 py-2 text-xs font-bold text-[#2E7D32] uppercase tracking-wider bg-[#F1F8E9]"
                      >
                        {section.title}
                      </td>
                    </tr>

                    {/* Item rows */}
                    {section.items.map((item, idx) => {
                      const isEven = idx % 2 === 0;
                      return (
                        <tr
                          key={item.name}
                          className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${isEven ? 'bg-white' : 'bg-gray-50/40'}`}
                        >
                          <td className={`sticky left-0 px-4 py-2.5 font-medium text-gray-800 ${isEven ? 'bg-white' : 'bg-gray-50/40'} z-10`}>
                            {item.name}
                          </td>
                          <td className="px-3 py-2.5 text-gray-400 text-xs">{item.unit}</td>
                          {LOCATIONS.map((loc) => {
                            const qty = item.quantities[loc];
                            return (
                              <td key={loc} className="px-4 py-2.5 text-right tabular-nums">
                                {qty == null ? (
                                  <span className="text-gray-200">—</span>
                                ) : qty === 0 ? (
                                  <span className="text-gray-300">0</span>
                                ) : (
                                  <span className="text-[#2E7D32] font-semibold">{qty}</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-4 py-2.5 text-right tabular-nums font-bold text-gray-900 border-l border-gray-100">
                            {item.total === 0
                              ? <span className="text-gray-300">0</span>
                              : item.total
                            }
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
    </div>
  );
}
