'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useT } from '@/lib/i18n';
import {
  Plus, Trash2, ChevronUp, ChevronDown,
  RotateCcw, Pencil, Check, X,
} from 'lucide-react';

/* ─── Constants ──────────────────────────────────────────────────────────────── */
const STORES = ['Eschborn', 'Taunus', 'Westend', 'ZK'] as const;
type Store = (typeof STORES)[number];

const SECTION_ORDER = ['Kühlhaus', 'Tiefkühler', 'Trockenware', 'Regale', 'Lager'];

const DAY_COLS = [
  { key: 'mon' as const, label: 'MON' },
  { key: 'tue' as const, label: 'TUE' },
  { key: 'wed' as const, label: 'WED' },
  { key: 'fri' as const, label: 'FRI' },
];

type DayKey = 'mon' | 'tue' | 'wed' | 'fri';

/* ─── Types ──────────────────────────────────────────────────────────────────── */
type InventoryItem = {
  id:                 string;
  section:            string;
  name:               string;
  unit:               string;
  sort_order:         number;
  stores:             string[];
  store_sort_orders:  Record<string, number>;
  store_targets:      Record<string, Record<string, number>> | null;
};

type LocalTarget = Record<DayKey, number>;

type AddForm = { section: string; name: string; unit: string; stores: string[] };

type InventorySection = {
  id:         string;
  name:       string;
  stores:     string[];
  sort_order: number;
};

const LOCK_PAGE_KEY     = 'inventory-lists';
const LOCK_RENEW_MS     = 2.5 * 60 * 1000; // renew every 2.5 min
const LOCK_POLL_MS      = 15  * 1000;       // re-check lock every 15 s (view mode)

type LockInfo = { locked_by_name: string; locked_at: string } | null;

