'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, ChevronRight, ChevronDown } from 'lucide-react';
import type { Item } from '@/types';
import { useT } from '@/lib/i18n';
import { localizedName } from '@/lib/localized-name';

export default function RecipesListPage() {
  const router = useRouter();
  const { t, lang } = useT();
  const [search, setSearch] = useState('');
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());

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

  const filtered = items.filter(i => {
    const display = localizedName(i, lang).toLowerCase();
    return display.includes(search.toLowerCase()) || i.name.toLowerCase().includes(search.toLowerCase());
  });

  /* Group by category */
  const grouped = filtered.reduce<Record<string, { color: string; items: Item[] }>>((acc, item) => {
    const cat = item.category?.name ?? 'Uncategorised';
    const color = item.category?.color_hex ?? '#9CA3AF';
    if (!acc[cat]) acc[cat] = { color, items: [] };
    acc[cat].items.push(item);
    return acc;
  }, {});

  const categories = Object.keys(grouped).sort();

  const toggleCat = (cat: string) => {
    setOpenCats(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  // When searching, auto-expand all matching categories
  const effectiveOpen = search.trim()
    ? new Set(categories)
    : openCats;

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
            <div key={i} className="h-14 bg-white rounded-xl border border-gray-100 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          {search ? 'No recipes match your search.' : 'No recipes yet. Add your first recipe above.'}
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map(cat => {
            const isOpen = effectiveOpen.has(cat);
            const { color, items: catItems } = grouped[cat];
            return (
              <div key={cat} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Category header — clickable accordion toggle */}
                <button
                  onClick={() => toggleCat(cat)}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-sm font-semibold text-gray-700 uppercase tracking-wider flex-1">{cat}</span>
                  <span className="text-xs text-gray-400 font-medium">{catItems.length}</span>
                  {isOpen
                    ? <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
                    : <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
                  }
                </button>

                {/* Recipe rows — shown when expanded */}
                {isOpen && (
                  <div className="border-t border-gray-50 divide-y divide-gray-50">
                    {catItems.map(item => (
                      <button
                        key={item.id}
                        onClick={() => router.push(`/products/${item.id}`)}
                        className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/70 transition-colors text-left"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="flex-1 min-w-0 font-medium text-gray-800 text-sm leading-snug">
                          {localizedName(item, lang)}
                        </span>
                        <ChevronRight size={15} className="text-gray-300 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
