'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Check, X, Trash2, Save, Pencil } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useState, useRef, useEffect } from 'react';

type Item = { id: string; name: string; sku: string | null };

type SupplierForm = {
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  payment_terms: string;
  app_buying: boolean;
};

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

  const [form, setForm] = useState<SupplierForm | null>(null);
  const [editing, setEditing] = useState(false);
  const [savedInfo, setSavedInfo] = useState(false);

  const [addingRow, setAddingRow] = useState(false);
  const [newRow, setNewRow] = useState<NewRow>(EMPTY_ROW);
  const [itemSearch, setItemSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const itemInputRef = useRef<HTMLInputElement>(null);

  // Inline row editing
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editRowDraft, setEditRowDraft] = useState<{ unitPrice: string; packageSize: string; isPreferred: boolean } | null>(null);

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers').select('*').eq('id', id).single();
      return data;
    },
  });

  // Sync form when supplier loads
  useEffect(() => {
    if (supplier && !form) {
      const s = supplier as Record<string, unknown>;
      setForm({
        contact_name:  (s.contact_name as string)  ?? '',
        email:         (s.email as string)          ?? '',
        phone:         (s.phone as string)          ?? '',
        address:       (s.address as string)        ?? '',
        payment_terms: (s.payment_terms as string)  ?? '',
        app_buying:    (s.app_buying as boolean)    ?? false,
      });
    }
  }, [supplier, form]);

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

  // Delivery locations
  const { data: allLocations = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').order('name');
      return data ?? [];
    },
  });

  const { data: supplierLocationIds = [], refetch: refetchSupplierLocations } = useQuery<string[]>({
    queryKey: ['supplier-locations', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('supplier_locations')
        .select('location_id')
        .eq('supplier_id', id);
      return (data ?? []).map((r: any) => r.location_id);
    },
    enabled: !!id,
  });

  const [locDraft, setLocDraft] = useState<string[] | null>(null);

  // Sync locDraft when supplier locations load or editing starts
  useEffect(() => {
    if (locDraft === null) {
      setLocDraft(supplierLocationIds);
    }
  }, [supplierLocationIds]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleLocation(locId: string) {
    setLocDraft(prev => {
      const cur = prev ?? supplierLocationIds;
      return cur.includes(locId) ? cur.filter(l => l !== locId) : [...cur, locId];
    });
  }

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

  const saveInfoMut = useMutation({
    mutationFn: async (f: SupplierForm) => {
      const { error } = await supabase.from('suppliers').update({
        contact_name:  f.contact_name  || null,
        email:         f.email         || null,
        phone:         f.phone         || null,
        address:       f.address       || null,
        payment_terms: f.payment_terms || null,
        app_buying:    f.app_buying,
      }).eq('id', id!);
      if (error) throw error;

      // Save delivery locations in the same operation
      await supabase.from('supplier_locations').delete().eq('supplier_id', id!);
      if (locDraft && locDraft.length > 0) {
        await supabase.from('supplier_locations').insert(
          locDraft.map(lid => ({ supplier_id: id!, location_id: lid }))
        );
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier', id] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['supplier-locations', id] });
      setEditing(false);
      setSavedInfo(true);
      setTimeout(() => setSavedInfo(false), 2000);
    },
  });

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
      setAddingRow(false);
      setNewRow(EMPTY_ROW);
      setItemSearch('');
    },
  });

  const deleteItem = useMutation({
    mutationFn: async (siId: string) => {
      await supabase.from('supplier_items').delete().eq('id', siId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-items-list', id] }),
  });

  const updateItem = useMutation({
    mutationFn: async ({ siId, draft }: { siId: string; draft: { unitPrice: string; packageSize: string; isPreferred: boolean } }) => {
      const { error } = await supabase.from('supplier_items').update({
        unit_price:   parseFloat(draft.unitPrice) || 0,
        package_size: draft.packageSize || null,
        is_preferred: draft.isPreferred,
      }).eq('id', siId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-items-list', id] });
      setEditingRowId(null);
      setEditRowDraft(null);
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

  const handleCancelRow = () => {
    setAddingRow(false);
    setNewRow(EMPTY_ROW);
    setItemSearch('');
  };

  const handleSaveRow = () => {
    if (!newRow.itemName.trim() && !newRow.itemId) return;
    saveItem.mutate(newRow);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.item-search-wrapper')) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (isLoading || !form) {
    return (
      <div className="space-y-4">
        {[...Array(2)].map((_, i) => <div key={i} className="h-40 bg-white rounded-lg animate-pulse" />)}
      </div>
    );
  }

  if (!supplier) return <div className="text-center text-gray-500 mt-12">Supplier not found</div>;

  const s = supplier as Record<string, unknown>;
  const items = supplierItems as Record<string, unknown>[];

  const setF = (k: keyof SupplierForm, v: string | boolean) =>
    setForm(f => f ? { ...f, [k]: v } : f);

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent';

  return (
    <div>
      {/* Header */}
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

      {/* Info card */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Supplier Information</h2>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-800 transition-colors"
            >
              Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  // reset form to saved values on cancel
                  const sv = supplier as Record<string, unknown>;
                  setForm({
                    contact_name:  (sv.contact_name as string)  ?? '',
                    email:         (sv.email as string)          ?? '',
                    phone:         (sv.phone as string)          ?? '',
                    address:       (sv.address as string)        ?? '',
                    payment_terms: (sv.payment_terms as string)  ?? '',
                    app_buying:    (sv.app_buying as boolean)    ?? false,
                  });
                  setEditing(false);
                }}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-500 hover:border-gray-400 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => form && saveInfoMut.mutate(form)}
                disabled={saveInfoMut.isPending}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  savedInfo
                    ? 'bg-green-600 text-white'
                    : 'bg-[#1B5E20] text-white hover:bg-[#2E7D32] disabled:opacity-60'
                }`}
              >
                {savedInfo ? <><Check size={14} /> Saved</> : <><Save size={14} /> Save</>}
              </button>
            </div>
          )}
        </div>

        {/* Read-only view */}
        {!editing && (
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            {([
              ['Contact Name', form?.contact_name],
              ['Email',        form?.email],
              ['Phone',        form?.phone],
              ['Address',      form?.address],
              ['Payment Terms',form?.payment_terms],
              ['App Buying',   form?.app_buying ? 'Yes' : 'No'],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</dt>
                <dd className="text-gray-800">{value || <span className="text-gray-300">—</span>}</dd>
              </div>
            ))}
            <div className="flex flex-col gap-0.5 md:col-span-2">
              <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">Delivery Locations</dt>
              <dd className="text-gray-800">
                {supplierLocationIds.length > 0
                  ? allLocations.filter(l => supplierLocationIds.includes(l.id)).map(l => l.name).join(', ')
                  : <span className="text-gray-300">—</span>
                }
              </dd>
            </div>
          </dl>
        )}

        {/* Edit form */}
        {editing && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {([
              ['contact_name', 'Contact Name', 'text'],
              ['email',        'Email',         'email'],
              ['phone',        'Phone',         'tel'],
              ['address',      'Address',       'text'],
              ['payment_terms','Payment Terms', 'text'],
            ] as [keyof SupplierForm, string, string][]).map(([key, label, type]) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                <input
                  type={type}
                  value={form![key] as string}
                  onChange={e => setF(key, e.target.value)}
                  placeholder={`Enter ${label.toLowerCase()}…`}
                  className={inputCls}
                />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">App Buying</label>
              <div className="flex items-center gap-3 mt-1">
                {(['Yes', 'No'] as const).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setF('app_buying', opt === 'Yes')}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      (opt === 'Yes') === form!.app_buying
                        ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-2">Delivery Locations</label>
              <div className="flex flex-wrap gap-2">
                {allLocations.map(loc => {
                  const checked = (locDraft ?? supplierLocationIds).includes(loc.id);
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => toggleLocation(loc.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        checked
                          ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      {checked && <Check size={13} />}
                      {loc.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Current Items and Prices */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Current Items and Prices</h2>
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
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items?.map((si, i) => {
                const item = si.item as Record<string, unknown> | null;
                const siId = si.id as string;
                const isEditingThis = editingRowId === siId;
                return isEditingThis && editRowDraft ? (
                  /* ── Inline edit row ── */
                  <tr key={i} className="border-t border-[#1B5E20]/30 bg-green-50/40">
                    <td className="px-4 py-2 font-medium text-gray-900">{item?.name as string ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{item?.sku as string ?? '—'}</td>
                    <td className="px-4 py-2">
                      <input
                        type="number" min="0" step="0.01"
                        value={editRowDraft.unitPrice}
                        onChange={e => setEditRowDraft(d => d ? { ...d, unitPrice: e.target.value } : d)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-[#1B5E20] max-w-[90px] ml-auto block"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={editRowDraft.packageSize}
                        onChange={e => setEditRowDraft(d => d ? { ...d, packageSize: e.target.value } : d)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#1B5E20] max-w-[80px]"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => setEditRowDraft(d => d ? { ...d, isPreferred: !d.isPreferred } : d)}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${editRowDraft.isPreferred ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {editRowDraft.isPreferred ? 'Primary' : 'No'}
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button
                          onClick={() => updateItem.mutate({ siId, draft: editRowDraft })}
                          disabled={updateItem.isPending}
                          className="flex items-center gap-1 px-2.5 py-1 bg-[#1B5E20] text-white text-xs font-medium rounded hover:bg-[#2E7D32] disabled:opacity-50 transition-colors"
                        >
                          <Check size={12} /> Save
                        </button>
                        <button
                          onClick={() => { setEditingRowId(null); setEditRowDraft(null); }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded hover:bg-gray-200 transition-colors"
                        >
                          <X size={12} /> Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  /* ── Read-only row ── */
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
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => {
                            setEditingRowId(siId);
                            setEditRowDraft({
                              unitPrice:   String(si.unit_price ?? ''),
                              packageSize: (si.package_size as string) ?? '',
                              isPreferred: (si.is_preferred as boolean) ?? false,
                            });
                          }}
                          className="text-gray-400 hover:text-[#1B5E20] transition-colors"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => deleteItem.mutate(siId)}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* New item row */}
              {addingRow && (
                <tr className="border-t border-[#1B5E20]/30 bg-green-50/40">
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
                            <button key={it.id} type="button" onMouseDown={() => handleSelectItem(it)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-green-50 flex items-center justify-between gap-2">
                              <span className="font-medium text-gray-900">{it.name}</span>
                              {it.sku && <span className="text-xs text-gray-400 font-mono">{it.sku}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <input value={newRow.sku} onChange={e => setNewRow(r => ({ ...r, sku: e.target.value }))}
                      placeholder="SKU"
                      className="w-full border border-gray-200 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#1B5E20] max-w-[100px]" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" min="0" step="0.01" value={newRow.unitPrice}
                      onChange={e => setNewRow(r => ({ ...r, unitPrice: e.target.value }))}
                      placeholder="0.00"
                      className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-[#1B5E20] max-w-[90px] ml-auto block" />
                  </td>
                  <td className="px-4 py-2">
                    <input value={newRow.packageSize} onChange={e => setNewRow(r => ({ ...r, packageSize: e.target.value }))}
                      placeholder="e.g. 1"
                      className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#1B5E20] max-w-[80px]" />
                  </td>
                  <td className="px-4 py-2">
                    <button type="button" onClick={() => setNewRow(r => ({ ...r, isPreferred: !r.isPreferred }))}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${newRow.isPreferred ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {newRow.isPreferred ? 'Primary' : 'No'}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button onClick={handleSaveRow} disabled={saveItem.isPending || (!newRow.itemName.trim() && !newRow.itemId)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-[#1B5E20] text-white text-xs font-medium rounded hover:bg-[#2E7D32] disabled:opacity-50 transition-colors">
                        <Check size={12} /> Save
                      </button>
                      <button onClick={handleCancelRow}
                        className="flex items-center gap-1 px-2.5 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded hover:bg-gray-200 transition-colors">
                        <X size={12} /> Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {(!items || items.length === 0) && !addingRow && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-400 text-sm">
                    No items yet. Click <strong>Add Item</strong> to get started.
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
