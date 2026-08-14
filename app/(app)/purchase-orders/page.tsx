'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Trash2 } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate } from '@/lib/utils';
import type { POStatus } from '@/types';
import { useT } from '@/lib/i18n';

const STATUS_OPTIONS: (POStatus | 'all')[] = [
  'all', 'draft', 'pending_approval', 'sent', 'confirmed', 'partial', 'received', 'cancelled',
];
const APPROVER_NAMES = ['Nikolas Peters', 'Benjamin Peters', 'Marino Wolf'];

type PoLine = {
  id: string;
  siId: string;       // supplier_items.id (dropdown selection)
  dbItemId: string;   // items.id (stored in purchase_order_lines.item_id)
  displayName: string;
  einheit: string;
  unitPrice: number;
  qty: string;
};

function uid() { return Math.random().toString(36).slice(2); }
function emptyLine(): PoLine { return { id: uid(), siId: '', dbItemId: '', displayName: '', einheit: '', unitPrice: 0, qty: '' }; }
function generatePoNumber() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `PO-${ymd}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const { t } = useT();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<POStatus | 'all'>('all');
  const [showModal, setShowModal] = useState(false);

  // Modal state
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poLocationId, setPoLocationId] = useState('');
  const [poLines, setPoLines] = useState<PoLine[]>([emptyLine()]);
  const [submitError, setSubmitError] = useState('');

  // Current user profile
  const { data: profile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
      return data;
    },
  });
  const isApprover = APPROVER_NAMES.includes(profile?.full_name ?? '');

  // Purchase orders list
  const { data: orders, isLoading } = useQuery({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('purchase_orders')
        .select('*, supplier:suppliers(name, email), destination_location:locations(name)')
        .order('created_at', { ascending: false });
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data } = await q;
      return data ?? [];
    },
  });

  // App-buying suppliers (only loaded when modal is open)
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-app-buying'],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers').select('id, name').eq('app_buying', true).order('name');
      return data ?? [];
    },
    enabled: showModal,
  });

  // Items for selected supplier
  const { data: supplierItems } = useQuery({
    queryKey: ['supplier-items-modal', poSupplierId],
    queryFn: async () => {
      const { data } = await supabase
        .from('supplier_items')
        .select('id, item_id, unit_price, package_size, items(name)')
        .eq('supplier_id', poSupplierId);
      return data ?? [];
    },
    enabled: !!poSupplierId && showModal,
  });

  // Locations
  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').order('name');
      return data ?? [];
    },
    enabled: showModal,
  });

  // Reset lines when supplier changes
  useEffect(() => {
    setPoLines([emptyLine()]);
  }, [poSupplierId]);

  function openModal() {
    setPoSupplierId('');
    setPoLocationId('');
    setPoLines([emptyLine()]);
    setSubmitError('');
    setShowModal(true);
  }

  function updateLine(lineId: string, patch: Partial<PoLine>) {
    setPoLines(prev => prev.map(l => l.id === lineId ? { ...l, ...patch } : l));
  }

  function selectItem(lineId: string, siId: string) {
    if (!siId) { updateLine(lineId, { siId: '', dbItemId: '', displayName: '', einheit: '', unitPrice: 0 }); return; }
    const si = supplierItems?.find(s => s.id === siId);
    if (!si) return;
    updateLine(lineId, {
      siId,
      dbItemId: (si as any).item_id ?? '',
      displayName: (si.items as any)?.name ?? '',
      einheit: (si as any).package_size ?? '',
      unitPrice: (si as any).unit_price ?? 0,
    });
  }

  const submitMut = useMutation({
    mutationFn: async () => {
      setSubmitError('');
      const { data: { user } } = await supabase.auth.getUser();
      const validLines = poLines.filter(l => l.siId && parseFloat(l.qty) > 0);
      if (!poSupplierId) throw new Error('Please select a supplier');
      if (!poLocationId) throw new Error('Please select a location');
      if (validLines.length === 0) throw new Error('Add at least one item with a quantity');

      const poNumber = generatePoNumber();
      const { data: po, error: poErr } = await supabase
        .from('purchase_orders')
        .insert({
          po_number: poNumber,
          supplier_id: poSupplierId,
          destination_location_id: poLocationId,
          ordered_by: user?.id ?? null,
          status: 'pending_approval',
          order_date: new Date().toISOString().slice(0, 10),
        })
        .select('id')
        .single();
      if (poErr) throw new Error(poErr.message);

      const lineInserts = validLines.map(l => ({
        po_id: po.id,
        supplier_product_id: null,
        item_id: l.dbItemId || null,
        display_name: l.displayName,
        einheit: l.einheit,
        quantity_ordered: parseFloat(l.qty),
        quantity_received: 0,
        unit_price: l.unitPrice,
        line_total: parseFloat(l.qty) * l.unitPrice,
      }));

      const { error: linesErr } = await supabase.from('purchase_order_lines').insert(lineInserts);
      if (linesErr) throw new Error(linesErr.message);
    },
    onSuccess: () => {
      setShowModal(false);
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: (e: Error) => setSubmitError(e.message),
  });

  const approveMut = useMutation({
    mutationFn: async (poId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/purchase-orders/${poId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? 'Approval failed');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
  });

  return (
    <div>
      {/* New PO Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">New Purchase Order</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Supplier */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                <select
                  value={poSupplierId}
                  onChange={e => setPoSupplierId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                >
                  <option value="">Select supplier…</option>
                  {suppliers?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              {/* Location */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Location</label>
                <select
                  value={poLocationId}
                  onChange={e => setPoLocationId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                >
                  <option value="">Select location…</option>
                  {locations?.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>

              {/* Items */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Items</label>
                <div className="space-y-2">
                  {poLines.map(line => (
                    <div key={line.id} className="flex items-center gap-2">
                      <select
                        value={line.siId}
                        onChange={e => selectItem(line.id, e.target.value)}
                        disabled={!poSupplierId}
                        className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700 disabled:bg-gray-50 disabled:text-gray-400"
                      >
                        <option value="">Select item…</option>
                        {supplierItems?.map(si => (
                          <option key={si.id} value={si.id}>
                            {(si.items as any)?.name ?? si.id}
                          </option>
                        ))}
                      </select>
                      <span className="text-xs text-gray-400 whitespace-nowrap w-28 text-right shrink-0">
                        {line.unitPrice > 0 ? `€${line.unitPrice.toFixed(2)} / ${line.einheit || 'unit'}` : line.einheit || ''}
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Qty"
                        value={line.qty}
                        onChange={e => updateLine(line.id, { qty: e.target.value })}
                        className="w-20 shrink-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                      />
                      {poLines.length > 1 && (
                        <button
                          onClick={() => setPoLines(prev => prev.filter(l => l.id !== line.id))}
                          className="shrink-0 text-red-400 hover:text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setPoLines(prev => [...prev, emptyLine()])}
                  className="mt-3 text-sm text-green-700 hover:text-green-900 font-medium flex items-center gap-1"
                >
                  <Plus size={14} /> Add another item
                </button>
              </div>

              {submitError && (
                <p className="text-sm text-red-600">{submitError}</p>
              )}
            </div>

            <div className="p-5 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => submitMut.mutate()}
                disabled={submitMut.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-[#1B5E20] rounded-lg hover:bg-[#2E7D32] disabled:opacity-50"
              >
                {submitMut.isPending ? 'Sending…' : 'Send for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('purchaseOrders.title')}</h1>
        <button
          onClick={openModal}
          className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          {t('purchaseOrders.newPO')}
        </button>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
            }`}
            style={statusFilter === s ? { backgroundColor: '#1B5E20' } : undefined}
          >
            {s === 'all' ? t('common.all') : s === 'pending_approval' ? 'Pending Approval' : t(`status.${s}`)}
          </button>
        ))}
      </div>

      {/* Orders table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(8)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : !orders || orders.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">{t('purchaseOrders.noOrders')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('purchaseOrders.table.poNumber')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('purchaseOrders.table.supplier')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('purchaseOrders.table.destination')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('purchaseOrders.table.orderDate')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('purchaseOrders.table.expected')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('purchaseOrders.table.status')}</th>
                  {isApprover && <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>}
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
                    <td className="px-4 py-3">
                      {po.status === 'pending_approval'
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Pending Approval</span>
                        : <StatusBadge status={po.status as string} />
                      }
                    </td>
                    {isApprover && (
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {po.status === 'pending_approval' && (
                          <button
                            onClick={() => approveMut.mutate(po.id as string)}
                            disabled={approveMut.isPending}
                            className="px-3 py-1 text-xs font-medium text-white bg-green-700 rounded-md hover:bg-green-800 disabled:opacity-50 whitespace-nowrap"
                          >
                            {approveMut.isPending ? '…' : 'Approve'}
                          </button>
                        )}
                      </td>
                    )}
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
