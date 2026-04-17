'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { ArrowLeft, Plus, Minus, Search } from 'lucide-react';

interface CartLine {
  supplier_product_id: string;
  display_name: string;
  einheit: string;
  qty: number;
  unit_price: string;
}

export default function NewPOPage() {
  const router = useRouter();
  const [supplierId, setSupplierId]   = useState('');
  const [locationId, setLocationId]   = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes]             = useState('');
  const [cart, setCart]               = useState<CartLine[]>([]);
  const [search, setSearch]           = useState('');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: async () => {
      const { data } = await supabase.from('suppliers').select('id, name').eq('is_active', true).order('name');
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const { data: locations } = useQuery({
    queryKey: ['locations-list'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').order('name');
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const { data: catalog } = useQuery({
    queryKey: ['supplier-products', supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data } = await supabase
        .from('supplier_products')
        .select('id, display_name, einheit, unit_price')
        .eq('supplier_id', supplierId)
        .eq('is_active', true)
        .order('display_name');
      return (data ?? []) as { id: string; display_name: string; einheit: string; unit_price: number | null }[];
    },
  });

  const addToCart = (product: { id: string; display_name: string; einheit: string; unit_price: number | null }) => {
    if (cart.find((l) => l.supplier_product_id === product.id)) return;
    setCart((prev) => [...prev, {
      supplier_product_id: product.id,
      display_name: product.display_name,
      einheit: product.einheit,
      qty: 1,
      unit_price: product.unit_price ? String(product.unit_price) : '',
    }]);
  };

  const removeFromCart = (id: string) =>
    setCart((prev) => prev.filter((l) => l.supplier_product_id !== id));

  const updateCart = (id: string, field: 'qty' | 'unit_price', value: string) =>
    setCart((prev) => prev.map((l) => l.supplier_product_id === id ? { ...l, [field]: value } : l));

  const filteredCatalog = (catalog ?? []).filter((p) =>
    p.display_name.toLowerCase().includes(search.toLowerCase())
  );

  const inCart = (id: string) => cart.some((l) => l.supplier_product_id === id);

  const total = cart.reduce((s, l) => s + l.qty * (parseFloat(l.unit_price) || 0), 0);

  const handleSave = async (submitForApproval: boolean) => {
    if (!supplierId || !locationId) { setError('Please select a supplier and location.'); return; }
    if (cart.length === 0)          { setError('Please add at least one product.'); return; }
    setSaving(true); setError('');

    try {
      const user   = (await supabase.auth.getUser()).data.user;
      const status = submitForApproval ? 'pending_approval' : 'draft';
      const poNum  = `PO-${Date.now()}`;

      const { data: po, error: poErr } = await supabase
        .from('purchase_orders')
        .insert({
          po_number: poNum, supplier_id: supplierId,
          destination_location_id: locationId, ordered_by: user?.id ?? '',
          status, order_date: new Date().toISOString().split('T')[0],
          expected_delivery_date: expectedDate || null, notes: notes || null,
        })
        .select().single();
      if (poErr) throw poErr;

      const lines = cart.map((l) => ({
        po_id               : po.id,
        supplier_product_id : l.supplier_product_id,
        display_name        : l.display_name,
        einheit             : l.einheit,
        item_id             : null,
        quantity_ordered    : l.qty,
        quantity_received   : 0,
        unit_price          : parseFloat(l.unit_price) || 0,
        line_total          : l.qty * (parseFloat(l.unit_price) || 0),
      }));

      const { error: lineErr } = await supabase.from('purchase_order_lines').insert(lines);
      if (lineErr) throw lineErr;

      router.push(`/purchase-orders/${po.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]';

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">New Purchase Order</h1>
      </div>

      <div className="space-y-5">

        {/* ── Order details ─────────────────────────────────── */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Order Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Supplier *</label>
              <select className={inputCls} value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setCart([]); setSearch(''); }}>
                <option value="">Select supplier…</option>
                {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Destination *</label>
              <select className={inputCls} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Select location…</option>
                {locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Expected Delivery</label>
              <input type="date" className={inputCls} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes</label>
              <input className={inputCls} placeholder="Optional…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── Supplier catalog ──────────────────────────────── */}
        {supplierId && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Product Catalog</h2>

            {/* Search */}
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className={`${inputCls} pl-8`}
                placeholder="Search products…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {!catalog || catalog.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No products configured for this supplier yet</p>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 max-h-72 overflow-y-auto pr-1">
                {filteredCatalog.map((p) => {
                  const added = inCart(p.id);
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-gray-900">{p.display_name}</span>
                        <span className="text-xs text-gray-400 ml-2">{p.einheit}</span>
                      </div>
                      {p.unit_price && (
                        <span className="text-xs text-gray-400">€{p.unit_price.toFixed(2)}</span>
                      )}
                      <button
                        onClick={() => added ? removeFromCart(p.id) : addToCart(p)}
                        className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                          added
                            ? 'bg-red-50 text-red-400 hover:bg-red-100'
                            : 'bg-green-50 text-[#1B5E20] hover:bg-green-100'
                        }`}
                      >
                        {added ? <Minus size={13} /> : <Plus size={13} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Order cart ────────────────────────────────────── */}
        {cart.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Order Lines — {cart.length} product{cart.length !== 1 ? 's' : ''}</h2>

            {/* Header row */}
            <div className="grid grid-cols-[1fr_80px_80px_80px_80px_32px] gap-2 mb-2 px-1">
              {['Product', 'Unit', 'Qty', '€ / Unit', 'Total', ''].map((h) => (
                <p key={h} className="text-xs font-semibold text-gray-400 uppercase">{h}</p>
              ))}
            </div>

            {cart.map((line) => (
              <div key={line.supplier_product_id} className="grid grid-cols-[1fr_80px_80px_80px_80px_32px] gap-2 mb-2 items-center">
                <span className="text-sm text-gray-900 truncate">{line.display_name}</span>
                <span className="text-xs text-gray-500">{line.einheit}</span>
                <input
                  type="number" min="1"
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
                  value={line.qty}
                  onChange={(e) => updateCart(line.supplier_product_id, 'qty', e.target.value)}
                />
                <input
                  type="number" min="0" step="0.01" placeholder="—"
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
                  value={line.unit_price}
                  onChange={(e) => updateCart(line.supplier_product_id, 'unit_price', e.target.value)}
                />
                <span className="text-sm text-right text-gray-700 font-medium">
                  {line.unit_price ? `€${(line.qty * parseFloat(line.unit_price)).toFixed(2)}` : '—'}
                </span>
                <button onClick={() => removeFromCart(line.supplier_product_id)} className="text-gray-300 hover:text-red-400">
                  <Minus size={14} />
                </button>
              </div>
            ))}

            <div className="border-t border-gray-100 mt-3 pt-3 flex justify-end">
              <span className="text-sm font-bold text-gray-900">
                Total: {total > 0 ? `€${total.toFixed(2)}` : '—'}
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>
        )}

        {/* ── Actions ───────────────────────────────────────── */}
        <div className="flex gap-3 justify-end">
          <button onClick={() => router.back()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Save as Draft
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="bg-[#1B5E20] text-white px-6 py-2 rounded-lg text-sm font-semibold hover:bg-[#2E7D32] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Submit for Approval →'}
          </button>
        </div>

      </div>
    </div>
  );
}
