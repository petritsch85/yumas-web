'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, ChevronRight } from 'lucide-react';
import type { Item } from '@/types';
import { useT } from '@/lib/i18n';

export default function RecipesListPage() {
  const router = useRouter();
  const { t } = useT();
  const [search, setSearch] = useState('');

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['items', 'semi_finished'],
    queryFn: async () => {
      const { data } = await supabase
        .from('items')
        .select('*, category:categories(id, name, color_hex)')
        .eq('product_type', 'semi_finished')
        .eq('is_active', true)
        .order('name');
      return (data ?? []) as Item[];
    },
  });

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase())
  );

  /* Group by category */
  const grouped = filtered.reduce<Record<string, { color: string; items: Item[] }>>((acc, item) => {
    const cat = item.category?.name ?? 'Uncategorised';
    const color = item.category?.color_hex ?? '#9CA3AF';
    if (!acc[cat]) acc[cat] = { color, items: [] };
    acc[cat].items.push(item);
    return acc;
  }, {});

  const categories = Object.keys(grouped).sort();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('products.semiFinished')}</h1>
        <button
          onClick={() => router.push('/products/semi-finished/new')}
          className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          {t('recipes.newRecipe')}
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search recipes…"
          className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 bg-white rounded-xl border border-gray-100 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          {search ? 'No recipes match your search.' : 'No recipes yet. Add your first recipe above.'}
        </div>
      ) : (
        <div className="space-y-6">
          {categories.map(cat => (
            <div key={cat}>
              {/* Category header */}
              <div className="flex items-center gap-2 mb-2 px-1">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: grouped[cat].color }}
                />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{cat}</span>
                <span className="text-xs text-gray-400 ml-auto">{grouped[cat].items.length}</span>
              </div>

              {/* Recipe cards */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-50">
                {grouped[cat].items.map(item => (
                  <button
                    key={item.id}
                    onClick={() => router.push(`/products/${item.id}`)}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50/70 transition-colors text-left first:rounded-t-xl last:rounded-b-xl"
                  >
                    {/* Colour dot */}
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: grouped[cat].color }}
                    />

                    {/* Name + category */}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 text-sm leading-snug">{item.name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{cat}</div>
                    </div>

                    <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
