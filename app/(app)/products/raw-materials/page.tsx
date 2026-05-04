'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus } from 'lucide-react';
import type { Item } from '@/types';
import { useT } from '@/lib/i18n';

const FOOD_CATEGORIES = ['Meat & Fish', 'Dairy & Eggs', 'Fruit & Vegetables', 'Dry Goods', 'Prepared Items'];

export default function RawMaterialsPage() {
  const router = useRouter();
  const { t } = useT();
  const [search, setSearch]             = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  const { data: items, isLoading } = useQuery({
    queryKey: ['items', 'raw_material'],
    queryFn: async () => {
      const { data } = await supabase
        .from('items')
        .select('*, category:categories(id, name, color_hex), unit:units_of_measure(id, name, abbreviation)')
        .eq('product_type', 'raw_material')
        .eq('is_active', true)
        .order('name');
      return (data ?? []) as Item[];
    },
  });

  // Unique categories from data, preserving first-seen order
  const categories = useMemo(() => {
    const seen = new Map<string, { name: string; color_hex: string | null }>();
    for (const item of items ?? []) {
      if (item.category && !seen.has(item.category.name)) {
        seen.set(item.category.name, { name: item.category.name, color_hex: item.category.color_hex ?? null });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  // Build SKU map: food items → F1-N, drinks → D1-N
  const skuMap = useMemo(() => {
    if (!items) return {} as Record<string, string>;
    const foodItems  = items.filter(i => !i.category || FOOD_CATEGORIES.includes(i.category.name));
    const drinkItems = items.filter(i => i.category?.name === 'Beverages');
    const map: Record<string, string> = {};
    foodItems.forEach((item, i)  => { map[item.id] = `F1-${i + 1}`; });
    drinkItems.forEach((item, i) => { map[item.id] = `D1-${i + 1}`; });
    return map;
  }, [items]);

  const filtered = (items ?? []).filter((i) => {
    const matchesSearch   = i.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = activeCategory === 'All' || i.category?.name === activeCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('products.rawMaterials')}</h1>
        <button className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2">
          <Plus size={16} />
          Add Item
        </button>
      </div>

      {/* Category filter buttons */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setActiveCategory('All')}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeCategory === 'All'
                ? 'bg-[#1B5E20] text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900'
            }`}
          >
            {t('common.all')}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => setActiveCategory(cat.name)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeCategory === cat.name
                  ? 'text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900'
              }`}
              style={activeCategory === cat.name && cat.color_hex
                ? { backgroundColor: cat.color_hex, borderColor: cat.color_hex }
                : undefined}
            >
              {cat.color_hex && (
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: activeCategory === cat.name ? 'rgba(255,255,255,0.7)' : cat.color_hex }}
                />
              )}
              {cat.name}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100">
          <div className="relative max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items..."
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No items found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Purchasable</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => router.push(`/products/${item.id}`)}
                  >
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{skuMap[item.id] ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-900 font-medium">{item.name}</td>
                    <td className="px-4 py-3">
                      {item.category ? (
                        <span className="inline-flex items-center gap-1.5">
                          {item.category.color_hex && (
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.category.color_hex }} />
                          )}
                          {item.category.name}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{item.unit?.abbreviation ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${item.is_purchasable ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {item.is_purchasable ? t('common.yes') : t('common.no')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
