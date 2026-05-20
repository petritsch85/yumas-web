'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useT } from '@/lib/i18n';
import {
  Plus, Trash2, ChevronUp, ChevronDown,
  RotateCcw, Pencil, Check, X,
} from 'lucide-react';

/* ─── Constants ──────────────────────────────────────────────────────────────── */
const STORES = ['Eschborn', 'Taunus', 'Westend'] as const;
type Store = (typeof STORES)[number];

const SECTION_ORDER = ['Kühlhaus', 'Tiefkühler', 'Trockenware', 'Regale', 'Lager'];

const DAY_COLS = [
  { key: 'mon_target' as const, label: 'MON' },
  { key: 'tue_target' as const, label: 'TUE' },
  { key: 'wed_target' as const, label: 'WED' },
  { key: 'fri_target' as const, label: 'FRI' },
];

type DayKey = 'mon_target' | 'tue_target' | 'wed_target' | 'fri_target';

/* ─── Types ──────────────────────────────────────────────────────────────────── */
type InventoryItem = {
  id:         string;
  section:    string;
  name:       string;
  unit:       string;
  sort_order: number;
};

type TargetRow = {
  item_name:   string;
  mon_target:  number;
  tue_target:  number;
  wed_target:  number;
  fri_target:  number;
};

type LocalTarget = Record<DayKey, number>;

type AddForm = { section: string; name: string; unit: string };

