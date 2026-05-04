'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useState } from 'react';
import { Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { useT } from '@/lib/i18n';

export default function RecipesPage() {
  const { t } = useT();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: recipes, isLoading } = useQuery({
    queryKey: ['recipes'],
    queryFn: async () => {
      const { data } = await supabase
        .from('recipes')
        .select('*, output_item:items(name, unit:units_of_measure(abbreviation)), lines:recipe_lines(count)')
        .order('name');
      return data ?? [];
    },
  });

  const { data: selectedRecipe } = useQuery({
    queryKey: ['recipe-detail', expandedId],
    enabled: !!expandedId,
    queryFn: async () => {
      const { data } = await supabase
        .from('recipes')
        .select('*, lines:recipe_lines(*, ingredient:items(name), unit:units_of_measure(abbreviation))')
        .eq('id', expandedId!)
        .single();
      return data;
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('recipes.title')}</h1>
        <button className="bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors flex items-center gap-2">
          <Plus size={16} />
          {t('recipes.newRecipe')}
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : !recipes || recipes.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">{t('recipes.noRecipes')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-8"></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('recipes.table.name')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('recipes.table.outputItem')}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('recipes.table.outputQty')}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('recipes.table.yieldPercent')}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('recipes.table.ingredients')}</th>
                </tr>
              </thead>
              <tbody>
                {(recipes as Record<string, unknown>[]).map((recipe) => {
                  const isExpanded = expandedId === recipe.id;
                  const outputItem = recipe.output_item as Record<string, unknown> | null;
                  const lineCount = (recipe.lines as { count: number }[] | null)?.[0]?.count ?? 0;
                  const lines = isExpanded && selectedRecipe
                    ? ((selectedRecipe as Record<string, unknown>).lines as Record<string, unknown>[] ?? [])
                    : [];

                  return (
                    <>
                      <tr
                        key={recipe.id as string}
                        className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : recipe.id as string)}
                      >
                        <td className="px-4 py-3 text-gray-400">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{recipe.name as string}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {outputItem?.name as string ?? '—'}{' '}
                          <span className="text-gray-400 text-xs">
                            {outputItem?.unit ? `(${(outputItem.unit as { abbreviation: string }).abbreviation})` : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-800">{recipe.output_quantity as number ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-gray-800">{recipe.yield_percentage as number ?? '—'}%</td>
                        <td className="px-4 py-3 text-right text-gray-600">{lineCount}</td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${recipe.id}-detail`} className="border-t border-gray-100 bg-gray-50">
                          <td colSpan={6} className="px-8 py-4">
                            {lines.length === 0 ? (
                              <div className="text-gray-400 text-sm">{t('recipes.noIngredients')}</div>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr>
                                    <th className="text-left text-xs font-medium text-gray-500 pb-2">{t('recipes.table.ingredient')}</th>
                                    <th className="text-right text-xs font-medium text-gray-500 pb-2">{t('recipes.table.qty')}</th>
                                    <th className="text-left text-xs font-medium text-gray-500 pb-2 pl-2">{t('recipes.table.unit')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lines.map((line: Record<string, unknown>, i: number) => (
                                    <tr key={i}>
                                      <td className="py-1 text-gray-800">{(line.ingredient as { name: string } | null)?.name ?? '—'}</td>
                                      <td className="py-1 text-right text-gray-700">{line.quantity as number}</td>
                                      <td className="py-1 pl-2 text-gray-500">{(line.unit as { abbreviation: string } | null)?.abbreviation ?? '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
