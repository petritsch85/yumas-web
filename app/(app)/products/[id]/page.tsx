'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Save, ChevronDown, Pencil, X } from 'lucide-react';
import { useState, useEffect, useId } from 'react';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface IngredientRow {
  id: string | null;
  item_id: string;
  quantity: number | string;
  unit_id: string;
  notes: string;
}

interface Recipe {
  id: string;
  output_item_id: string;
  output_quantity: number | null;
  yield_percent: number | null;
  instructions: string | null;
}

const newRow = (): IngredientRow => ({ id: null, item_id: '', quantity: '', unit_id: '', notes: '' });

/* ─── Component ──────────────────────────────────────────────────────────── */
export default function RecipeDetailPage() {
  const { id: itemId } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const uid = useId();

  const [editing, setEditing] = useState(false);

  /* ── Master data ── */
  const { data: item } = useQuery({
    queryKey: ['item', itemId],
    queryFn: async () => {
      const { data } = await supabase
        .from('items')
        .select('id, name, product_type, category:categories(id, name, color_hex)')
        .eq('id', itemId)
        .single();
      return data;
    },
  });

  const { data: allItems = [] } = useQuery({
    queryKey: ['items-for-select'],
    enabled: editing,
    queryFn: async () => {
      const { data } = await supabase
        .from('items')
        .select('id, name, product_type')
        .in('product_type', ['raw_material', 'semi_finished'])
        .eq('is_active', true)
        .order('name');
      return data ?? [];
    },
  });

  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    enabled: editing,
    queryFn: async () => {
      const { data } = await supabase
        .from('units_of_measure')
        .select('id, name, abbreviation')
        .order('name');
      return data ?? [];
    },
  });

  /* ── Recipe data ── */
  const { data: recipe, isLoading } = useQuery<Recipe | null>({
    queryKey: ['recipe', itemId],
    queryFn: async () => {
      const { data } = await supabase
        .from('recipes')
        .select('id, output_item_id, output_quantity, yield_percent, instructions')
        .eq('output_item_id', itemId)
        .maybeSingle();
      return data ?? null;
    },
  });

  const { data: savedIngredients = [] } = useQuery({
    queryKey: ['recipe-ingredients', itemId],
    enabled: !!recipe?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('recipe_ingredients')
        .select('id, item_id, quantity, unit_id, notes, ingredient:items(name), unit:units_of_measure(name, abbreviation)')
        .eq('recipe_id', recipe!.id)
        .order('id');
      return (data ?? []) as unknown as (IngredientRow & {
        ingredient?: { name: string } | null;
        unit?: { name: string; abbreviation: string | null } | null;
      })[];
    },
  });

  /* ── Edit state ── */
  const [outputQty, setOutputQty] = useState<string>('');
  const [yieldPct, setYieldPct] = useState<string>('');
  const [instructions, setInstructions] = useState('');
  const [rows, setRows] = useState<IngredientRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  /* Sync DB → local state */
  const syncFromDb = () => {
    setOutputQty(recipe?.output_quantity != null ? String(recipe.output_quantity) : '');
    setYieldPct(recipe?.yield_percent != null ? String(recipe.yield_percent) : '');
    setInstructions(recipe?.instructions ?? '');
    setRows(
      savedIngredients.length > 0
        ? savedIngredients.map(r => ({ ...r, quantity: String(r.quantity), notes: r.notes ?? '' }))
        : [newRow()]
    );
  };

  useEffect(() => { syncFromDb(); }, [recipe, savedIngredients]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEdit = () => { syncFromDb(); setEditing(true); };

  const handleCancel = () => { syncFromDb(); setEditing(false); };

  /* ── Row helpers ── */
  const updateRow = (idx: number, patch: Partial<IngredientRow>) =>
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const deleteRow = (idx: number) =>
    setRows(prev => prev.filter((_, i) => i !== idx));

  /* ── Save ── */
  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      let recipeId = recipe?.id ?? null;
      if (!recipeId) {
        const { data, error } = await supabase
          .from('recipes')
          .insert({
            output_item_id: itemId,
            output_quantity: outputQty !== '' ? Number(outputQty) : null,
            yield_percent: yieldPct !== '' ? Number(yieldPct) : null,
            instructions: instructions || null,
          })
          .select('id')
          .single();
        if (error) throw error;
        recipeId = data.id;
      } else {
        const { error } = await supabase
          .from('recipes')
          .update({
            output_quantity: outputQty !== '' ? Number(outputQty) : null,
            yield_percent: yieldPct !== '' ? Number(yieldPct) : null,
            instructions: instructions || null,
          })
          .eq('id', recipeId);
        if (error) throw error;
      }

      await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId);
      const validRows = rows.filter(r => r.item_id && r.quantity !== '' && r.quantity !== null);
      if (validRows.length > 0) {
        const { error } = await supabase.from('recipe_ingredients').insert(
          validRows.map(r => ({
            recipe_id: recipeId,
            item_id: r.item_id,
            quantity: Number(r.quantity),
            unit_id: r.unit_id || null,
            notes: r.notes || null,
          }))
        );
        if (error) throw error;
      }

      await qc.invalidateQueries({ queryKey: ['recipe', itemId] });
      await qc.invalidateQueries({ queryKey: ['recipe-ingredients', itemId] });
      setSaved(true);
      setEditing(false);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error(err);
      alert('Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  /* ── Derived display helpers ── */
  const catColor = (item?.category as { color_hex?: string | null } | null)?.color_hex ?? '#9CA3AF';
  const catName  = (item?.category as { name?: string } | null)?.name ?? '';

  const unitLabel = (unit_id: string) => {
    const u = units.find(u => u.id === unit_id);
    return u?.abbreviation || u?.name || '—';
  };
  const itemLabel = (item_id: string) => {
    const i = allItems.find(i => i.id === item_id);
    return i?.name ?? '—';
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 bg-white rounded-xl animate-pulse border border-gray-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-10">

      {/* ── Header ── */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => router.back()}
          className="mt-1 text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: catColor }} />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{catName}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">{item?.name ?? '…'}</h1>
        </div>

        {editing ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <X size={14} />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-60"
            >
              <Save size={14} />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <button
            onClick={handleEdit}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors flex-shrink-0"
          >
            <Pencil size={14} />
            Edit
          </button>
        )}
      </div>

      {saved && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3">
          Recipe saved successfully.
        </div>
      )}

      {/* ── Recipe Settings ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 text-sm">Recipe Settings</h2>

        {editing ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Output Quantity</label>
                <input
                  type="number" min="0" step="any"
                  value={outputQty}
                  onChange={e => setOutputQty(e.target.value)}
                  placeholder="e.g. 10"
                  className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Yield %</label>
                <input
                  type="number" min="0" max="100" step="any"
                  value={yieldPct}
                  onChange={e => setYieldPct(e.target.value)}
                  placeholder="e.g. 95"
                  className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Instructions / Notes</label>
              <textarea
                rows={3}
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                placeholder="Add preparation notes…"
                className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] resize-none"
              />
            </div>
          </>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-gray-400 mb-0.5">Output Quantity</dt>
              <dd className="font-semibold text-gray-900">{recipe?.output_quantity ?? <span className="text-gray-300">—</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400 mb-0.5">Yield %</dt>
              <dd className="font-semibold text-gray-900">{recipe?.yield_percent != null ? `${recipe.yield_percent}%` : <span className="text-gray-300">—</span>}</dd>
            </div>
            {recipe?.instructions && (
              <div className="col-span-2">
                <dt className="text-xs text-gray-400 mb-0.5">Instructions / Notes</dt>
                <dd className="text-gray-700 whitespace-pre-wrap">{recipe.instructions}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/* ── Ingredients ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
          <h2 className="font-semibold text-gray-900 text-sm">Ingredients</h2>
          {editing && (
            <button
              onClick={() => setRows(prev => [...prev, newRow()])}
              className="flex items-center gap-1.5 text-[#1B5E20] text-xs font-medium hover:text-[#2E7D32] transition-colors"
            >
              <Plus size={14} />
              Add ingredient
            </button>
          )}
        </div>

        {editing ? (
          <>
            {/* Edit column headers */}
            <div className="grid grid-cols-[1fr_80px_90px_36px] gap-2 px-5 py-2 bg-gray-50 border-b border-gray-100">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Ingredient</span>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Qty</span>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Unit</span>
              <span />
            </div>

            {rows.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-8">
                No ingredients yet — click &ldquo;Add ingredient&rdquo; to start.
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {rows.map((row, idx) => (
                  <div key={`${uid}-${idx}`} className="grid grid-cols-[1fr_80px_90px_36px] gap-2 px-5 py-3 items-center">
                    <div className="relative">
                      <select
                        value={row.item_id}
                        onChange={e => updateRow(idx, { item_id: e.target.value })}
                        className="w-full appearance-none border-2 border-gray-300 rounded-lg pl-3 pr-7 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] text-gray-900"
                      >
                        <option value="">Select…</option>
                        {allItems.map(i => (
                          <option key={i.id} value={i.id}>{i.name}</option>
                        ))}
                      </select>
                      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                    <input
                      type="number" min="0" step="any"
                      value={row.quantity}
                      onChange={e => updateRow(idx, { quantity: e.target.value })}
                      placeholder="0"
                      className="w-full border-2 border-gray-300 bg-white rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
                    />
                    <div className="relative">
                      <select
                        value={row.unit_id}
                        onChange={e => updateRow(idx, { unit_id: e.target.value })}
                        className="w-full appearance-none border-2 border-gray-300 rounded-lg pl-2 pr-6 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] text-gray-900"
                      >
                        <option value="">—</option>
                        {units.map(u => (
                          <option key={u.id} value={u.id}>{u.abbreviation || u.name}</option>
                        ))}
                      </select>
                      <ChevronDown size={13} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                    <button
                      onClick={() => deleteRow(idx)}
                      className="flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          /* Read-only ingredient list */
          savedIngredients.length === 0 ? (
            <div className="text-center text-gray-300 text-sm py-8">No ingredients added yet.</div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_80px_72px] px-5 py-2 bg-gray-50 border-b border-gray-200">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Ingredient</span>
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide text-center">Qty</span>
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide text-center">Unit</span>
              </div>
              <div>
                {savedIngredients.map((row, idx) => {
                  const ingredientName = (row as { ingredient?: { name: string } | null }).ingredient?.name ?? '—';
                  const unitRow = (row as { unit?: { name: string; abbreviation: string | null } | null }).unit;
                  const unitName = unitRow?.abbreviation || unitRow?.name || '—';
                  const isEven = idx % 2 === 0;
                  return (
                    <div
                      key={idx}
                      className={`grid grid-cols-[1fr_80px_72px] px-5 py-3 items-center border-b border-gray-100 ${isEven ? 'bg-white' : 'bg-gray-50/60'}`}
                    >
                      <span className="text-sm font-medium text-gray-800">{ingredientName}</span>
                      <span className="text-sm text-gray-700 text-center tabular-nums">{row.quantity}</span>
                      <span className="text-sm text-gray-500 text-center">{unitName}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )
        )}
      </div>

      {/* ── Bottom save (edit mode only) ── */}
      {editing && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-[#1B5E20] text-white py-3 rounded-xl text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-60"
        >
          <Save size={16} />
          {saving ? 'Saving…' : 'Save Recipe'}
        </button>
      )}
    </div>
  );
}
