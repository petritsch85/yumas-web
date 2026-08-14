'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Check, X, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useState, useRef, useEffect } from 'react';

type Item = { id: string; name: string; sku: string | null };

type NewRow = {
  itemId: string;
  itemName: string;
  sku: string;
  unitPrice: string;
  packageSize: string;
  isPreferred: boolean;
};

const EMPTY_ROW: NewRow = {
  itemId: '', itemName: '', sku: '', unitPrice: '', packageSize: '', isPreferred: false,
};

export default function SupplierDetailPage() {
  const { t } = useT();
  const { id } = useParams<{ id: string }>() ?? {};
  const router = useRouter();
  const qc = useQueryClient();

  const [addingRow, setAddingRow] = useState(false);
  const [newRow, setNewRow] = useState<NewRow>(EMPTY_ROW);
  const [itemSearch, setItemSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const itemInputRef = useRef<HTMLInputElement>(null);

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers').select('*').eq('id', id).single();
      return data;
    },
  });

  const { data: supplierItems } = useQuery({
    queryKey: ['supplier-items-list', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('supplier_items')
        .select('*, item:items(id, name, sku, unit:units_of_measure(abbreviation))')
        .eq('supplier_id', id)
        .order('is_preferred', { ascending: false });
      return data ?? [];
    },
  });

  // All items for the autocomplete
  const { data: allItems = [] } = useQuery<Item[]>({
    queryKey: ['items-list'],
    queryFn: async () => {
      const { data } = await supabase.from('items').select('id, name, sku').order('name');
      return data ?? [];
    },
    staleTime: 60_000,
    enabled: addingRow,
  });

  const filteredItems = allItems.filter(it =>
    it.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    (it.sku ?? '').toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 10);

  const saveItem = useMutation({
    mutationFn: async (row: NewRow) => {
      const payload: Record<string, unknown> = {
        supplier_id:  id,
        unit_price:   parseFloat(row.unitPrice) || 0,
        package_size: row.packageSize || null,
        is_preferred: row.isPreferred,
      };
      if (row.itemId) {
        payload.item_id = row.itemId;
      } else {
        // Create a new item on the fly
        const { data: newItem, error } = await supabase
          .from('items')
          .insert({ name: row.itemName.trim(), sku: row.sku || null })
          .select('id')
          .single();
        if (error) throw error;
        payload.item_id = newItem.id;
      }
      const { error } = await supabase.from('supplier_items').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-items-list', id] });
      qc.invalidateQueries({ queryKey: ['supplier', id] });
      setAddingRow(false);
      setNewRow(EMPTY_ROW);
      setItemSearch('');
    },
  });

  const deleteItem = useMutation({
    mutationFn: async (siId: string) => {
      await supabase.from('supplier_items').delete().eq('id', siId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-items-list', id] });
    },
  });

  const handleSelectItem = (item: Item) => {
    setNewRow(r => ({ ...r, itemId: item.id, itemName: item.name, sku: item.sku ?? '' }));
    setItemSearch(item.name);
    setShowDropdown(false);
  };

  const handleStartAdd = () => {
    setAddingRow(true);
    setNewRow(EMPTY_ROW);
    setItemSearch('');
    setTimeout(() => itemInputRef.current?.focus(), 50);
  };

  const handleCancel = () => {
    setAddingRow(false);
    setNewRow(EMPTY_ROW);
    setItemSearch('');
  };

  const handleSave = () => {
    if (!newRow.itemName.trim() && !newRow.itemId) return;
    saveItem.mutate(newRow);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.item-search-wrapper')) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(2)].map((_, i) => <div key={i} className="h-40 bg-white rounded-lg animate-pulse" />)}
      </div>
    );
  }

  if (!supplier) return <div className="text-center text-gray-500 mt-12">Supplier not found</div>;

  const s = supplier as Record<string, unknown>;
  const items = supplierItems as Record<string, unknown>[];

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{s.name as string}</h1>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
            {s.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Supplier Information</h2>
          <dl className="space-y-3 text-sm">
            {[
              ['Contact Name', s.contact_name],
              ['Email', s.email],
              ['Phone', s.phone],
              ['Address', s.address],
              ['Payment Terms', s.payment_terms],
              ['App Buying', s.app_buying ? 'Yes' : 'No'],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between">
                <dt className="text-gray-500">{label as string}</dt>
                <dd className="text-gray-800 text-right max-w-64">{(value as string) ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-900">{items?.length ?? 0}</div>
            <div className="text-gray-500 text-sm mt-1">Items Supplied</div>
          </div>
        </div>
      </div>

      {/* Items supplied */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Items Supplied</h2>
          {!addingRow && (
            <button
              onClick={handleStartAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1B5E20] text-white text-xs font-medium rounded-lg hover:bg-[#2E7D32] transition-colors"
            >
              <Plus size={14} /> Add Item
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Package Size</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Preferred</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {/* Existing rows */}
              {items?.map((si, i) => {
                const item = si.item as Record<string, unknown> | null;
                return (
                  <tr key={i} className="border-t border-gray-100 hover:bg-gray-50 group">
                    <td className="px-4 py-3 font-medium text-gray-900">{item?.name as string ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{item?.sku as string ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-800">{formatCurrency(si.unit_price as number)}</td>
                    <td className="px-4 py-3 text-gray-600">{si.package_size as string ?? '—'}</td>
                    <td className="px-4 py-3">
                      {si.is_preferred ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Primary</span>
                      ) : (
                        <span className="text-gray-400 text-xs">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => deleteItem.mutate(si.id as string)}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {/* New item row */}
              {addingRow && (
                <tr className="border-t border-[#1B5E20]/30 bg-green-50/40">
                  {/* Item name with autocomplete */}
                  <td className="px-4 py-2">
                    <div className="relative item-search-wrapper">
                      <input
                        ref={itemInputRef}
                        value={itemSearch}
                        onChange={e => {
                          setItemSearch(e.target.value);
                          setNewRow(r => ({ ...r, itemName: e.target.value, itemId: '' }));
                          setShowDropdown(true);
                        }}
                        onFocus={() => setShowDropdown(true)}
                        placeholder="Search or type item name…"
                        className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#1B5E20] min-w-[180px]"
                      />
                      {showDropdown && filteredItems.length > 0 && (
                        <div className="absolute z-20 top-full left-0 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {filteredItems.map(it => (
                            <button
                              key={it.id}
                              type="button"
                              onMouseDown={() => handleSelectItem(it)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-green-50 flex items-center justify-between gap-2"
                            >
                              <span className="font-medium text-gray-900">{it.name}</span>
                              {it.sku && <span className="text-xs text-gray-400 font-mono">{it.sku}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  {/* SKU */}
                  <td className="px-4 py-2">
                    <input
                      value={newRow.sku}
                      onChange={e => setNewRow(r => ({ ...r, sku: e.target.value }))}
                      placeholder="SKU"
                      className="w-full border border-gray-200 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#1B5E20] max-w-[100px]"
                    />
                  </td>
                  {/* Unit price */}
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newRow.unitPrice}
                      onChange={e => setNewRow(r => ({ ...r, unitPrice: e.target.value }))}
                      placeholder="0.00"
                      className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-[#1B5E20] max-w-[90px] ml-auto block"
                    />
                  </td>
                  {/* Package size */}
                  <td className="px-4 py-2">
                    <input
                      value={newRow.packageSize}
                      onChange={e => setNewRow(r => ({ ...r, packageSize: e.target.value }))}
                      placeholder="e.g. 1"
                      className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#1B5E20] max-w-[80px]"
                    />
                  </td>
                  {/* Preferred */}
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setNewRow(r => ({ ...r, isPreferred: !r.isPreferred }))}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                        newRow.isPreferred ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {newRow.isPreferred ? 'Primary' : 'No'}
                    </button>
                  </td>
                  {/* Save / Cancel */}
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        onClick={handleSave}
                        disabled={saveItem.isPending || (!newRow.itemName.trim() && !newRow.itemId)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-[#1B5E20] text-white text-xs font-medium rounded hover:bg-[#2E7D32] disabled:opacity-50 transition-colors"
                      >
                        <Check size={12} /> Save
                      </button>
                      <button
                        onClick={handleCancel}
                        className="flex items-center gap-1 px-2.5 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded hover:bg-gray-200 transition-colors"
                      >
                        <X size={12} /> Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {/* Empty state */}
              {(!items || items.length === 0) && !addingRow && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-400 text-sm">
                    No items for this supplier. Click <strong>Add Item</strong> to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
