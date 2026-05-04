'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Send, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate } from '@/lib/utils';
import type { POStatus } from '@/types';

// Full status flow
const STATUS_TRANSITIONS: Record<POStatus, POStatus | null> = {
  draft            : 'pending_approval',
  pending_approval : 'approved',
  approved         : 'sent',
  sent             : 'confirmed',
  confirmed        : 'partial',
  partial          : 'received',
  received         : null,
  cancelled        : null,
};

const TRANSITION_LABELS: Partial<Record<POStatus, string>> = {
  pending_approval : 'Submit for Approval',
  approved         : 'Approve Order',
  sent             : 'Mark as Sent',
  confirmed        : 'Supplier Confirmed',
  partial          : 'Mark Partial Delivery',
  received         : 'Mark Fully Received',
};

const TRANSITION_ICONS: Partial<Record<POStatus, React.ReactNode>> = {
  pending_approval : <Clock size={15} />,
  approved         : <CheckCircle size={15} />,
  sent             : <Send size={15} />,
};

const STATUS_COLOURS: Partial<Record<POStatus, string>> = {
  pending_approval : 'bg-amber-500 hover:bg-amber-600',
  approved         : 'bg-[#1B5E20] hover:bg-[#2E7D32]',
  sent             : 'bg-blue-600 hover:bg-blue-700',
};

const fmt = (n: number) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PODetailPage() {
  const { t } = useT();
  const { id }      = useParams<{ id: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      return data as { role: string } | null;
    },
  });

  const { data: po, isLoading } = useQuery({
    queryKey: ['po', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          supplier:suppliers(id, name, contact_name, email, phone),
          destination_location:locations(id, name),
          lines:purchase_order_lines(
            id, supplier_product_id, display_name, einheit,
            quantity_ordered, quantity_received, unit_price, line_total,
            item:items(name, sku)
          )
        `)
        .eq('id', id)
        .single();
      return data;
    },
  });

  const advanceStatus = useMutation({
    mutationFn: async (newStatus: POStatus) => {
      const { error } = await supabase.from('purchase_orders').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['po', id] }),
  });

  const cancelPO = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('purchase_orders').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['po', id] }),
  });

  if (isLoading) return (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-white rounded-lg animate-pulse" />)}
    </div>
  );

  if (!po) return <div className="text-center text-gray-500 mt-12">Purchase order not found</div>;

  const status      = po.status as POStatus;
  const nextStatus  = STATUS_TRANSITIONS[status];
  const lines       = (po.lines ?? []) as Record<string, unknown>[];
  const total       = lines.reduce((s, l) => s + ((l.line_total as number) ?? 0), 0);
  const supplier    = po.supplier as { name: string; email: string | null; contact_name: string | null } | null;

  // Only admins/managers can approve
  const canApprove  = profile?.role === 'admin' || profile?.role === 'manager';
  const needsApproval = nextStatus === 'approved';

  // Discrepancy check (any line received < ordered after confirmation)
  const hasDiscrepancy = status === 'partial' || lines.some((l) => {
    const ordered  = l.quantity_ordered as number;
    const received = l.quantity_received as number;
    return received > 0 && received < ordered;
  });

  const btnColour = nextStatus ? (STATUS_COLOURS[nextStatus] ?? 'bg-[#1B5E20] hover:bg-[#2E7D32]') : '';

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900">{po.po_number as string}</h1>
          <StatusBadge status={status} />
          {hasDiscrepancy && (
            <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
              <AlertTriangle size={12} /> Discrepancy
            </span>
          )}
        </div>

        <div className="flex gap-2 flex-shrink-0">
          {/* Advance status button */}
          {nextStatus && TRANSITION_LABELS[nextStatus] && (!needsApproval || canApprove) && (
            <button
              onClick={() => advanceStatus.mutate(nextStatus)}
              disabled={advanceStatus.isPending}
              className={`flex items-center gap-2 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${btnColour}`}
            >
              {TRANSITION_ICONS[nextStatus]}
              {TRANSITION_LABELS[nextStatus]}
            </button>
          )}
          {/* Pending approval — non-managers see a waiting badge */}
          {needsApproval && !canApprove && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
              <Clock size={13} /> Awaiting manager approval
            </span>
          )}
          {/* Cancel */}
          {status !== 'cancelled' && status !== 'received' && (
            <button
              onClick={() => { if (window.confirm('Cancel this purchase order?')) cancelPO.mutate(); }}
              disabled={cancelPO.isPending}
              className="flex items-center gap-1.5 text-red-600 border border-red-200 bg-white px-3 py-2 rounded-lg text-sm hover:bg-red-50 transition-colors"
            >
              <XCircle size={15} />
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* ── Info cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">

        {/* Order info */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Order Information</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><dt className="text-gray-400 text-xs uppercase font-semibold">Supplier</dt><dd className="font-medium text-gray-900 mt-0.5">{supplier?.name ?? '—'}</dd></div>
            <div><dt className="text-gray-400 text-xs uppercase font-semibold">Contact</dt><dd className="text-gray-700 mt-0.5">{supplier?.contact_name ?? '—'}</dd></div>
            <div><dt className="text-gray-400 text-xs uppercase font-semibold">Supplier Email</dt><dd className="text-gray-700 mt-0.5">{supplier?.email ?? '—'}</dd></div>
            <div><dt className="text-gray-400 text-xs uppercase font-semibold">Destination</dt><dd className="text-gray-700 mt-0.5">{(po.destination_location as { name: string } | null)?.name ?? '—'}</dd></div>
            <div><dt className="text-gray-400 text-xs uppercase font-semibold">Order Date</dt><dd className="text-gray-700 mt-0.5">{formatDate(po.order_date as string)}</dd></div>
            <div><dt className="text-gray-400 text-xs uppercase font-semibold">Expected Delivery</dt><dd className="text-gray-700 mt-0.5">{po.expected_delivery_date ? formatDate(po.expected_delivery_date as string) : '—'}</dd></div>
            {po.notes && (
              <div className="col-span-2"><dt className="text-gray-400 text-xs uppercase font-semibold">Notes</dt><dd className="text-gray-700 mt-0.5">{po.notes as string}</dd></div>
            )}
          </dl>
        </div>

        {/* Total */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 flex flex-col items-center justify-center gap-1">
          <div className="text-3xl font-bold text-gray-900">€{fmt(total)}</div>
          <div className="text-gray-400 text-sm">Total Order Value</div>
          <div className="text-gray-300 text-xs">{lines.length} line{lines.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {/* ── Order lines ────────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Order Lines</h2>
        </div>
        {lines.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">No lines on this order</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Ordered</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Received</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => {
                  const ordered  = line.quantity_ordered  as number;
                  const received = line.quantity_received as number;
                  const flag     = received > 0 && received < ordered;
                  return (
                    <tr key={i} className={`border-t border-gray-100 ${flag ? 'bg-amber-50' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">
                          {(line.display_name as string | null) ?? ((line.item as { name: string } | null)?.name) ?? '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{(line.einheit as string | null) ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{ordered}</td>
                      <td className={`px-4 py-3 text-right font-medium ${flag ? 'text-amber-600' : 'text-gray-600'}`}>
                        {received}
                        {flag && <AlertTriangle size={12} className="inline ml-1 text-amber-500" />}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {(line.unit_price as number) > 0 ? `€${fmt(line.unit_price as number)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        {(line.line_total as number) > 0 ? `€${fmt(line.line_total as number)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={5} className="px-4 py-3 text-right font-semibold text-gray-700">Total</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">€{fmt(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
