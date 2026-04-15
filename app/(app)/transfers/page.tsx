'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate } from '@/lib/utils';
import type { TransferStatus } from '@/types';

const STATUS_OPTIONS: (TransferStatus | 'all')[] = ['all', 'pending', 'in_transit', 'received'];

export default function TransfersPage() {
  const [statusFilter, setStatusFilter] = useState<TransferStatus | 'all'>('all');

  const { data: transfers, isLoading } = useQuery({
    queryKey: ['transfers', statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('transfers')
        .select('*, from_location:locations!from_location_id(name), to_location:locations!to_location_id(name)')
        .order('transfer_date', { ascending: false });
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data } = await q;
      return data ?? [];
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Transfers</h1>
        <button className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2">
          <Plus size={16} />
          New Transfer
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
              statusFilter === s
                ? 'text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
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
          ) : !transfers || transfers.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No transfers found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Transfer #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">From</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">To</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {(transfers as Record<string, unknown>[]).map((t) => (
                  <tr key={t.id as string} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{t.transfer_number as string}</td>
                    <td className="px-4 py-3 text-gray-800">{(t.from_location as { name: string } | null)?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-800">{(t.to_location as { name: string } | null)?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(t.transfer_date as string)}</td>
                    <td className="px-4 py-3"><StatusBadge status={t.status as string} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
