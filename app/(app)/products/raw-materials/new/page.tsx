'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { ArrowLeft, Save } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { Lang } from '@/lib/i18n';

const LANG_TABS: { code: Lang; flag: string }[] = [
  { code: 'en', flag: '🇬🇧' },
  { code: 'de', flag: '🇩🇪' },
  { code: 'es', flag: '🇪🇸' },
];

export default function NewRawMaterialPage() {
  const router = useRouter();
  const { t } = useT();

  /* ── Form state ── */
  const [nameEn, setNameEn] = useState('');
  const [nameDe, setNameDe] = useState('');
  const [nameEs, setNameEs] = useState('');
  const [nameTab, setNameTab] = useState<Lang>('en');
  const [categoryId, setCategoryId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [isPurchasable, setIsPurchasable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  /* ── Master data ── */
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('id, name, color_hex').order('name');
      return data ?? [];
    },
  });

  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: async () => {
      const { data } = await supabase.from('units_of_measure').select('id, name, abbreviation').order('name');
      return data ?? [];
    },
  });

  /* ── Submit ── */
  const handleCreate = async () => {
    setError('');
    const primaryName = nameEn.trim() || nameDe.trim() || nameEs.trim();
    if (!primaryName) { setError('Please enter a name in at least one language.'); return; }

    setSaving(true);
    try {
      const { data: newItem, error: itemErr } = await supabase
        .from('items')
        .insert({
          name:           primaryName,
          name_en:        nameEn.trim()  || null,
          name_de:        nameDe.trim()  || null,
          name_es:        nameEs.trim()  || null,
          product_type:   'raw_material',
          category_id:    categoryId || null,
          unit_id:        unitId     || null,
          is_purchasable: isPurchasable,
          is_produced:    false,
          is_active:      true,
        })
        .select('id')
        .single();
      if (itemErr) throw itemErr;

      router.push(`/products/${newItem.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setSaving(false);
    }
  };

  const nameValue    = nameTab === 'en' ? nameEn : nameTab === 'de' ? nameDe : nameEs;
  const setNameValue = nameTab === 'en' ? setNameEn : nameTab === 'de' ? setNameDe : setNameEs;

  return (
    <div className="max-w-lg mx-auto space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-700 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Raw Material</h1>
          <p className="text-sm text-gray-500 mt-0.5">Add a new ingredient or purchasable item</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {/* ── Name card ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <p className="text-sm font-semibold text-gray-900">Name</p>
        </div>

        {/* Language tabs */}
        <div className="flex border-b border-gray-100">
          {LANG_TABS.map(({ code, flag }) => {
            const filled = (code === 'en' ? nameEn : code === 'de' ? nameDe : nameEs).trim().length > 0;
            return (
              <button
                key={code}
                onClick={() => setNameTab(code)}
                className={`flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                  nameTab === code
                    ? 'border-[#1B5E20] text-[#1B5E20]'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {flag} {code.toUpperCase()}
                {filled && <span className="w-1.5 h-1.5 rounded-full bg-[#1B5E20]" />}
              </button>
            );
          })}
        </div>

        <div className="px-5 py-4">
          <input
            type="text"
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            placeholder="Item name…"
            className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
            autoFocus={nameTab === 'en'}
          />
          {nameTab === 'en' && (
            <p className="text-xs text-gray-400 mt-1.5">English name becomes the primary name used as a fallback.</p>
          )}
        </div>
      </div>

      {/* ── Details card ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        <p className="text-sm font-semibold text-gray-900">Details</p>

        {/* Category */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Category</label>
          <select
            value={categoryId}
            onChange={e => setCategoryId(e.target.value)}
            className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] text-gray-900"
          >
            <option value="">— Optional —</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Unit */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Unit of Measure</label>
          <select
            value={unitId}
            onChange={e => setUnitId(e.target.value)}
            className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] text-gray-900"
          >
            <option value="">— Optional —</option>
            {units.map(u => (
              <option key={u.id} value={u.id}>{u.abbreviation || u.name}</option>
            ))}
          </select>
        </div>

        {/* Purchasable toggle */}
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-700">Purchasable</p>
            <p className="text-xs text-gray-400">Can this item be ordered from a supplier?</p>
          </div>
          <button
            type="button"
            onClick={() => setIsPurchasable(v => !v)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
              isPurchasable ? 'bg-[#1B5E20]' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                isPurchasable ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* ── Submit ── */}
      <button
        onClick={handleCreate}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 bg-[#1B5E20] text-white py-3.5 rounded-xl text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-60"
      >
        <Save size={16} />
        {saving ? 'Creating…' : 'Create Item'}
      </button>
    </div>
  );
}