/* ─── Add Item Modal ─────────────────────────────────────────────────────────── */
function AddItemModal({
  onClose,
  onSubmit,
  isPending,
  sections,
}: {
  onClose:   () => void;
  onSubmit:  (form: AddForm) => void;
  isPending: boolean;
  sections:  string[];
}) {
  const ALL_STORES = [...STORES] as string[];
  const [form, setForm] = useState<AddForm>({
    section: sections[0] ?? SECTION_ORDER[0], name: '', unit: '', stores: ALL_STORES,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.unit.trim()) return;
    onSubmit({ section: form.section, name: form.name.trim(), unit: form.unit.trim(), stores: form.stores });
  }

  const storeValue = form.stores.length === STORES.length ? 'all'
    : form.stores.length === 1 ? form.stores[0]
    : 'all';

  function handleStoreChange(val: string) {
    setForm(f => ({ ...f, stores: val === 'all' ? ALL_STORES : [val] }));
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

          {/* Section */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Section
            </label>
            <select
              value={form.section}
              onChange={e => setForm(f => ({ ...f, section: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20] bg-white"
            >
              {sections.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Item name */}
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

          {/* Unit */}
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

          {/* Store scope */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Add to
            </label>
            <div className="flex gap-2">
              {(['all', ...STORES] as const).map(opt => {
                const label = opt === 'all' ? 'All Stores' : opt;
                const active = storeValue === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleStoreChange(opt)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      active
                        ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-[#1B5E20] hover:text-[#1B5E20]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
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

/* ─── Add Section Modal ──────────────────────────────────────────────────────── */
function AddSectionModal({
  onClose,
  onSubmit,
  isPending,
}: {
  onClose:   () => void;
  onSubmit:  (name: string, stores: string[]) => void;
  isPending: boolean;
}) {
  const ALL_STORES = [...STORES] as string[];
  const [name,   setName]   = useState('');
  const [stores, setStores] = useState<string[]>(ALL_STORES);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim(), stores);
  }

  const storeValue = stores.length === STORES.length ? 'all' : stores.length === 1 ? stores[0] : 'all';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Add New Section</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

          {/* Section name */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Section Name
            </label>
            <input
              autoFocus
              type="text"
              placeholder="e.g. Spezialitäten"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20]"
            />
          </div>

          {/* Store scope */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Add to
            </label>
            <div className="flex gap-2">
              {(['all', ...STORES] as const).map(opt => {
                const label  = opt === 'all' ? 'All Stores' : opt;
                const active = storeValue === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setStores(opt === 'all' ? ALL_STORES : [opt])}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      active
                        ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-[#1B5E20] hover:text-[#1B5E20]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={!name.trim() || isPending}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#1B5E20] text-white text-sm font-semibold disabled:opacity-50 hover:bg-[#2E7D32] transition-colors"
            >
              <Plus size={15} />
              {isPending ? 'Adding…' : 'Add Section'}
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

  const [activeStore,         setActiveStore]         = useState<Store>('Eschborn');
  const [editMode,            setEditMode]            = useState(false);
  const [confirmReset,        setConfirmReset]        = useState(false);
  const [showAddModal,          setShowAddModal]          = useState(false);
  const [showAddSectionModal,   setShowAddSectionModal]   = useState(false);
  const [confirmDeleteSection,  setConfirmDeleteSection]  = useState<string | null>(null);
  const [renamingSection,       setRenamingSection]       = useState<string | null>(null);
  const [renameValue,           setRenameValue]           = useState('');

  // Local editable targets: item_name → {mon_target, tue_target, wed_target, fri_target}
  const [localTargets, setLocalTargets] = useState<Map<string, LocalTarget>>(new Map());

  // Local editable units: item id → unit string
  const [localUnits, setLocalUnits] = useState<Map<string, string>>(new Map());
  const localUnitsRef = useRef(localUnits);
  useEffect(() => { localUnitsRef.current = localUnits; }, [localUnits]);

  // ── Edit lock ──────────────────────────────────────────────────────────────
  const [currentUser,  setCurrentUser]  = useState<{ id: string; name: string } | null>(null);
  const [activeLock,   setActiveLock]   = useState<LockInfo>(null); // lock held by someone ELSE
  const iOwnLock = useRef(false);   // true while this tab holds the lock
  const renewTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Queries ─────────────────────────────────────────────────────────────── */
  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['inventory-items', activeStore],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, section, name, unit, sort_order, stores, store_sort_orders, store_targets')
        .contains('stores', [activeStore])
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as InventoryItem[];
    },
  });

  const { data: dbSections = [] } = useQuery({
    queryKey: ['inventory-sections', activeStore],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_sections')
        .select('id, name, stores, sort_order')
        .contains('stores', [activeStore])
        .order('sort_order', { ascending: true });
      if (error) {
        // Table may not exist yet — fall back gracefully
        console.warn('inventory_sections query failed, using hardcoded defaults', error.message);
        return [] as InventorySection[];
      }
      return (data ?? []) as InventorySection[];
    },
  });

  const isLoading = itemsLoading;

  /* ── Fetch current user profile ─────────────────────────────────────────── */
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from('profiles')
        .select('id, full_name')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          setCurrentUser({
            id:   user.id,
            name: data?.full_name ?? user.email?.split('@')[0] ?? 'Someone',
          });
        });
    });
  }, []);

  /* ── Poll lock status (view mode, every 15 s) ────────────────────────────── */
  useEffect(() => {
    if (editMode) return; // don't poll while we own the lock
    async function checkLock() {
      const { data } = await supabase
        .from('editing_locks')
        .select('locked_by, locked_by_name, locked_at, expires_at')
        .eq('page_key', LOCK_PAGE_KEY)
        .single();
      if (
        data &&
        new Date(data.expires_at) > new Date() &&
        data.locked_by !== currentUser?.id
      ) {
        setActiveLock({ locked_by_name: data.locked_by_name, locked_at: data.locked_at });
      } else {
        setActiveLock(null);
      }
    }
    checkLock();
    const id = setInterval(checkLock, LOCK_POLL_MS);
    return () => clearInterval(id);
  }, [editMode, currentUser]);

  /* ── Keepalive: renew lock every 2.5 min while editing ───────────────────── */
  useEffect(() => {
    if (!editMode || !currentUser) return;
    renewTimer.current = setInterval(() => {
      supabase.rpc('renew_edit_lock', {
        p_page_key: LOCK_PAGE_KEY,
        p_user_id:  currentUser.id,
      });
    }, LOCK_RENEW_MS);
    return () => {
      if (renewTimer.current) clearInterval(renewTimer.current);
    };
  }, [editMode, currentUser]);

  /* ── Release lock on component unmount ──────────────────────────────────── */
  useEffect(() => {
    return () => {
      if (iOwnLock.current && currentUser) {
        supabase.rpc('release_edit_lock', {
          p_page_key: LOCK_PAGE_KEY,
          p_user_id:  currentUser.id,
        });
        iOwnLock.current = false;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  /* ── Seed local state when entering edit mode ───────────────────────────── */
  useEffect(() => {
    if (editMode) {
      // Targets — read from inventory_items.store_targets
      const tMap = new Map<string, LocalTarget>();
      items.forEach(item => {
        const st = item.store_targets?.[activeStore] ?? {};
        tMap.set(item.id, {
          mon: st.mon ?? 0,
          tue: st.tue ?? 0,
          wed: st.wed ?? 0,
          fri: st.fri ?? 0,
        });
      });
      setLocalTargets(tMap);

      // Units (keyed by item id)
      const uMap = new Map<string, string>();
      items.forEach(i => uMap.set(i.id, i.unit));
      setLocalUnits(uMap);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);

  /* ── Derived data ────────────────────────────────────────────────────────── */

  // Ordered list of section names: DB-backed if table exists, else hardcoded fallback
  const allSectionNames = useMemo(() => {
    const dbNames = dbSections.map(s => s.name);
    const base    = dbNames.length > 0 ? dbNames : SECTION_ORDER;
    // Also surface any sections present in items but not in the list (legacy data)
    const extra   = [...new Set(items.map(i => i.section))].filter(s => !base.includes(s));
    return [...base, ...extra];
  }, [dbSections, items]);

  const sections = useMemo(() => {
    return allSectionNames
      .map(title => {
        const sectionItems = items.filter(i => i.section === title).slice();
        sectionItems.sort((a, b) => {
          const aOrd = a.store_sort_orders?.[activeStore] ?? a.sort_order;
          const bOrd = b.store_sort_orders?.[activeStore] ?? b.sort_order;
          return aOrd - bOrd;
        });
        return { title, items: sectionItems };
      })
      // In edit mode show empty sections (newly created); in view mode hide them
      .filter(s => editMode || s.items.length > 0);
  }, [allSectionNames, items, activeStore, editMode]);

  /* ── Mutations ───────────────────────────────────────────────────────────── */
  const resetMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('clear_store_targets', { p_store: activeStore });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-items', activeStore] });
      setConfirmReset(false);
    },
  });

  // Remove item from the ACTIVE STORE only (other stores unaffected)
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('remove_item_from_store', {
        p_item_id:       id,
        p_location_name: activeStore,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-items'] as const }),
  });

  // Move item for the ACTIVE STORE only — rewrite all positions in the section
  // with clean sequential values so stores are fully independent of each other
  const moveMutation = useMutation({
    mutationFn: async ({
      item, direction, sectionItems,
    }: { item: InventoryItem; direction: 'up' | 'down'; sectionItems: InventoryItem[] }) => {
      const idx     = sectionItems.findIndex(i => i.id === item.id);
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= sectionItems.length) return;

      // Build the new order by swapping the two items
      const newOrder = [...sectionItems];
      [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];

      // Write fresh sequential sort orders for every item in this section
      // for the active store only — never touches other stores' values
      const { error } = await Promise.all(
        newOrder.map((si, i) =>
          supabase.rpc('set_item_store_sort_order', {
            p_item_id:       si.id,
            p_location_name: activeStore,
            p_sort_order:    (i + 1) * 10,
          })
        )
      ).then(results => results.find(r => r.error) ?? { error: null });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-items'] as const }),
  });

  const addMutation = useMutation({
    mutationFn: async ({ section, name, unit, stores }: AddForm) => {
      // Use ALL items (not just the active store's filtered list) to compute max sort_order
      const { data: allSectionItems } = await supabase
        .from('inventory_items')
        .select('sort_order')
        .eq('section', section)
        .order('sort_order', { ascending: false })
        .limit(1);
      const maxOrder = allSectionItems?.[0]?.sort_order ?? 0;
      const { error } = await supabase
        .from('inventory_items')
        .insert({ section, name, unit, sort_order: maxOrder + 10, stores });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-items'] });
      setShowAddModal(false);
    },
  });

  const addSectionMutation = useMutation({
    mutationFn: async ({ name, stores }: { name: string; stores: string[] }) => {
      const { data: maxData } = await supabase
        .from('inventory_sections')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1);
      const maxOrder = maxData?.[0]?.sort_order ?? 0;
      const { error } = await supabase
        .from('inventory_sections')
        .insert({ name, stores, sort_order: maxOrder + 10 });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-sections'] });
      setShowAddSectionModal(false);
    },
  });

  const deleteSectionMutation = useMutation({
    mutationFn: async (sectionName: string) => {
      const sec = dbSections.find(s => s.name === sectionName);
      if (!sec) return; // legacy section not in DB table — nothing to do
      const remaining = sec.stores.filter(s => s !== activeStore);
      if (remaining.length === 0) {
        const { error } = await supabase.from('inventory_sections').delete().eq('id', sec.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('inventory_sections').update({ stores: remaining }).eq('id', sec.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-sections'] });
      setConfirmDeleteSection(null);
    },
  });

  const moveSectionMutation = useMutation({
    mutationFn: async ({ id, section }: { id: string; section: string }) => {
      const { error } = await supabase
        .from('inventory_items')
        .update({ section })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-items'] as const }),
  });

  const renameSectionMutation = useMutation({
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      // Update section name in inventory_sections table
      const sec = dbSections.find(s => s.name === oldName);
      if (sec) {
        const { error } = await supabase
          .from('inventory_sections')
          .update({ name: newName })
          .eq('id', sec.id);
        if (error) throw error;
      }
      // Update all items that reference this section name
      const { error: itemsError } = await supabase
        .from('inventory_items')
        .update({ section: newName })
        .eq('section', oldName);
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-sections'] });
      qc.invalidateQueries({ queryKey: ['inventory-items'] });
      setRenamingSection(null);
    },
  });

  const saveTargetMutation = useMutation({
    mutationFn: async ({ item, t }: { item: InventoryItem; t: LocalTarget }) => {
      const { error } = await supabase.rpc('set_item_store_target', {
        p_item_id: item.id,
        p_store:   activeStore,
        p_mon:     t.mon,
        p_tue:     t.tue,
        p_wed:     t.wed,
        p_fri:     t.fri,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-items', activeStore] }),
  });

  // Save unit change to inventory_items
  const editUnitMutation = useMutation({
    mutationFn: async ({ id, unit }: { id: string; unit: string }) => {
      const { error } = await supabase
        .from('inventory_items')
        .update({ unit })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-items'] as const }),
  });

  /* ── Target edit helpers ─────────────────────────────────────────────────── */

  // Ref so handleTargetBlur always reads the latest localTargets without stale closures
  const localTargetsRef = useRef(localTargets);
  useEffect(() => { localTargetsRef.current = localTargets; }, [localTargets]);

  function getLocalVal(itemId: string, key: DayKey): number {
    return localTargets.get(itemId)?.[key] ?? 0;
  }

  const handleTargetChange = useCallback((itemId: string, key: DayKey, raw: string) => {
    const num = raw === '' ? 0 : Math.max(0, parseInt(raw, 10) || 0);
    setLocalTargets(prev => {
      const copy     = new Map(prev);
      const existing = copy.get(itemId) ?? { mon: 0, tue: 0, wed: 0, fri: 0 };
      copy.set(itemId, { ...existing, [key]: num });
      return copy;
    });
  }, []);

  const handleTargetBlur = useCallback((item: InventoryItem) => {
    const t = localTargetsRef.current.get(item.id);
    if (t !== undefined) {
      saveTargetMutation.mutate({ item, t });
    }
  }, [saveTargetMutation]);

  const colSpan = editMode ? 8 : 6;

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return (
    <div>

      {/* ── Lock banner ─────────────────────────────────────────────────────── */}
      {activeLock && (
        <div className="flex items-center gap-3 mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-amber-500 text-lg">🔒</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">
              {activeLock.locked_by_name} is currently editing this page
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              Editing is locked to prevent conflicting changes. It will unlock automatically when they finish.
            </p>
          </div>
        </div>
      )}

      {showAddModal && (
        <AddItemModal
          onClose={() => setShowAddModal(false)}
          onSubmit={form => addMutation.mutate(form)}
          isPending={addMutation.isPending}
          sections={allSectionNames}
        />
      )}

      {showAddSectionModal && (
        <AddSectionModal
          onClose={() => setShowAddSectionModal(false)}
          onSubmit={(name, stores) => addSectionMutation.mutate({ name, stores })}
          isPending={addSectionMutation.isPending}
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
            <>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold bg-[#1B5E20] text-white border border-[#1B5E20] hover:bg-[#2E7D32] transition-colors shadow-sm"
              >
                <Plus size={15} />
                Add Item
              </button>
              <button
                onClick={() => setShowAddSectionModal(true)}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold bg-white text-[#1B5E20] border border-[#1B5E20] hover:bg-[#F1F8E9] transition-colors"
              >
                <Plus size={15} />
                Add Section
              </button>
            </>
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
            disabled={!editMode && !!activeLock}
            onClick={async () => {
              if (editMode) {
                // Release lock and exit edit mode
                if (currentUser) {
                  await supabase.rpc('release_edit_lock', {
                    p_page_key: LOCK_PAGE_KEY,
                    p_user_id:  currentUser.id,
                  });
                  iOwnLock.current = false;
                }
                setEditMode(false);
                setConfirmReset(false);
              } else {
                // Try to acquire lock
                if (!currentUser) return;
                const { data } = await supabase.rpc('acquire_edit_lock', {
                  p_page_key:  LOCK_PAGE_KEY,
                  p_user_id:   currentUser.id,
                  p_user_name: currentUser.name,
                });
                if (data?.success) {
                  iOwnLock.current = true;
                  setActiveLock(null);
                  setEditMode(true);
                } else {
                  // Lock acquired by someone else between poll intervals
                  setActiveLock({
                    locked_by_name: data?.locked_by_name ?? 'Someone',
                    locked_at:      data?.locked_at ?? new Date().toISOString(),
                  });
                }
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
              editMode
                ? 'bg-white text-[#1B5E20] border-[#1B5E20]'
                : activeLock
                  ? 'bg-white text-gray-400 border-gray-200 cursor-not-allowed'
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
                      <td colSpan={colSpan} className="px-4 py-2">
                        <div className="flex items-center justify-between">
                          {/* Section name — click to rename in edit mode */}
                          {editMode && renamingSection === section.title ? (
                            <form
                              className="flex items-center gap-2"
                              onSubmit={e => {
                                e.preventDefault();
                                const trimmed = renameValue.trim();
                                if (trimmed && trimmed !== section.title) {
                                  renameSectionMutation.mutate({ oldName: section.title, newName: trimmed });
                                } else {
                                  setRenamingSection(null);
                                }
                              }}
                            >
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={e => setRenameValue(e.target.value)}
                                onBlur={() => setRenamingSection(null)}
                                onKeyDown={e => { if (e.key === 'Escape') setRenamingSection(null); }}
                                className="text-xs font-bold text-[#2E7D32] uppercase tracking-wider bg-white border border-[#2E7D32] rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#1B5E20] w-40"
                              />
                              <button
                                type="submit"
                                disabled={renameSectionMutation.isPending}
                                className="px-2 py-0.5 rounded text-xs font-semibold bg-[#1B5E20] text-white hover:bg-[#2E7D32] disabled:opacity-50 transition-colors"
                                onMouseDown={e => e.preventDefault()}
                              >
                                {renameSectionMutation.isPending ? '…' : 'Save'}
                              </button>
                            </form>
                          ) : (
                            <button
                              onClick={() => {
                                if (editMode) {
                                  setRenamingSection(section.title);
                                  setRenameValue(section.title);
                                  setConfirmDeleteSection(null);
                                }
                              }}
                              className={`text-xs font-bold text-[#2E7D32] uppercase tracking-wider ${editMode ? 'hover:text-[#1B5E20] hover:underline cursor-text' : ''}`}
                            >
                              {section.title}
                            </button>
                          )}
                          {editMode && renamingSection !== section.title && (
                            confirmDeleteSection === section.title ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-red-600 font-medium">
                                  Remove from {activeStore}?
                                </span>
                                <button
                                  onClick={() => deleteSectionMutation.mutate(section.title)}
                                  disabled={deleteSectionMutation.isPending}
                                  className="px-2.5 py-0.5 rounded text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                                >
                                  {deleteSectionMutation.isPending ? 'Removing…' : 'Confirm'}
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteSection(null)}
                                  className="px-2 py-0.5 rounded text-xs text-gray-500 hover:text-gray-700 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => section.items.length === 0
                                  ? setConfirmDeleteSection(section.title)
                                  : undefined
                                }
                                disabled={section.items.length > 0}
                                title={
                                  section.items.length > 0
                                    ? 'Remove all items from this section first'
                                    : `Remove ${section.title} from ${activeStore}`
                                }
                                className={`p-1 rounded transition-colors ${
                                  section.items.length > 0
                                    ? 'text-green-200 cursor-not-allowed'
                                    : 'text-green-300 hover:text-red-500 hover:bg-red-50'
                                }`}
                              >
                                <Trash2 size={13} />
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>

                    {editMode && section.items.length === 0 && (
                      <tr>
                        <td colSpan={colSpan} className="px-4 py-5 text-center text-xs text-gray-300 italic">
                          No items yet — use &ldquo;Add Item&rdquo; and select this section.
                        </td>
                      </tr>
                    )}

                    {section.items.map((item, idx) => {
                      const storeTarget = item.store_targets?.[activeStore];
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

                          <td className="px-4 py-2.5">
                            <div className="font-medium text-gray-800">{item.name}</div>
                            {editMode && (
                              <select
                                value={item.section}
                                onChange={e => moveSectionMutation.mutate({ id: item.id, section: e.target.value })}
                                className="mt-1 text-xs text-gray-400 border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-[#1B5E20] cursor-pointer hover:border-gray-400 transition-colors"
                              >
                                {allSectionNames.map(s => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-xs text-gray-400">
                            {editMode ? (
                              <input
                                type="text"
                                value={localUnits.get(item.id) ?? item.unit}
                                onChange={e => setLocalUnits(prev => new Map(prev).set(item.id, e.target.value))}
                                onBlur={() => {
                                  const unit = localUnitsRef.current.get(item.id);
                                  if (unit !== undefined && unit !== item.unit) {
                                    editUnitMutation.mutate({ id: item.id, unit });
                                  }
                                }}
                                className="w-full border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20]"
                              />
                            ) : (
                              item.unit
                            )}
                          </td>

                          {/* Day target cells */}
                          {DAY_COLS.map(d => (
                            <td key={d.key} className="px-2 py-1.5 text-center tabular-nums">
                              {editMode ? (
                                <input
                                  type="number"
                                  min="0"
                                  value={getLocalVal(item.id, d.key) || ''}
                                  placeholder="—"
                                  onChange={e => handleTargetChange(item.id, d.key, e.target.value)}
                                  onBlur={() => handleTargetBlur(item)}
                                  className="w-14 text-center border border-gray-200 rounded-md px-1 py-1 text-sm font-semibold text-[#2E7D32] bg-white focus:outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20] tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                              ) : (
                                (storeTarget?.[d.key] == null || storeTarget?.[d.key] === 0)
                                  ? <span className="text-gray-300">—</span>
                                  : <span className="font-semibold text-[#2E7D32]">{storeTarget[d.key]}</span>
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
