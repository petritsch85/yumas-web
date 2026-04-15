'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate } from '@/lib/utils';

export default function InventoryCountsPage() {
  const [locationFilter, setLocationFilter] = useState('all');

  const { data: locations } = useQuery({
    queryKey: ['locations-list'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').order('name');
      return data ?? [];
    },
  });

  const { data: counts, isLoading } = useQuery({
    queryKey: ['inventory-counts', locationFilter],
    queryFn: async () => {
      let q = supabase
        .from('inventory_counts')
        .select('*, location:locations(name), lines:inventory_count_lines(count)')
        .order('count_date', { ascending: false });
      if (locationFilter !== 'all') q = q.eq('location_id', locationFilter);
      const { data } = await q;
      return data ?? [];
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inventory Counts</h1>
        <button className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2">
          <Plus size={16} />
          New Count
        </button>
      </div>

      {/* Location filter */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Location:</label>
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
        >
          <option value="all">All Locations</option>
          {(locations as { id: string; name: string }[])?.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : !counts || counts.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No inventory counts found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Items</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {(counts as Record<string, unknown>[]).map((count) => {
                  const lineCount = (count.lines as { count: number }[] | null)?.[0]?.count ?? 0;
                  return (
                    <tr key={count.id as string} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                      <td className="px-4 py-3 text-gray-800">{formatDate(count.count_date as string)}</td>
                      <td className="px-4 py-3 text-gray-800">{(count.location as { name: string } | null)?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{lineCount}</td>
                      <td className="px-4 py-3"><StatusBadge status={count.status as string ?? 'pending'} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