/* ─── Add Item Modal ─────────────────────────────────────────────────────────── */
function AddItemModal({
  onClose,
  onSubmit,
  isPending,
}: {
  onClose:   () => void;
  onSubmit:  (form: AddForm) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState<AddForm>({ section: SECTION_ORDER[0], name: '', unit: '' });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.unit.trim()) return;
    onSubmit({ section: form.section, name: form.name.trim(), unit: form.unit.trim() });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Add New Item</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Section
            </label>
            <select
              value={form.section}
              onChange={e => setForm(f => ({ ...f, section: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20] bg-white"
            >
              {SECTION_ORDER.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Item Name
            </label>
            <input
              autoFocus
              type="text"
              placeholder="e.g. Jalapeños eingelegt"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Unit
            </label>
            <input
              type="text"
              placeholder="e.g. Beutel (1.0kg)"
              value={form.unit}
              onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20]"
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={!form.name.trim() || !form.unit.trim() || isPending}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#1B5E20] text-white text-sm font-semibold disabled:opacity-50 hover:bg-[#2E7D32] transition-colors"
            >
              <Plus size={15} />
              {isPending ? 'Adding…' : 'Add Item'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg bg-white text-gray-600 border border-gray-300 text-sm font-semibold hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────────── */
export default function InventoryListsPage() {
  useT();
  const qc = useQueryClient();

  const [activeStore,  setActiveStore]  = useState<Store>('Eschborn');
  const [editMode,     setEditMode]     = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // Local editable targets: item_name → {mon_target, tue_target, wed_target, fri_target}
  const [localTargets, setLocalTargets] = useState<Map<string, LocalTarget>>(new Map());

  /* ── Queries ─────────────────────────────────────────────────────────────── */
  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['inventory-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, section, name, unit, sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as InventoryItem[];
    },
  });

  const { data: targets = [], isLoading: targetsLoading } = useQuery({
    queryKey: ['inventory-lists-targets', activeStore],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('delivery_targets')
        .select('item_name, mon_target, tue_target, wed_target, fri_target')
        .eq('location_name', activeStore);
      if (error) throw error;
      return (data ?? []) as TargetRow[];
    },
  });

  const isLoading = itemsLoading || targetsLoading;

  /* ── Seed local targets when entering edit mode ──────────────────────────── */
  useEffect(() => {
    if (editMode) {
      const map = new Map<string, LocalTarget>();
      targets.forEach(t => {
        map.set(t.item_name, {
          mon_target: t.mon_target ?? 0,
          tue_target: t.tue_target ?? 0,
          wed_target: t.wed_target ?? 0,
          fri_target: t.fri_target ?? 0,
        });
      });
      setLocalTargets(map);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]); // only re-init when toggling edit mode, not on every targets refetch

  /* ── Derived data ────────────────────────────────────────────────────────── */
  const sections = useMemo(() => {
    const grouped = new Map<string, InventoryItem[]>(SECTION_ORDER.map(s => [s, []]));
    items.forEach(item => {
      if (!grouped.has(item.section)) grouped.set(item.section, []);
      grouped.get(item.section)!.push(item);
    });
    return SECTION_ORDER
      .map(title => ({ title, items: grouped.get(title) ?? [] }))
      .filter(s => s.items.length > 0);
  }, [items]);

  const targetMap = useMemo(
    () => new Map(targets.map(t => [t.item_name, t])),
    [targets],
  );

  /* ── Mutations ───────────────────────────────────────────────────────────── */
  const resetMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('delivery_targets')
        .delete()
        .eq('location_name', activeStore);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-lists-targets', activeStore] });
      setConfirmReset(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('inventory_items')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-items'] }),
  });

  const moveMutation = useMutation({
    mutationFn: async ({
      item, direction, sectionItems,
    }: { item: InventoryItem; direction: 'up' | 'down'; sectionItems: InventoryItem[] }) => {
      const idx     = sectionItems.findIndex(i => i.id === item.id);
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= sectionItems.length) return;
      const other = sectionItems[swapIdx];
      await Promise.all([
        supabase.from('inventory_items').update({ sort_order: other.sort_order }).eq('id', item.id),
        supabase.from('inventory_items').update({ sort_order: item.sort_order }).eq('id', other.id),
      ]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-items'] }),
  });

  const addMutation = useMutation({
    mutationFn: async ({ section, name, unit }: AddForm) => {
      const sectionItems = items.filter(i => i.section === section);
      const maxOrder     = sectionItems.length > 0
        ? Math.max(...sectionItems.map(i => i.sort_order))
        : 0;
      const { error } = await supabase
        .from('inventory_items')
        .insert({ section, name, unit, sort_order: maxOrder + 10 });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-items'] });
      setShowAddModal(false);
    },
  });

  // Upsert a single item's targets for the active store
  const saveTargetMutation = useMutation({
    mutationFn: async ({ itemName, unit, t }: { itemName: string; unit: string; t: LocalTarget }) => {
      const { error } = await supabase
        .from('delivery_targets')
        .upsert(
          {
            location_name: activeStore,
            item_name:     itemName,
            unit,
            mon_target:    t.mon_target,
            tue_target:    t.tue_target,
            wed_target:    t.wed_target,
            fri_target:    t.fri_target,
          },
          { onConflict: 'location_name,item_name' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-lists-targets', activeStore] }),
  });

  /* ── Target edit helpers ─────────────────────────────────────────────────── */
  function getLocalVal(itemName: string, key: DayKey): number {
    return localTargets.get(itemName)?.[key] ?? targetMap.get(itemName)?.[key] ?? 0;
  }

  const handleTargetChange = useCallback((itemName: string, key: DayKey, raw: string) => {
    const num = raw === '' ? 0 : Math.max(0, parseInt(raw, 10) || 0);
    setLocalTargets(prev => {
      const copy     = new Map(prev);
      const existing = copy.get(itemName) ?? { mon_target: 0, tue_target: 0, wed_target: 0, fri_target: 0 };
      copy.set(itemName, { ...existing, [key]: num });
      return copy;
    });
  }, []);

  const handleTargetBlur = useCallback((item: InventoryItem) => {
    const t = localTargets.get(item.name);
    if (t !== undefined) {
      saveTargetMutation.mutate({ itemName: item.name, unit: item.unit, t });
    }
  }, [localTargets, saveTargetMutation]);

  const colSpan = editMode ? 8 : 6;

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return (
    <div>

      {showAddModal && (
        <AddItemModal
          onClose={() => setShowAddModal(false)}
          onSubmit={form => addMutation.mutate(form)}
          isPending={addMutation.isPending}
        />
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Lists</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {items.length} items · standard delivery targets per store
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {STORES.map(store => (
            <button
              key={store}
              onClick={() => setActiveStore(store)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors whitespace-nowrap ${
                activeStore === store
                  ? 'bg-[#1B5E20] text-white border-[#1B5E20] shadow-sm'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-[#1B5E20] hover:text-[#1B5E20]'
              }`}
            >
              {store}
            </button>
          ))}

          <span className="w-px h-6 bg-gray-200" />

          {editMode && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold bg-[#1B5E20] text-white border border-[#1B5E20] hover:bg-[#2E7D32] transition-colors shadow-sm"
            >
              <Plus size={15} />
              Add Item
            </button>
          )}

          {!editMode && (
            confirmReset ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-red-600 font-medium whitespace-nowrap">
                  Reset all targets for {activeStore}?
                </span>
                <button
                  onClick={() => resetMutation.mutate()}
                  disabled={resetMutation.isPending}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white border border-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {resetMutation.isPending ? 'Resetting…' : 'Confirm'}
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-gray-600 border border-gray-300 hover:border-gray-400 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmReset(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-white text-red-600 border border-red-300 hover:bg-red-50 transition-colors"
              >
                <RotateCcw size={14} />
                Reset
              </button>
            )
          )}

          <button
            onClick={() => { setEditMode(e => !e); setConfirmReset(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
              editMode
                ? 'bg-white text-[#1B5E20] border-[#1B5E20]'
                : 'bg-white text-gray-600 border-gray-300 hover:border-[#1B5E20] hover:text-[#1B5E20]'
            }`}
          >
            {editMode
              ? <><Check size={14} /> Done</>
              : <><Pencil size={14} /> Edit</>
            }
          </button>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {editMode && <th className="px-2 py-3 w-20" />}
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide min-w-[220px]">
                  Item
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide min-w-[140px]">
                  Unit
                </th>
                {DAY_COLS.map(d => (
                  <th key={d.key} className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide min-w-[72px]">
                    {d.label}
                  </th>
                ))}
                {editMode && <th className="px-2 py-3 w-10" />}
              </tr>
            </thead>

            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-12 text-center">
                    <div className="flex justify-center gap-2">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
                      ))}
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-gray-400">
                    No items found. Run{' '}
                    <code className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">
                      supabase/create_inventory_items.sql
                    </code>{' '}
                    in the Supabase SQL Editor first.
                  </td>
                </tr>
              ) : (
                sections.map(section => (
                  <React.Fragment key={section.title}>

                    <tr className="bg-[#F1F8E9] border-y border-green-100">
                      <td colSpan={colSpan} className="px-4 py-2 text-xs font-bold text-[#2E7D32] uppercase tracking-wider">
                        {section.title}
                      </td>
                    </tr>

                    {section.items.map((item, idx) => {
                      const target  = targetMap.get(item.name);
                      const isEven  = idx % 2 === 0;
                      const isFirst = idx === 0;
                      const isLast  = idx === section.items.length - 1;
                      return (
                        <tr
                          key={item.id}
                          className={`border-b border-gray-50 ${isEven ? 'bg-white' : 'bg-gray-50/40'}`}
                        >
                          {/* Move up/down */}
                          {editMode && (
                            <td className="px-2 py-1.5">
                              <div className="flex items-center justify-center gap-0.5">
                                <button
                                  disabled={isFirst || moveMutation.isPending}
                                  onClick={() => moveMutation.mutate({ item, direction: 'up', sectionItems: section.items })}
                                  className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                                >
                                  <ChevronUp size={14} />
                                </button>
                                <button
                                  disabled={isLast || moveMutation.isPending}
                                  onClick={() => moveMutation.mutate({ item, direction: 'down', sectionItems: section.items })}
                                  className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                                >
                                  <ChevronDown size={14} />
                                </button>
                              </div>
                            </td>
                          )}

                          <td className="px-4 py-2.5 font-medium text-gray-800">{item.name}</td>
                          <td className="px-4 py-2.5 text-xs text-gray-400">{item.unit}</td>

                          {/* Day target cells */}
                          {DAY_COLS.map(d => (
                            <td key={d.key} className="px-2 py-1.5 text-center tabular-nums">
                              {editMode ? (
                                <input
                                  type="number"
                                  min="0"
                                  value={getLocalVal(item.name, d.key) || ''}
                                  placeholder="—"
                                  onChange={e => handleTargetChange(item.name, d.key, e.target.value)}
                                  onBlur={() => handleTargetBlur(item)}
                                  className="w-14 text-center border border-gray-200 rounded-md px-1 py-1 text-sm font-semibold text-[#2E7D32] bg-white focus:outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20] tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                              ) : (
                                (target?.[d.key] == null || target[d.key] === 0)
                                  ? <span className="text-gray-300">—</span>
                                  : <span className="font-semibold text-[#2E7D32]">{target[d.key]}</span>
                              )}
                            </td>
                          ))}

                          {/* Delete */}
                          {editMode && (
                            <td className="px-2 py-1.5 text-center">
                              <button
                                onClick={() => deleteMutation.mutate(item.id)}
                                disabled={deleteMutation.isPending}
                                className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}

                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!isLoading && items.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-xs text-gray-400">
              {editMode
                ? 'Click any number to edit it — changes save automatically when you leave the field.'
                : 'Standard targets are set here. Items with no targets show —.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
