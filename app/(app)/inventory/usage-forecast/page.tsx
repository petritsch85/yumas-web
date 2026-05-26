'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { Upload, Save, X } from 'lucide-react';

/* ─── Constants ──────────────────────────────────────────────────────────── */
const STORES = ['Westend', 'Eschborn', 'Taunus'] as const;
type Store = (typeof STORES)[number];

const SECTION_ORDER = ['Kühlhaus', 'Tiefkühler', 'Trockenware', 'Regale', 'Lager'];
const SHIFT_KEYS = ['A', 'B', 'C', 'D', 'E'] as const;
type ShiftKey = (typeof SHIFT_KEYS)[number];

const MULTIPLIERS: Record<ShiftKey, number> = { A: 0.5, B: 0.75, C: 1, D: 1.25, E: 1.5 };

/* ─── Types ──────────────────────────────────────────────────────────────── */
type InventoryItem = {
  id: string;
  section: string;
  name: string;
  unit: string;
  sort_order: number;
  stores: string[];
  store_sort_orders: Record<string, number> | null;
};

type UsageStandard = {
  item_id: string;
  store: string;
  lunch_c: number;
  dinner_c: number;
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function compute(c: number, key: ShiftKey): number {
  return Math.round(c * MULTIPLIERS[key] * 10) / 10;
}

function fmt(val: number): string {
  return val % 1 === 0 ? String(val) : val.toFixed(1);
}

function sortedSections(items: InventoryItem[]): string[] {
  const seen = new Set(items.map(i => i.section));
  const known = SECTION_ORDER.filter(s => seen.has(s));
  const rest = [...seen].filter(s => !SECTION_ORDER.includes(s)).sort();
  return [...known, ...rest];
}

function sortedItems(items: InventoryItem[], store: Store): InventoryItem[] {
  return [...items].sort((a, b) => {
    const ao = a.store_sort_orders?.[store] ?? a.sort_order;
    const bo = b.store_sort_orders?.[store] ?? b.sort_order;
    return ao - bo;
  });
}

/* ─── Upload Standard Usage Modal ───────────────────────────────────────── */
function UploadModal({
  items,
  store,
  standards,
  onClose,
  onSave,
  saving,
}: {
  items: InventoryItem[];
  store: Store;
  standards: UsageStandard[];
  onClose: () => void;
  onSave: (rows: { item_id: string; lunch_c: number; dinner_c: number }[]) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Record<string, { lunch: string; dinner: string }>>(() => {
    const init: Record<string, { lunch: string; dinner: string }> = {};
    items.forEach(item => {
      const std = standards.find(s => s.item_id === item.id);
      init[item.id] = {
        lunch: std?.lunch_c ? String(std.lunch_c) : '',
        dinner: std?.dinner_c ? String(std.dinner_c) : '',
      };
    });
    return init;
  });

  const sections = sortedSections(items);

  function handleSave() {
    const rows = items.map(item => ({
      item_id: item.id,
      lunch_c: parseFloat(form[item.id]?.lunch || '0') || 0,
      dinner_c: parseFloat(form[item.id]?.dinner || '0') || 0,
    }));
    onSave(rows);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Upload Standard Usage</h2>
            <p className="text-xs text-gray-400 mt-0.5">{store} — enter usage per shift (C = standard shift)</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_88px_88px] gap-x-3 px-6 py-2 bg-gray-50 border-b border-gray-100 flex-shrink-0">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</span>
          <span className="text-xs font-semibold text-[#1B5E20] uppercase tracking-wide text-center">Lunch C</span>
          <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide text-center">Dinner C</span>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-2">
          {sections.map(section => {
            const sectionItems = sortedItems(items.filter(i => i.section === section), store);
            if (sectionItems.length === 0) return null;
            return (
              <React.Fragment key={section}>
                <div className="pt-3 pb-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                  {section}
                </div>
                {sectionItems.map(item => (
                  <div key={item.id} className="grid grid-cols-[1fr_88px_88px] gap-x-3 py-1.5 items-center border-b border-gray-50">
                    <div>
                      <span className="text-sm text-gray-800">{item.name}</span>
                      <span className="text-xs text-gray-400 ml-1.5">{item.unit}</span>
                    </div>
                    <input
                      type="number" min="0" step="0.5"
                      value={form[item.id]?.lunch ?? ''}
                      placeholder="—"
                      onChange={e => setForm(f => ({ ...f, [item.id]: { ...f[item.id], lunch: e.target.value } }))}
                      className="w-full text-center border border-gray-200 rounded-lg px-1 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
                    />
                    <input
                      type="number" min="0" step="0.5"
                      value={form[item.id]?.dinner ?? ''}
                      placeholder="—"
                      onChange={e => setForm(f => ({ ...f, [item.id]: { ...f[item.id], dinner: e.target.value } }))}
                      className="w-full text-center border border-gray-200 rounded-lg px-1 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                ))}
              </React.Fragment>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-[#1B5E20] text-white text-sm font-semibold rounded-xl hover:bg-[#2E7D32] transition-colors disabled:opacity-60 shadow-sm">
            <Save size={15} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function UsageForecastPage() {
  const [activeStore, setActiveStore] = useState<Store>('Westend');
  const [showUpload, setShowUpload] = useState(false);
  const qc = useQueryClient();

  /* ── Data ── */
  const { data: items = [], isLoading: loadingItems } = useQuery({
    queryKey: ['usage-forecast-items', activeStore],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, section, name, unit, sort_order, stores, store_sort_orders')
        .contains('stores', [activeStore]);
      if (error) throw error;
      return (data ?? []) as InventoryItem[];
    },
  });

  const { data: standards = [], isLoading: loadingStandards } = useQuery({
    queryKey: ['usage-standards', activeStore],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('usage_standards')
        .select('item_id, store, lunch_c, dinner_c')
        .eq('store', activeStore);
      if (error) throw error;
      return (data ?? []) as UsageStandard[];
    },
  });

  const { mutate: saveStandards, isPending: saving } = useMutation({
    mutationFn: async (rows: { item_id: string; lunch_c: number; dinner_c: number }[]) => {
      const payload = rows.map(r => ({
        item_id: r.item_id,
        store: activeStore,
        lunch_c: r.lunch_c,
        dinner_c: r.dinner_c,
      }));
      const { error } = await supabase
        .from('usage_standards')
        .upsert(payload, { onConflict: 'item_id,store' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['usage-standards', activeStore] });
      setShowUpload(false);
    },
  });

  /* ── Derived ── */
  const standardsMap = useMemo(() => {
    const map: Record<string, UsageStandard> = {};
    standards.forEach(s => { map[s.item_id] = s; });
    return map;
  }, [standards]);

  const sections = useMemo(() => sortedSections(items), [items]);

  const loading = loadingItems || loadingStandards;

  /* ── Render ── */
  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">Usage Forecast</h1>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-semibold rounded-xl hover:bg-[#2E7D32] transition-colors shadow-sm"
        >
          <Upload size={15} />
          Upload Standard Usage
        </button>
      </div>

      {/* Store tabs */}
      <div className="flex gap-2 flex-wrap">
        {STORES.map(store => (
          <button
            key={store}
            onClick={() => setActiveStore(store)}
            className={`px-5 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              activeStore === store
                ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                : 'bg-white text-[#1B5E20] border-[#1B5E20] hover:bg-[#1B5E20]/5'
            }`}
          >
            {store}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <table className="w-full min-w-[860px] text-sm border-collapse">
            <thead>
              {/* Group row */}
              <tr>
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide sticky left-0 bg-white z-10 border-b border-gray-100"
                  rowSpan={2}
                >
                  Item
                </th>
                <th
                  className="px-2 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide w-14 border-b border-gray-100"
                  rowSpan={2}
                >
                  Unit
                </th>
                <th
                  colSpan={5}
                  className="px-3 py-2.5 text-center text-xs font-bold text-[#1B5E20] uppercase tracking-wide border-l border-gray-100 border-b border-gray-100"
                >
                  Lunch
                </th>
                <th
                  colSpan={5}
                  className="px-3 py-2.5 text-center text-xs font-bold text-blue-600 uppercase tracking-wide border-l border-gray-100 border-b border-gray-100"
                >
                  Dinner
                </th>
              </tr>
              {/* Column label row */}
              <tr className="border-b border-gray-100">
                {SHIFT_KEYS.map((col, i) => (
                  <th
                    key={`lh-${col}`}
                    className={`py-2 text-center text-xs font-bold uppercase tracking-wide w-16 ${
                      col === 'C'
                        ? 'bg-[#1B5E20]/5 text-[#1B5E20]'
                        : 'text-gray-400'
                    } ${i === 0 ? 'border-l border-gray-100' : ''}`}
                  >
                    {col}
                  </th>
                ))}
                {SHIFT_KEYS.map((col, i) => (
                  <th
                    key={`dh-${col}`}
                    className={`py-2 text-center text-xs font-bold uppercase tracking-wide w-16 ${
                      col === 'C'
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-gray-400'
                    } ${i === 0 ? 'border-l border-gray-100' : ''}`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map(section => {
                const sectionItems = sortedItems(
                  items.filter(i => i.section === section),
                  activeStore,
                );
                if (sectionItems.length === 0) return null;
                return (
                  <React.Fragment key={section}>
                    <tr className="bg-gray-50">
                      <td
                        colSpan={12}
                        className="px-4 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider"
                      >
                        {section}
                      </td>
                    </tr>
                    {sectionItems.map(item => {
                      const std = standardsMap[item.id];
                      const lc = std?.lunch_c ?? 0;
                      const dc = std?.dinner_c ?? 0;
                      return (
                        <tr
                          key={item.id}
                          className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors"
                        >
                          <td className="px-4 py-2.5 text-sm text-gray-800 font-medium sticky left-0 bg-white">
                            {item.name}
                          </td>
                          <td className="px-2 py-2.5 text-xs text-gray-400 text-center">
                            {item.unit}
                          </td>

                          {/* Lunch columns */}
                          {SHIFT_KEYS.map((col, i) => {
                            const val = compute(lc, col);
                            return (
                              <td
                                key={`l-${col}`}
                                className={`py-2.5 text-center tabular-nums text-sm ${
                                  col === 'C'
                                    ? 'bg-[#1B5E20]/5 font-bold text-[#1B5E20]'
                                    : 'text-gray-600'
                                } ${i === 0 ? 'border-l border-gray-100' : ''}`}
                              >
                                {lc === 0
                                  ? <span className="text-gray-200 select-none">—</span>
                                  : fmt(val)
                                }
                              </td>
                            );
                          })}

                          {/* Dinner columns */}
                          {SHIFT_KEYS.map((col, i) => {
                            const val = compute(dc, col);
                            return (
                              <td
                                key={`d-${col}`}
                                className={`py-2.5 text-center tabular-nums text-sm ${
                                  col === 'C'
                                    ? 'bg-blue-50 font-bold text-blue-600'
                                    : 'text-gray-600'
                                } ${i === 0 ? 'border-l border-gray-100' : ''}`}
                              >
                                {dc === 0
                                  ? <span className="text-gray-200 select-none">—</span>
                                  : fmt(val)
                                }
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}

              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-16 text-center text-gray-400 text-sm">
                    No items found for {activeStore}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Upload modal */}
      {showUpload && (
        <UploadModal
          items={items}
          store={activeStore}
          standards={standards}
          onClose={() => setShowUpload(false)}
          onSave={saveStandards}
          saving={saving}
        />
      )}
    </div>
  );
}
