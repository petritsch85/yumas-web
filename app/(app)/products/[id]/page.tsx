'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatCurrency } from '@/lib/utils';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: item, isLoading } = useQuery({
    queryKey: ['item', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('items')
        .select('*, category:categories(id, name, color_hex), unit:units_of_measure(id, name, abbreviation)')
        .eq('id', id)
        .single();
      return data;
    },
  });

  const { data: stockLevels } = useQuery({
    queryKey: ['stock-levels', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory_levels')
        .select('*, location:locations(id, name)')
        .eq('item_id', id);
      return data ?? [];
    },
  });

  const { data: supplierItems } = useQuery({
    queryKey: ['supplier-items', id],
    enabled: item?.product_type === 'raw_material',
    queryFn: async () => {
      const { data } = await supabase
        .from('supplier_items')
        .select('*, supplier:suppliers(id, name)')
        .eq('item_id', id);
      return data ?? [];
    },
  });

  const { data: recipeLines } = useQuery({
    queryKey: ['recipe-lines', id],
    enabled: item?.product_type === 'semi_finished' || item?.product_type === 'finished',
    queryFn: async () => {
      // Get recipe where this item is the output
      const { data: recipe } = await supabase
        .from('recipes')
        .select('*, lines:recipe_lines(*, ingredient:items(name), unit:units_of_measure(abbreviation))')
        .eq('output_item_id', id)
        .single();
      return recipe;
    },
  });

  const { data: usedIn } = useQuery({
    queryKey: ['used-in', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('recipe_lines')
        .select('recipe:recipes(id, output_item_id, output_item:items(name))')
        .eq('ingredient_item_id', id);
      return data ?? [];
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-white rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!item) {
    return <div className="text-center text-gray-500 mt-12">Item not found</div>;
  }

  const typeLabel = item.product_type?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) ?? 'Unknown';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.back()}
          className="text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{item.name}</h1>
            <StatusBadge status={item.product_type ?? 'unknown'} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Details card */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Details</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Name</dt>
              <dd className="font-medium text-gray-900">{item.name}</dd>
            </div>
            {item.sku && (
              <div className="flex justify-between">
                <dt className="text-gray-500">SKU</dt>
                <dd className="font-mono text-gray-700">{item.sku}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-gray-500">Type</dt>
              <dd>{typeLabel}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Category</dt>
              <dd className="text-gray-700">{item.category?.name ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Unit</dt>
              <dd className="text-gray-700">{item.unit?.name ?? '—'} {item.unit?.abbreviation ? `(${item.unit.abbreviation})` : ''}</dd>
            </div>
            {item.description && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Description</dt>
                <dd className="text-gray-700 text-right max-w-48">{item.description}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-gray-500">Status</dt>
              <dd>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${item.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {item.is_active ? 'Active' : 'Inactive'}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        {/* Stock levels */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Stock by Location</h2>
          {stockLevels && stockLevels.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Min</th>
                </tr>
              </thead>
              <tbody>
                {(stockLevels as Record<string, unknown>[]).map((row, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-800">{(row.location as { name: string } | null)?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900">{row.quantity as number ?? 0}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{row.low_stock_threshold as number ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center text-gray-400 text-sm py-4">No stock records found</div>
          )}
        </div>

        {/* Suppliers (raw materials) */}
        {item.product_type === 'raw_material' && supplierItems && supplierItems.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 lg:col-span-2">
            <h2 className="font-semibold text-gray-900 mb-4">Suppliers</h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Package Size</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Preferred</th>
                </tr>
              </thead>
              <tbody>
                {(supplierItems as Record<string, unknown>[]).map((si, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-4 py-3 text-gray-800">{(si.supplier as { name: string } | null)?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-800">{formatCurrency(si.unit_price as number)}</td>
                    <td className="px-4 py-3 text-gray-600">{si.package_size as string ?? '—'}</td>
                    <td className="px-4 py-3">
                      {si.is_preferred ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Primary</span>
                      ) : (
                        <span className="text-gray-400 text-xs">Secondary</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Recipe (semi-finished / finished) */}
        {(item.product_type === 'semi_finished' || item.product_type === 'finished') && recipeLines && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 lg:col-span-2">
            <h2 className="font-semibold text-gray-900 mb-4">Recipe</h2>
            <div className="flex gap-6 mb-4 text-sm">
              <div>
                <span className="text-gray-500">Output Qty: </span>
                <span className="font-medium">{(recipeLines as Record<string, unknown>).output_quantity as number ?? '—'}</span>
              </div>
              <div>
                <span className="text-gray-500">Yield: </span>
                <span className="font-medium">{(recipeLines as Record<string, unknown>).yield_percentage as number ?? '—'}%</span>
              </div>
            </div>
            {((recipeLines as Record<string, unknown>).lines as Record<string, unknown>[])?.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ingredient</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cost/Unit</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Line Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(((recipeLines as Record<string, unknown>).lines as Record<string, unknown>[]) ?? []).map((line: Record<string, unknown>, i: number) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-gray-800">{(line.ingredient as { name: string } | null)?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{line.quantity as number}</td>
                      <td className="px-4 py-3 text-gray-600">{(line.unit as { abbreviation: string } | null)?.abbreviation ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(line.cost_per_unit as number)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(line.line_cost as number)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-gray-400 text-sm">No recipe lines defined</div>
            )}
          </div>
        )}

        {/* Used In */}
        {usedIn && usedIn.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 lg:col-span-2">
            <h2 className="font-semibold text-gray-900 mb-4">Used In</h2>
            <div className="flex flex-wrap gap-2">
              {(usedIn as Record<string, unknown>[]).map((row, i) => {
                const recipe = row.recipe as Record<string, unknown> | null;
                const outputItem = recipe?.output_item as { name: string } | null;
                return (
                  <span key={i} className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700">
                    {outputItem?.name ?? '—'}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
