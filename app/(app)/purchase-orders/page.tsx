'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate, formatCurrency } from '@/lib/utils';
import type { POStatus } from '@/types';

const STATUS_OPTIONS: (POStatus | 'all')[] = ['all', 'draft', 'sent', 'confirmed', 'partial', 'received', 'cancelled'];

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<POStatus | 'all'>('all');

  const { data: orders, isLoading } = useQuery({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('purchase_orders')
        .select('*, supplier:suppliers(name), destination_location:locations(name)')
        .order('created_at', { ascending: false });
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data } = await q;
      return data ?? [];
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
        <button
          onClick={() => router.push('/purchase-orders/new')}
          className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          New PO
        </button>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
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
              {[...Array(8)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : !orders || orders.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No purchase orders found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PO Number</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expected</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {(orders as Record<string, unknown>[]).map((po) => (
                  <tr
                    key={po.id as string}
                    className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => router.push(`/purchase-orders/${po.id}`)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{po.po_number as string}</td>
                    <td className="px-4 py-3 text-gray-800">{(po.supplier as { name: string } | null)?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{(po.destination_location as { name: string } | null)?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(po.order_date as string)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(po.expected_delivery_date as string)}</td>
                    <td className="px-4 py-3"><StatusBadge status={po.status as string} /></td>
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
