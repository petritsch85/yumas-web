'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate } from '@/lib/utils';
import type { ProductionStatus } from '@/types';

const STATUS_OPTIONS: (ProductionStatus | 'all')[] = ['all', 'planned', 'in_progress', 'completed', 'cancelled'];

// ── Recipe catalog imported from Production batches.xlsx ──────────────────────
interface CatalogItem {
  id: number;
  product: string;
  category: string;
  unit: string;
  minutesToProduce: number;
  daysToExpiry: number;
  freezable: 'Y' | 'N' | null;
}

const CATALOG: CatalogItem[] = [
  { id: 1,  product: 'Guacamole',                  category: 'Salsas/ Dips',    unit: '1/6 GN groß',         minutesToProduce: 60, daysToExpiry: 5, freezable: 'N' },
  { id: 2,  product: 'Schärfemix',                  category: 'Salsas/ Dips',    unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: 'N' },
  { id: 3,  product: 'Maissalsa',                   category: 'Salsas/ Dips',    unit: '1/6 GN groß',         minutesToProduce: 60, daysToExpiry: 5, freezable: 'N' },
  { id: 4,  product: 'Tomatensalsa',                category: 'Salsas/ Dips',    unit: '1/6 GN groß',         minutesToProduce: 60, daysToExpiry: 5, freezable: 'N' },
  { id: 5,  product: 'Sour Cream',                  category: 'Salsas/ Dips',    unit: '1/6 GN groß',         minutesToProduce: 60, daysToExpiry: 5, freezable: 'N' },
  { id: 6,  product: 'Crema Nogada',                category: 'Salsas/ Dips',    unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: 'N' },
  { id: 7,  product: 'Salsa Torta',                 category: 'Salsas/ Dips',    unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: 'N' },
  { id: 8,  product: 'Pozole',                      category: 'Supper',          unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 9,  product: 'Marinade Chicken',            category: 'Marinaden',       unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 10, product: 'Pico de Gallo',               category: 'Salsas/ Dips',    unit: '1/2 GN',              minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 11, product: 'Schoko-Avocado Mousse',       category: 'Desserts',        unit: 'Blech',               minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 12, product: 'Brownie',                     category: 'Desserts',        unit: 'Blech',               minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 13, product: 'Carlota de Limon',            category: 'Desserts',        unit: 'Stück',               minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 14, product: 'Mole',                        category: 'Veggy-Option',    unit: '1/6 GN groß',         minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 15, product: 'Marinade Al Pastor',          category: 'Fleisch-Option',  unit: 'Beutel (2kg)',        minutesToProduce: 60, daysToExpiry: 5, freezable: 'Y' },
  { id: 16, product: 'Barbacoa',                    category: 'Fleisch-Option',  unit: '1/6 GN groß',         minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 17, product: 'Chili con Carne',             category: 'Fleisch-Option',  unit: '1/6 GN groß',         minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 18, product: 'Cochinita',                   category: 'Fleisch-Option',  unit: '1/6 GN groß',         minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 19, product: 'Kartoffel Würfel',            category: 'Gemüse',          unit: 'Beutel (3.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 20, product: 'Vinaigrette',                 category: 'Dressings',       unit: 'Behälter (1.0l)',     minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 21, product: 'Honig Sesam / Senf',          category: 'Dressings',       unit: 'Behälter (1.0l)',     minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 22, product: 'Zwiebeln karamellisiert',     category: 'Gemüse',          unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 23, product: 'Karotten karamellisiert',     category: 'Gemüse',          unit: 'Beutel (10 Stück)',   minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 24, product: 'Bohnencreme',                 category: 'Salsas/ Dips',    unit: 'Beutel (2.5kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 25, product: 'Alambre - Zwiebel',           category: 'Veggy-Option',    unit: 'Beutel (2.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 26, product: 'Salsa Habanero',              category: 'Salsas/ Dips',    unit: 'Beutel (2.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 27, product: 'Salsa Verde',                 category: 'Salsas/ Dips',    unit: 'Beutel (2.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 28, product: 'Chipotle SourCream',          category: 'Salsas/ Dips',    unit: 'Beutel (2.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 29, product: 'Salsa de Jamaica',            category: 'Salsas/ Dips',    unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 30, product: 'Humo Salsa',                  category: 'Salsas/ Dips',    unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 31, product: 'Fuego Salsa',                 category: 'Salsas/ Dips',    unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 32, product: 'Salsa Pitaya',                category: 'Salsas/ Dips',    unit: 'Beutel (0.5kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 33, product: 'Rinderfilet Steak',           category: 'Platos',          unit: 'Beutel (250g)',       minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 34, product: 'Filetspitzen',                category: 'Platos',          unit: 'Beutel (100g)',       minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 35, product: 'Hähnchenkeule (ganz)',        category: 'Platos',          unit: 'Beutel (2 Stück)',    minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 36, product: 'Mole Rojo',                   category: 'Platos',          unit: 'Beutel (2.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 37, product: 'Chorizo',                     category: 'Platos',          unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 38, product: 'Carne Vegetal',               category: 'Platos',          unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 39, product: 'Costilla de Res',             category: 'Platos',          unit: 'Beutel (4 Portionen)',minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 40, product: 'Salsa für Costilla de Res',   category: 'Platos',          unit: 'Beutel (2L)',         minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 41, product: 'Rote Zwiebeln eingelegt',     category: 'Gemüse',          unit: '1/6 GN groß',         minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 42, product: 'Pulpo',                       category: 'Platos',          unit: 'Beutel (100 g)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 43, product: 'Salsa für Pulpo',             category: 'Platos',          unit: 'Beutel (0.5kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 44, product: 'Birria',                      category: 'Platos',          unit: 'Beutel (2.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 45, product: 'Salsa Birria',                category: 'Platos',          unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 46, product: 'Füllung Nogada',              category: 'Platos',          unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
  { id: 47, product: 'Gambas',                      category: 'Platos',          unit: 'Beutel (1.0kg)',      minutesToProduce: 60, daysToExpiry: 5, freezable: null },
];

const CATEGORY_COLORS: Record<string, string> = {
  'Salsas/ Dips':   'bg-orange-100 text-orange-700',
  'Platos':         'bg-purple-100 text-purple-700',
  'Fleisch-Option': 'bg-red-100 text-red-700',
  'Veggy-Option':   'bg-green-100 text-green-700',
  'Gemüse':         'bg-lime-100 text-lime-700',
  'Desserts':       'bg-pink-100 text-pink-700',
  'Dressings':      'bg-yellow-100 text-yellow-700',
  'Marinaden':      'bg-blue-100 text-blue-700',
  'Supper':         'bg-indigo-100 text-indigo-700',
};

type Tab = 'batches' | 'catalog';

export default function ProductionPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<ProductionStatus | 'all'>('all');
  const [tab, setTab] = useState<Tab>('catalog');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('all');

  const { data: batches, isLoading } = useQuery({
    queryKey: ['production-batches', statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('production_batches')
        .select('*, recipe:recipes(name, output_item:items(name)), location:locations(name)')
        .order('planned_date', { ascending: false });
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data } = await q;
      return data ?? [];
    },
  });

  const categories = ['all', ...Array.from(new Set(CATALOG.map((c) => c.category))).sort()];

  const filteredCatalog = CATALOG.filter((item) => {
    const matchSearch =
      !catalogSearch ||
      item.product.toLowerCase().includes(catalogSearch.toLowerCase()) ||
      item.category.toLowerCase().includes(catalogSearch.toLowerCase());
    const matchCat = catalogCategory === 'all' || item.category === catalogCategory;
    return matchSearch && matchCat;
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Production</h1>
        <div className="flex gap-2">
          <button
            onClick={() => router.push('/production/recipes')}
            className="bg-white text-gray-700 border border-gray-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Recipes
          </button>
          <button className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2">
            <Plus size={16} />
            New Batch
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {(['catalog', 'batches'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px capitalize ${
              tab === t
                ? 'border-[#1B5E20] text-[#1B5E20]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'catalog' ? `Catalog (${CATALOG.length})` : 'Batches'}
          </button>
        ))}
      </div>

      {/* ── CATALOG TAB ─────────────────────────────────────────────────── */}
      {tab === 'catalog' && (
        <div>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4">
            <input
              type="text"
              placeholder="Search products…"
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            />
            <select
              value={catalogCategory}
              onChange={(e) => setCatalogCategory(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === 'all' ? 'All categories' : c}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-8">#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Min. to Produce</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Days to Expiry</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Freezable</th>
                </tr>
              </thead>
              <tbody>
                {filteredCatalog.map((item, i) => (
                  <tr key={item.id} className={`border-t border-gray-100 hover:bg-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                    <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">{item.id}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{item.product}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[item.category] ?? 'bg-gray-100 text-gray-600'}`}>
                        {item.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs">{item.unit}</td>
                    <td className="px-4 py-2.5 text-right text-gray-700">{item.minutesToProduce}</td>
                    <td className="px-4 py-2.5 text-right text-gray-700">{item.daysToExpiry}</td>
                    <td className="px-4 py-2.5 text-center">
                      {item.freezable === 'Y' ? (
                        <span className="text-blue-600 font-medium text-xs">✓ Yes</span>
                      ) : item.freezable === 'N' ? (
                        <span className="text-gray-400 text-xs">No</span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredCatalog.length === 0 && (
              <div className="p-8 text-center text-gray-400 text-sm">No products match your filters</div>
            )}
          </div>

          <p className="text-xs text-gray-400 mt-2">{filteredCatalog.length} of {CATALOG.length} products</p>
        </div>
      )}

      {/* ── BATCHES TAB ─────────────────────────────────────────────────── */}
      {tab === 'batches' && (
        <div>
          <div className="flex gap-2 mb-4 flex-wrap">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                  statusFilter === s ? 'text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                }`}
                style={statusFilter === s ? { backgroundColor: '#1B5E20' } : undefined}
              >
                {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-100">
            <div className="overflow-x-auto">
              {isLoading ? (
                <div className="p-6 space-y-3">
                  {[...Array(6)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
                </div>
              ) : !batches || batches.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No production batches found</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Batch #</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipe</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Planned Date</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Planned Qty</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(batches as Record<string, unknown>[]).map((batch) => {
                      const recipe = batch.recipe as Record<string, unknown> | null;
                      const outputItem = recipe?.output_item as { name: string } | null;
                      return (
                        <tr key={batch.id as string} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                          <td className="px-4 py-3 font-mono text-xs text-gray-700">{batch.batch_number as string ?? `BATCH-${(batch.id as string).slice(0, 8)}`}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{recipe?.name as string ?? '—'}</div>
                            {outputItem && <div className="text-xs text-gray-400">{outputItem.name}</div>}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{(batch.location as { name: string } | null)?.name ?? '—'}</td>
                          <td className="px-4 py-3 text-gray-600">{formatDate(batch.planned_date as string)}</td>
                          <td className="px-4 py-3 text-right text-gray-800">{batch.planned_quantity as number ?? '—'}</td>
                          <td className="px-4 py-3"><StatusBadge status={batch.status as string} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
