'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate } from '@/lib/utils';
import type { ProductionStatus } from '@/types';

const STATUS_OPTIONS: (ProductionStatus | 'all')[] = ['all', 'planned', 'in_progress', 'completed', 'cancelled'];

export default function ProductionPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<ProductionStatus | 'all'>('all');

  const { data: batches, isLoading } = useQuery({
    queryKey: ['production-batches', statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('production_batches')
        .select('*, recipe:recipes(name, output_item:items(name)), location:locations(name)')
        .order('planned_date', { ascending: false });
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data } = await q;
      return data ?? [];
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Production</h1>
        <div className="flex gap-2">
          <button
            onClick={() => router.push('/production/recipes')}
            className="bg-white text-gray-700 border border-gray-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Recipes
          </button>
          <button className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2">
            <Plus size={16} />
            New Batch
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
              statusFilter === s ? 'text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
            }`}
            style={statusFilter === s ? { backgroundColor: '#1B5E20' } : undefined}
          >
            {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : !batches || batches.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No production batches found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Batch #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipe</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Planned Date</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Planned Qty</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {(batches as Record<string, unknown>[]).map((batch) => {
                  const recipe = batch.recipe as Record<string, unknown> | null;
                  const outputItem = recipe?.output_item as { name: string } | null;
                  return (
                    <tr key={batch.id as string} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{batch.batch_number as string ?? `BATCH-${(batch.id as string).slice(0, 8)}`}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{recipe?.name as string ?? '—'}</div>
                        {outputItem && <div className="text-xs text-gray-400">{outputItem.name}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{(batch.location as { name: string } | null)?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(batch.planned_date as string)}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{batch.planned_quantity as number ?? '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={batch.status as string} /></td>
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
