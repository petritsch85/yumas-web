'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'; // useMutation + useQueryClient used in UploadModal
import { supabase } from '@/lib/supabase-browser';
import { Upload, Download, Save, X, FileUp } from 'lucide-react';
import * as XLSX from 'xlsx';

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
// Self-contained: manages its own store tab, data fetching, and form state.
// form is keyed by store → item_id so switching tabs never loses unsaved data.
function UploadModal({ onClose }: { onClose: () => void }) {
  const [modalStore, setModalStore] = useState<Store>('Westend');
  // Accumulated edits across all store tabs: store → item_id → { lunch, dinner }
  const [form, setForm] = useState<Partial<Record<Store, Record<string, { lunch: string; dinner: string }>>>>({});
  const [seeded, setSeeded] = useState<Partial<Record<Store, boolean>>>({});
  const qc = useQueryClient();

  /* ── Items for current modal store ── */
  const { data: items = [], isLoading: loadingItems } = useQuery({
    queryKey: ['upload-items', modalStore],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, section, name, unit, sort_order, stores, store_sort_orders')
        .contains('stores', [modalStore]);
      if (error) throw error;
      return (data ?? []) as InventoryItem[];
    },
  });

  /* ── Existing standards for current modal store ── */
  const { data: standards = [] } = useQuery({
    queryKey: ['upload-standards', modalStore],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('usage_standards')
        .select('item_id, store, lunch_c, dinner_c')
        .eq('store', modalStore);
      if (error) throw error;
      return (data ?? []) as UsageStandard[];
    },
  });

  /* ── Seed form from DB on first visit to each store tab ── */
  useEffect(() => {
    if (seeded[modalStore]) return;
    const init: Record<string, { lunch: string; dinner: string }> = {};
    standards.forEach(s => {
      init[s.item_id] = {
        lunch: s.lunch_c ? String(s.lunch_c) : '',
        dinner: s.dinner_c ? String(s.dinner_c) : '',
      };
    });
    setForm(f => ({ ...f, [modalStore]: init }));
    setSeeded(s => ({ ...s, [modalStore]: true }));
  }, [standards, modalStore, seeded]);

  /* ── Save current store ── */
  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: async () => {
      const storeForm = form[modalStore] ?? {};
      const payload = items.map(item => ({
        item_id: item.id,
        store: modalStore,
        lunch_c: parseFloat(storeForm[item.id]?.lunch || '0') || 0,
        dinner_c: parseFloat(storeForm[item.id]?.dinner || '0') || 0,
      }));
      const { error } = await supabase
        .from('usage_standards')
        .upsert(payload, { onConflict: 'item_id,store' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['usage-standards'] });
      setSaveError(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  function setField(itemId: string, field: 'lunch' | 'dinner', value: string) {
    setForm(f => ({
      ...f,
      [modalStore]: {
        ...(f[modalStore] ?? {}),
        [itemId]: { ...(f[modalStore]?.[itemId] ?? { lunch: '', dinner: '' }), [field]: value },
      },
    }));
  }

  /* ── Download XLS ── */
  function handleDownload() {
    const storeForm = form[modalStore] ?? {};
    const sections = sortedSections(items);
    const rows: (string | number)[][] = [
      ['Section', 'Item', 'Unit', 'Lunch C', 'Dinner C', '_item_id'],
    ];
    sections.forEach(section => {
      const sectionItems = sortedItems(items.filter(i => i.section === section), modalStore);
      sectionItems.forEach(item => {
        rows.push([
          section,
          item.name,
          item.unit,
          parseFloat(storeForm[item.id]?.lunch || '0') || 0,
          parseFloat(storeForm[item.id]?.dinner || '0') || 0,
          item.id,
        ]);
      });
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Hide the _item_id column (col F) by setting width to 0
    ws['!cols'] = [
      { wch: 16 }, { wch: 28 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { hidden: true },
    ];
    XLSX.utils.book_append_sheet(wb, ws, modalStore);
    XLSX.writeFile(wb, `usage_${modalStore}_${new Date().toISOString().slice(0, 10)}.xls`, { bookType: 'xls' });
  }

  /* ── Upload XLS ── */
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws, { defval: '' });
        const newEntries: Record<string, { lunch: string; dinner: string }> = {};
        let matched = 0;
        rows.forEach(row => {
          const itemId = String(row['_item_id'] ?? '').trim();
          const lunchC = row['Lunch C'];
          const dinnerC = row['Dinner C'];
          if (!itemId) return;
          // Verify item belongs to current store
          const item = items.find(i => i.id === itemId);
          if (!item) return;
          matched++;
          newEntries[itemId] = {
            lunch: lunchC !== '' && lunchC !== undefined ? String(lunchC) : '',
            dinner: dinnerC !== '' && dinnerC !== undefined ? String(dinnerC) : '',
          };
        });
        if (matched === 0) {
          setUploadError('No matching items found. Make sure you are uploading the file downloaded for this store.');
          return;
        }
        setForm(f => ({ ...f, [modalStore]: { ...(f[modalStore] ?? {}), ...newEntries } }));
        setSeeded(s => ({ ...s, [modalStore]: true }));
      } catch {
        setUploadError('Could not read file. Please upload the .xls file downloaded from this page.');
      }
    };
    reader.readAsArrayBuffer(file);
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  }

  const storeForm = form[modalStore] ?? {};
  const sections = sortedSections(items);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Upload Standard Usage</h2>
            <p className="text-xs text-gray-400 mt-0.5">C = standard shift quantity per item</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Download */}
            <button
              onClick={handleDownload}
              disabled={loadingItems || items.length === 0}
              title="Download XLS for this store"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              <Download size={14} />
              Download
            </button>
            {/* Upload from file */}
            <button
              onClick={() => { setUploadError(null); fileInputRef.current?.click(); }}
              title="Upload XLS for this store"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <FileUp size={14} />
              Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx"
              className="hidden"
              onChange={handleFileChange}
            />
            <button onClick={onClose} className="ml-1 p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <X size={18} className="text-gray-500" />
            </button>
          </div>
        </div>

        {/* Upload error banner */}
        {uploadError && (
          <div className="mx-6 mt-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex-shrink-0">
            {uploadError}
          </div>
        )}

        {/* Store tabs */}
        <div className="flex gap-2 px-6 pt-3 pb-0 flex-shrink-0">
          {STORES.map(s => (
            <button
              key={s}
              onClick={() => { setModalStore(s); setUploadError(null); setSaveError(null); setSaveSuccess(false); }}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                modalStore === s
                  ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                  : 'bg-white text-[#1B5E20] border-[#1B5E20] hover:bg-[#1B5E20]/5'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_88px_88px] gap-x-3 px-6 py-2 mt-3 bg-gray-50 border-t border-b border-gray-100 flex-shrink-0">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</span>
          <span className="text-xs font-semibold text-[#1B5E20] uppercase tracking-wide text-center">Lunch C</span>
          <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide text-center">Dinner C</span>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-2">
          {loadingItems ? (
            <div className="py-10 text-center text-sm text-gray-400">Loading…</div>
          ) : (
            sections.map(section => {
              const sectionItems = sortedItems(items.filter(i => i.section === section), modalStore);
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
                        value={storeForm[item.id]?.lunch ?? ''}
                        placeholder="—"
                        onChange={e => setField(item.id, 'lunch', e.target.value)}
                        className="w-full text-center border border-gray-200 rounded-lg px-1 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
                      />
                      <input
                        type="number" min="0" step="0.5"
                        value={storeForm[item.id]?.dinner ?? ''}
                        placeholder="—"
                        onChange={e => setField(item.id, 'dinner', e.target.value)}
                        className="w-full text-center border border-gray-200 rounded-lg px-1 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                  ))}
                </React.Fragment>
              );
            })
          )}
        </div>

        {/* Save error / success banners */}
        {saveError && (
          <div className="mx-6 mb-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex-shrink-0">
            Save failed: {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="mx-6 mb-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex-shrink-0">
            Saved successfully ✓
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <span className="text-xs text-gray-400">Saving applies to <span className="font-semibold text-gray-600">{modalStore}</span> only</span>
          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              Close
            </button>
            <button onClick={() => save()} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-[#1B5E20] text-white text-sm font-semibold rounded-xl hover:bg-[#2E7D32] transition-colors disabled:opacity-60 shadow-sm">
              <Save size={15} />
              {saving ? 'Saving…' : `Save ${modalStore}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function UsageForecastPage() {
  const [activeStore, setActiveStore] = useState<Store>('Westend');
  const [showUpload, setShowUpload] = useState(false);

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
        <UploadModal onClose={() => setShowUpload(false)} />
      )}
    </div>
  );
}
