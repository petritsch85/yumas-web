'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate, formatCurrency } from '@/lib/utils';
import type { POStatus } from '@/types';

const STATUS_TRANSITIONS: Record<POStatus, POStatus | null> = {
  draft: 'sent',
  sent: 'confirmed',
  confirmed: 'partial',
  partial: 'received',
  received: null,
  cancelled: null,
};

const TRANSITION_LABELS: Partial<Record<POStatus, string>> = {
  sent: 'Mark as Sent',
  confirmed: 'Confirm Order',
  partial: 'Mark Partial',
  received: 'Mark Received',
};

export default function PODetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: po, isLoading } = useQuery({
    queryKey: ['po', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          supplier:suppliers(id, name, contact_name, email, phone),
          destination_location:locations(id, name),
          lines:purchase_order_lines(*, item:items(name, sku, unit:units(abbreviation)))
        `)
        .eq('id', id)
        .single();
      return data;
    },
  });

  const updateStatus = useMutation({
    mutationFn: async (newStatus: POStatus) => {
      const { error } = await supabase
        .from('purchase_orders')
        .update({ status: newStatus })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['po', id] }),
  });

  const cancelPO = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('purchase_orders')
        .update({ status: 'cancelled' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['po', id] }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-40 bg-white rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!po) return <div className="text-center text-gray-500 mt-12">Purchase order not found</div>;

  const currentStatus = po.status as POStatus;
  const nextStatus = STATUS_TRANSITIONS[currentStatus];
  const lines = (po.lines ?? []) as Record<string, unknown>[];
  const total = lines.reduce((sum: number, l: Record<string, unknown>) => sum + ((l.line_total as number) ?? 0), 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{po.po_number as string}</h1>
          <StatusBadge status={currentStatus} />
        </div>
        <div className="flex gap-2">
          {nextStatus && TRANSITION_LABELS[nextStatus] && (
            <button
              onClick={() => updateStatus.mutate(nextStatus)}
              disabled={updateStatus.isPending}
              className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-50"
            >
              {TRANSITION_LABELS[nextStatus]}
            </button>
          )}
          {currentStatus !== 'cancelled' && currentStatus !== 'received' && (
            <button
              onClick={() => cancelPO.mutate()}
              disabled={cancelPO.isPending}
              className="bg-white text-red-600 border border-red-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Order Information</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Supplier</dt>
              <dd className="font-medium text-gray-900">{(po.supplier as { name: string } | null)?.name ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Contact</dt>
              <dd className="text-gray-700">{(po.supplier as Record<string, string | null> | null)?.contact_name ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Destination</dt>
              <dd className="text-gray-700">{(po.destination_location as { name: string } | null)?.name ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Order Date</dt>
              <dd className="text-gray-700">{formatDate(po.order_date as string)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Expected Delivery</dt>
              <dd className="text-gray-700">{formatDate(po.expected_delivery_date as string)}</dd>
            </div>
            {po.notes && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Notes</dt>
                <dd className="text-gray-700 text-right max-w-64">{po.notes as string}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-900">{formatCurrency(total)}</div>
            <div className="text-gray-500 text-sm mt-1">Total Order Value</div>
            <div className="text-gray-400 text-xs mt-0.5">{lines.length} line{lines.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>

      {/* Lines */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Order Lines</h2>
        </div>
        <div className="overflow-x-auto">
          {lines.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">No lines on this order</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Ordered</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Received</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => {
                  const itemObj = line.item as Record<string, string | null | Record<string, string>> | null;
                  const unitObj = itemObj?.unit as { abbreviation: string } | null;
                  return (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{(itemObj?.name as string) ?? '—'}</div>
                        {itemObj?.sku && <div className="text-xs text-gray-400 font-mono">{itemObj.sku as string}</div>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-800">
                        {line.quantity_ordered as number} {unitObj?.abbreviation ?? ''}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{line.quantity_received as number}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(line.unit_price as number)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(line.line_total as number)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={4} className="px-4 py-3 text-right font-semibold text-gray-700">Total</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">{formatCurrency(total)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
