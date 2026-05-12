'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState } from 'react';
import { Search, Plus, Check, X, Download } from 'lucide-react';
import type { Item } from '@/types';
import { useT } from '@/lib/i18n';
import { localizedName } from '@/lib/localized-name';

// ── Types ─────────────────────────────────────────────────────────────────────

type MenuCategory = 'Starter' | 'Main' | 'Drinks' | 'Salsas' | 'Dessert' | 'Other';

type EditState = {
  name:             string;
  gross_price:      string;
  occasion:         'L' | 'D' | 'L+D';
  menu_category:    MenuCategory;
  guest_multiplier: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const OCCASION_OPTIONS: ('L' | 'D' | 'L+D')[] = ['L', 'D', 'L+D'];

const CATEGORY_OPTIONS: MenuCategory[] = ['Starter', 'Main', 'Drinks', 'Salsas', 'Dessert', 'Other'];

const CATEGORY_STYLES: Record<string, string> = {
  Main:    'bg-[#1B5E20]/10 text-[#1B5E20]',
  Starter: 'bg-amber-50 text-amber-700',
  Drinks:  'bg-blue-50 text-blue-700',
  Salsas:  'bg-orange-50 text-orange-700',
  Dessert: 'bg-pink-50 text-pink-700',
  Other:   'bg-gray-100 text-gray-500',
};

const OCCASION_STYLES: Record<string, string> = {
  'L':   'bg-amber-50 text-amber-700',
  'D':   'bg-indigo-50 text-indigo-700',
  'L+D': 'bg-gray-100 text-gray-600',
};

const fmt = (n: number | null | undefined) =>
  n != null ? new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' €' : '—';

const vatRate = (category: string | null | undefined): number =>
  category === 'Drinks' ? 0.19 : 0.07;

const fmtVat = (category: string | null | undefined): string =>
  category === 'Drinks' ? '19 %' : '7 %';

const netPrice = (gross: number | null | undefined, category: string | null | undefined): string => {
  if (gross == null) return '—';
  return fmt(gross / (1 + vatRate(category)));
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FinishedGoodsPage() {
  const qc = useQueryClient();
  const { t, lang } = useT();
  const [search,    setSearch]    = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [catFilter, setCatFilter] = useState<'all' | MenuCategory>('all');

  const { data: items, isLoading } = useQuery({
    queryKey: ['items', 'finished'],
    queryFn: async () => {
      const { data } = await supabase
        .from('items')
        .select('*, unit:units_of_measure(id, name, abbreviation)')
        .eq('product_type', 'finished')
        .eq('is_active', true)
        .order('menu_category')
        .order('name');
      return (data ?? []) as Item[];
    },
  });

  const filtered = (items ?? []).filter((i) => {
    const display = localizedName(i, lang).toLowerCase();
    const matchName = display.includes(search.toLowerCase()) || i.name.toLowerCase().includes(search.toLowerCase());
    const matchCat  = catFilter === 'all' || i.menu_category === catFilter;
    return matchName && matchCat;
  });

  // ── Totals ─────────────────────────────────────────────────────────────────

  const counts: Record<'all' | MenuCategory, number> = {
    all:     (items ?? []).length,
    Main:    (items ?? []).filter(i => i.menu_category === 'Main').length,
    Starter: (items ?? []).filter(i => i.menu_category === 'Starter').length,
    Drinks:  (items ?? []).filter(i => i.menu_category === 'Drinks').length,
    Salsas:  (items ?? []).filter(i => i.menu_category === 'Salsas').length,
    Dessert: (items ?? []).filter(i => i.menu_category === 'Dessert').length,
    Other:   (items ?? []).filter(i => i.menu_category === 'Other').length,
  };

  // ── Edit helpers ───────────────────────────────────────────────────────────

  const startEdit = (item: Item) => {
    setEditingId(item.id);
    setEditState({
      name:             item.name,
      gross_price:      String(item.gross_price ?? ''),
      occasion:         item.occasion         ?? 'L+D',
      menu_category:    item.menu_category    ?? 'Main',
      guest_multiplier: String(item.guest_multiplier ?? '0'),
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditState(null); };

  const saveEdit = async (id: string) => {
    if (!editState) return;
    setSaving(true);
    const { error } = await supabase.from('items').update({
      name:             editState.name.trim(),
      gross_price:      parseFloat(editState.gross_price)      || 0,
      occasion:         editState.occasion,
      menu_category:    editState.menu_category,
      guest_multiplier: parseInt(editState.guest_multiplier)   || 0,
    }).eq('id', id);
    setSaving(false);
    if (!error) {
      qc.invalidateQueries({ queryKey: ['items', 'finished'] });
      cancelEdit();
    }
  };

  // Sync guest_multiplier automatically when category changes
  const handleCategoryChange = (val: MenuCategory) => {
    setEditState(s => s ? { ...s, menu_category: val, guest_multiplier: val === 'Main' ? '1' : '0' } : s);
  };

  // ── CSV download (exports ALL items, ignoring current search/filter) ────────
  const handleDownloadCSV = () => {
    const all = items ?? [];
    const header = ['Name', 'Price (Gross)', 'VAT (%)', 'Price (Net)', 'Occasion', 'Category', 'Guest Multiplier'];
    const rows = all.map(i => {
      const vat     = vatRate(i.menu_category);
      const netVal  = i.gross_price != null ? i.gross_price / (1 + vat) : 0;
      return [
        `"${localizedName(i, lang).replace(/"/g, '""')}"`,
        i.gross_price != null ? String(i.gross_price).replace('.', ',') : '0',
        vat === 0.19 ? '19' : '7',
        netVal.toFixed(2).replace('.', ','),
        i.occasion      ?? '',
        i.menu_category ?? '',
        String(i.guest_multiplier ?? 0),
      ];
    });
    const csv = [header, ...rows].map(r => r.join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'finished-goods.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('products.finishedGoods')}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadCSV}
            disabled={!items || items.length === 0}
            className="border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors flex items-center gap-2 disabled:opacity-40"
          >
            <Download size={15} /> Download CSV
          </button>
          <button className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2">
            <Plus size={16} /> Add Item
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items..."
            className="border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent w-56"
          />
        </div>

        {/* Category filter tabs */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold flex-wrap">
          {(['all', 'Main', 'Starter', 'Drinks', 'Salsas', 'Dessert', 'Other'] as const).map(c => (
            <button key={c} onClick={() => setCatFilter(c)}
              className={`px-3 py-2 transition-colors ${catFilter === c ? 'bg-[#1B5E20] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
              {c === 'all' ? `All (${counts.all})` : `${c} (${counts[c]})`}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(8)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No items found</div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[#1B5E20]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wide border-r border-white/10">Name</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-white/70 uppercase tracking-wide border-r border-white/10 w-28">Price (gross)</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-white/70 uppercase tracking-wide border-r border-white/10 w-20">VAT</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-white/70 uppercase tracking-wide border-r border-white/10 w-28">Price (net)</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-white/70 uppercase tracking-wide border-r border-white/10 w-24">Occasion</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-white/70 uppercase tracking-wide border-r border-white/10 w-28">Category</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-white/70 uppercase tracking-wide border-r border-white/10 w-28">Guest ×</th>
                <th className="px-4 py-3 w-20 border-r border-white/10" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => {
                const isEditing = editingId === item.id;
                const rowCls = `border-b border-gray-200 group ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'} ${!isEditing ? 'hover:bg-[#1B5E20]/5 cursor-pointer' : 'bg-green-50/60'}`;

                return (
                  <tr key={item.id} className={rowCls} onClick={() => !isEditing && startEdit(item)}>

                    {/* Name */}
                    <td className="px-4 py-2.5 font-medium text-gray-800 border-r border-gray-200">
                      {isEditing ? (
                        <input
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                          value={editState!.name}
                          onChange={e => setEditState(s => s ? { ...s, name: e.target.value } : s)}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        localizedName(item, lang)
                      )}
                    </td>

                    {/* Price */}
                    <td className="px-4 py-2.5 text-right border-r border-gray-200 tabular-nums">
                      {isEditing ? (
                        <input
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                          value={editState!.gross_price}
                          onChange={e => setEditState(s => s ? { ...s, gross_price: e.target.value } : s)}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className="font-medium text-gray-800">{fmt(item.gross_price)}</span>
                      )}
                    </td>

                    {/* VAT */}
                    <td className="px-4 py-2.5 text-center border-r border-gray-200 tabular-nums">
                      <span className={`text-xs font-semibold ${item.menu_category === 'Drinks' ? 'text-indigo-600' : 'text-gray-500'}`}>
                        {fmtVat(item.menu_category)}
                      </span>
                    </td>

                    {/* Price (net) */}
                    <td className="px-4 py-2.5 text-right border-r border-gray-200 tabular-nums">
                      <span className="text-gray-600">{netPrice(item.gross_price, item.menu_category)}</span>
                    </td>

                    {/* Occasion */}
                    <td className="px-4 py-2.5 text-center border-r border-gray-200">
                      {isEditing ? (
                        <select
                          className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                          value={editState!.occasion}
                          onChange={e => setEditState(s => s ? { ...s, occasion: e.target.value as any } : s)}
                          onClick={e => e.stopPropagation()}
                        >
                          {OCCASION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${OCCASION_STYLES[item.occasion ?? 'L+D'] ?? 'bg-gray-100 text-gray-500'}`}>
                          {item.occasion ?? '—'}
                        </span>
                      )}
                    </td>

                    {/* Category */}
                    <td className="px-4 py-2.5 text-center border-r border-gray-200">
                      {isEditing ? (
                        <select
                          className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                          value={editState!.menu_category}
                          onChange={e => handleCategoryChange(e.target.value as any)}
                          onClick={e => e.stopPropagation()}
                        >
                          {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${CATEGORY_STYLES[item.menu_category ?? ''] ?? 'bg-gray-100 text-gray-500'}`}>
                          {item.menu_category ?? '—'}
                        </span>
                      )}
                    </td>

                    {/* Guest multiplier */}
                    <td className="px-4 py-2.5 text-center border-r border-gray-200">
                      {isEditing ? (
                        <input
                          type="number" min="0" max="10" step="1"
                          className="w-16 border border-gray-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                          value={editState!.guest_multiplier}
                          onChange={e => setEditState(s => s ? { ...s, guest_multiplier: e.target.value } : s)}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${item.guest_multiplier === 1 ? 'bg-[#1B5E20]/10 text-[#1B5E20]' : 'bg-gray-100 text-gray-400'}`}>
                          {item.guest_multiplier ?? 0}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2.5 text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => saveEdit(item.id)}
                            disabled={saving}
                            className="p-1.5 rounded-lg bg-[#1B5E20] text-white hover:bg-[#2E7D32] transition-colors disabled:opacity-50"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); startEdit(item); }}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-500 opacity-0 group-hover:opacity-100 hover:bg-[#1B5E20] hover:text-white transition-all"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-3">Click any row to edit its fields inline.</p>
    </div>
  );
}
