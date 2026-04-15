'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { ArrowLeft, Plus, X } from 'lucide-react';

interface LineItem {
  item_id: string;
  item_name: string;
  quantity_ordered: number;
  unit_price: number;
}

export default function NewPOPage() {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers').select('id, name').eq('is_active', true).order('name');
      return data ?? [];
    },
  });

  const { data: locations } = useQuery({
    queryKey: ['locations-list'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').order('name');
      return data ?? [];
    },
  });

  const { data: items } = useQuery({
    queryKey: ['items-purchasable'],
    queryFn: async () => {
      const { data } = await supabase.from('items').select('id, name, sku').eq('is_purchasable', true).eq('is_active', true).order('name');
      return data ?? [];
    },
  });

  const addLine = () => {
    setLines([...lines, { item_id: '', item_name: '', quantity_ordered: 1, unit_price: 0 }]);
  };

  const removeLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: keyof LineItem, value: string | number) => {
    const updated = [...lines];
    if (field === 'item_id') {
      const item = (items as { id: string; name: string }[] | null)?.find((i) => i.id === value);
      updated[idx] = { ...updated[idx], item_id: value as string, item_name: item?.name ?? '' };
    } else {
      updated[idx] = { ...updated[idx], [field]: value };
    }
    setLines(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || !locationId) {
      setError('Please select a supplier and destination location.');
      return;
    }
    setSaving(true);
    setError('');

    try {
      const user = (await supabase.auth.getUser()).data.user;
      const poNumber = `PO-${Date.now()}`;

      const { data: newPO, error: poError } = await supabase
        .from('purchase_orders')
        .insert({
          po_number: poNumber,
          supplier_id: supplierId,
          destination_location_id: locationId,
          ordered_by: user?.id ?? '',
          status: 'draft',
          order_date: new Date().toISOString().split('T')[0],
          expected_delivery_date: expectedDate || null,
          notes: notes || null,
        })
        .select()
        .single();

      if (poError) throw poError;

      if (lines.length > 0) {
        const lineInserts = lines
          .filter((l) => l.item_id)
          .map((l) => ({
            po_id: newPO.id,
            item_id: l.item_id,
            quantity_ordered: l.quantity_ordered,
            quantity_received: 0,
            unit_price: l.unit_price,
            line_total: l.quantity_ordered * l.unit_price,
            notes: null,
          }));

        if (lineInserts.length > 0) {
          const { error: lineError } = await supabase.from('purchase_order_lines').insert(lineInserts);
          if (lineError) throw lineError;
        }
      }

      router.push('/purchase-orders');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const total = lines.reduce((sum, l) => sum + l.quantity_ordered * l.unit_price, 0);

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">New Purchase Order</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Order details */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Order Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent"
              >
                <option value="">Select supplier...</option>
                {(suppliers as { id: string; name: string }[])?.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Destination Location *</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent"
              >
                <option value="">Select location...</option>
                {(locations as { id: string; name: string }[])?.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expected Delivery Date</label>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent"
                placeholder="Optional notes..."
              />
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Line Items</h2>
            <button
              type="button"
              onClick={addLine}
              className="flex items-center gap-1.5 text-sm font-medium hover:underline"
              style={{ color: '#1B5E20' }}
            >
              <Plus size={15} />
              Add Line
            </button>
          </div>

          {lines.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-6 border-2 border-dashed border-gray-200 rounded-lg">
              No lines added. Click "Add Line" to start.
            </div>
          ) : (
            <div className="space-y-3">
              {lines.map((line, idx) => (
                <div key={idx} className="flex gap-3 items-start">
                  <div className="flex-1">
                    <select
                      value={line.item_id}
                      onChange={(e) => updateLine(idx, 'item_id', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                    >
                      <option value="">Select item...</option>
                      {(items as { id: string; name: string; sku: string | null }[])?.map((i) => (
                        <option key={i.id} value={i.id}>{i.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28">
                    <input
                      type="number"
                      value={line.quantity_ordered}
                      onChange={(e) => updateLine(idx, 'quantity_ordered', parseFloat(e.target.value) || 0)}
                      placeholder="Qty"
                      min={0}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                    />
                  </div>
                  <div className="w-28">
                    <input
                      type="number"
                      value={line.unit_price}
                      onChange={(e) => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                      placeholder="Price"
                      min={0}
                      step={0.01}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                    />
                  </div>
                  <div className="w-24 py-2 text-sm text-right text-gray-700 font-medium">
                    €{(line.quantity_ordered * line.unit_price).toFixed(2)}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    className="text-gray-400 hover:text-red-500 mt-2 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}

              <div className="pt-3 border-t border-gray-100 flex justify-end">
                <div className="text-sm font-semibold text-gray-900">
                  Total: €{total.toFixed(2)}
                </div>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-[#1B5E20] text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Purchase Order'}
          </button>
        </div>
      </form>
    </div>
  );
}
