'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate, formatCurrency } from '@/lib/utils';
import type { WasteReason } from '@/types';

const REASON_OPTIONS: (WasteReason | 'all')[] = ['all', 'expired', 'damaged', 'spoiled', 'other'];

export default function WasteLogPage() {
  const router = useRouter();
  const [reason, setReason] = useState<WasteReason | 'all'>('all');

  const { data: wasteLogs, isLoading } = useQuery({
    queryKey: ['waste-logs', reason],
    queryFn: async () => {
      let q = supabase
        .from('waste_logs')
        .select('*, item:items(name), location:locations(name)')
        .order('waste_date', { ascending: false });
      if (reason !== 'all') q = q.eq('reason', reason);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: monthlySummary } = useQuery({
    queryKey: ['waste-monthly'],
    queryFn: async () => {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const { data } = await supabase
        .from('waste_logs')
        .select('quantity, unit_cost')
        .gte('waste_date', firstDay);
      const total = (data ?? []).reduce((sum, row) => {
        return sum + (row.quantity * (row.unit_cost ?? 0));
      }, 0);
      return total;
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Waste Log</h1>
        <button
          onClick={() => router.push('/waste/new')}
          className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          Log Waste
        </button>
      </div>

      {/* Summary card */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 mb-6 flex items-center gap-4">
        <div>
          <div className="text-2xl font-bold text-red-600">{formatCurrency(monthlySummary ?? 0)}</div>
          <div className="text-sm text-gray-500">Total waste value this month</div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {REASON_OPTIONS.map((r) => (
          <button
            key={r}
            onClick={() => setReason(r)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
              reason === r ? 'text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
            }`}
            style={reason === r ? { backgroundColor: '#1B5E20' } : undefined}
          >
            {r === 'all' ? 'All Reasons' : r}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : !wasteLogs || wasteLogs.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No waste logs found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                {(wasteLogs as Record<string, unknown>[]).map((log) => (
                  <tr key={log.id as string} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{formatDate(log.waste_date as string)}</td>
                    <td className="px-4 py-3 text-gray-900 font-medium">{(log.item as { name: string } | null)?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{(log.location as { name: string } | null)?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-800">{log.quantity as number}</td>
                    <td className="px-4 py-3"><StatusBadge status={log.reason as string} /></td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {log.unit_cost != null ? formatCurrency((log.quantity as number) * (log.unit_cost as number)) : '—'}
                    </td>
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
