'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Plus, Trash2, Save, ChevronDown, Pencil, X,
  ImagePlus, Video, Upload,
} from 'lucide-react';
import { useState, useEffect, useId, useRef } from 'react';
import { useT } from '@/lib/i18n';
import { localizedName } from '@/lib/localized-name';

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
  video_url: string | null;
  process_steps_en: string[] | null;
  process_steps_de: string[] | null;
  process_steps_es: string[] | null;
  minutes_to_produce: number | null;
  days_to_expiry: number | null;
  freezable: boolean | null;
}

interface PhotoRow { id: string; storage_path: string; created_at: string }

const newRow = (): IngredientRow => ({ id: null, item_id: '', quantity: '', unit_id: '', notes: '' });

/* Convert any quantity to a common gram/ml base for sorting */
function normalizeQty(quantity: number | string, abbreviation: string | null | undefined): number {
  const q = Number(quantity) || 0;
  const u = (abbreviation ?? '').toLowerCase();
  if (u === 'kg' || u === 'l') return q * 1000;
  return q; // g, ml, mL, pcs, etc. — use as-is
}

/* ─── Video embed helper ─────────────────────────────────────────────────── */
function getEmbedUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    // YouTube
    if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
      const id = url.hostname.includes('youtu.be')
        ? url.pathname.slice(1)
        : url.searchParams.get('v') ?? url.pathname.split('/').pop() ?? '';
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    // Vimeo
    if (url.hostname.includes('vimeo.com')) {
      const id = url.pathname.split('/').filter(Boolean).pop() ?? '';
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch { /* fall through */ }
  return null;
}

/* ─── Component ──────────────────────────────────────────────────────────── */
export default function RecipeDetailPage() {
  const { t, lang } = useT();
  const { id: itemId } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const uid = useId();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);

  /* ── Current user profile → permission check ── */
  const { data: profile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('profiles').select('role, permissions').eq('id', user.id).single();
      return data as { role: string; permissions: Record<string, boolean> } | null;
    },
  });
  const canEdit = profile?.role === 'admin' || !!profile?.permissions?.recipe_edit;
  const [videoInput, setVideoInput] = useState('');
  const [videoSaving, setVideoSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  /* ── Master data ── */
  const { data: item } = useQuery({
    queryKey: ['item', itemId],
    queryFn: async () => {
      const { data } = await supabase
        .from('items')
        .select('id, name, name_en, name_de, name_es, product_type, category_id, category:categories(id, name, color_hex), unit:units_of_measure(id, name, abbreviation)')
        .eq('id', itemId)
        .single();
      return data;
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('id, name, color_hex').order('name');
      return data ?? [];
    },
  });

  const { data: allItems = [] } = useQuery({
    queryKey: ['items-for-select'],
    enabled: editing,
    queryFn: async () => {
      const { data } = await supabase
        .from('items')
        .select('id, name, name_en, name_de, name_es, product_type')
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
        .select('id, output_item_id, output_quantity, yield_percent, instructions, video_url, process_steps_en, process_steps_de, process_steps_es, minutes_to_produce, days_to_expiry, freezable')
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
        .select('id, item_id, quantity, unit_id, notes, ingredient:items(name, name_en, name_de, name_es), unit:units_of_measure(name, abbreviation)')
        .eq('recipe_id', recipe!.id)
        .order('id');
      return (data ?? []) as unknown as (IngredientRow & {
        ingredient?: { name: string; name_en?: string | null; name_de?: string | null; name_es?: string | null } | null;
        unit?: { name: string; abbreviation: string | null } | null;
      })[];
    },
  });

  const { data: photos = [] } = useQuery({
    queryKey: ['recipe-photos', itemId],
    enabled: !!recipe?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('recipe_photos')
        .select('id, storage_path, created_at')
        .eq('recipe_id', recipe!.id)
        .order('created_at');
      return (data ?? []) as PhotoRow[];
    },
  });

  /* ── Edit state ── */
  const [outputQty, setOutputQty] = useState<string>('');
  const [yieldPct, setYieldPct] = useState<string>('');
  const [minutesToProduce, setMinutesToProduce] = useState<string>('');
  const [daysToExpiry, setDaysToExpiry] = useState<string>('');
  const [freezable, setFreezable] = useState<boolean | null>(null);
  const [instructions, setInstructions] = useState('');
  const [rows, setRows] = useState<IngredientRow[]>([]);
  const [stepsEn, setStepsEn] = useState<string[]>([]);
  const [stepsDe, setStepsDe] = useState<string[]>([]);
  const [stepsEs, setStepsEs] = useState<string[]>([]);
  const [stepsTab, setStepsTab] = useState<'en' | 'de' | 'es'>('en');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /* ── Item details (admin card) ── */
  const [nameDraft, setNameDraft] = useState({ en: '', de: '', es: '' });
  const [categoryDraft, setCategoryDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  const syncFromDb = () => {
    setOutputQty(recipe?.output_quantity != null ? String(recipe.output_quantity) : '');
    setYieldPct(recipe?.yield_percent != null ? String(recipe.yield_percent) : '');
    setMinutesToProduce(recipe?.minutes_to_produce != null ? String(recipe.minutes_to_produce) : '');
    setDaysToExpiry(recipe?.days_to_expiry != null ? String(recipe.days_to_expiry) : '');
    setFreezable(recipe?.freezable ?? null);
    setInstructions(recipe?.instructions ?? '');
    setStepsEn(recipe?.process_steps_en ?? []);
    setStepsDe(recipe?.process_steps_de ?? []);
    setStepsEs(recipe?.process_steps_es ?? []);
    setRows(
      savedIngredients.length > 0
        ? savedIngredients.map(r => ({ ...r, quantity: String(r.quantity), notes: r.notes ?? '' }))
        : [newRow()]
    );
  };

  useEffect(() => { syncFromDb(); }, [recipe, savedIngredients]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (item) {
      const i = item as { name_en?: string | null; name_de?: string | null; name_es?: string | null; category_id?: string | null };
      setNameDraft({ en: i.name_en ?? '', de: i.name_de ?? '', es: i.name_es ?? '' });
      setCategoryDraft(i.category_id ?? '');
    }
  }, [item]);

  const handleEdit   = () => { syncFromDb(); setEditing(true); };
  const handleCancel = () => { syncFromDb(); setEditing(false); };

  const updateRow = (idx: number, patch: Partial<IngredientRow>) =>
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const deleteRow = (idx: number) =>
    setRows(prev => prev.filter((_, i) => i !== idx));

  /* ── Save recipe ── */
  const handleSave = async () => {
    setSaving(true); setSaved(false);
    try {
      let recipeId = recipe?.id ?? null;
      if (!recipeId) {
        const { data, error } = await supabase
          .from('recipes')
          .insert({ output_item_id: itemId, output_quantity: outputQty !== '' ? Number(outputQty) : null, yield_percent: yieldPct !== '' ? Number(yieldPct) : null, minutes_to_produce: minutesToProduce !== '' ? Number(minutesToProduce) : null, days_to_expiry: daysToExpiry !== '' ? Number(daysToExpiry) : null, freezable: freezable, instructions: instructions || null, process_steps_en: stepsEn.filter(s => s.trim()), process_steps_de: stepsDe.filter(s => s.trim()), process_steps_es: stepsEs.filter(s => s.trim()) })
          .select('id').single();
        if (error) throw error;
        recipeId = data.id;
      } else {
        const { error } = await supabase.from('recipes').update({ output_quantity: outputQty !== '' ? Number(outputQty) : null, yield_percent: yieldPct !== '' ? Number(yieldPct) : null, minutes_to_produce: minutesToProduce !== '' ? Number(minutesToProduce) : null, days_to_expiry: daysToExpiry !== '' ? Number(daysToExpiry) : null, freezable: freezable, instructions: instructions || null, process_steps_en: stepsEn.filter(s => s.trim()), process_steps_de: stepsDe.filter(s => s.trim()), process_steps_es: stepsEs.filter(s => s.trim()) }).eq('id', recipeId);
        if (error) throw error;
      }
      await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId);
      const validRows = rows.filter(r => r.item_id && r.quantity !== '' && r.quantity !== null);
      if (validRows.length > 0) {
        const { error } = await supabase.from('recipe_ingredients').insert(validRows.map(r => ({ recipe_id: recipeId, item_id: r.item_id, quantity: Number(r.quantity), unit_id: r.unit_id || null, notes: r.notes || null })));
        if (error) throw error;
      }
      await qc.invalidateQueries({ queryKey: ['recipe', itemId] });
      await qc.invalidateQueries({ queryKey: ['recipe-ingredients', itemId] });
      setSaved(true); setEditing(false);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { console.error(err); alert('Save failed: ' + (err instanceof Error ? err.message : String(err))); }
    finally { setSaving(false); }
  };

  /* ── Delete entire recipe + item ── */
  const handleDeleteRecipe = async () => {
    if (!confirm('Delete this recipe permanently? This will remove the recipe, all ingredients, steps, and photos. This cannot be undone.')) return;
    setDeleting(true);
    try {
      // 1. Remove photos from storage
      if (photos.length > 0) {
        await supabase.storage.from('recipe-media').remove(photos.map(p => p.storage_path));
      }
      if (recipe?.id) {
        // 2. Delete photo rows, ingredients
        await supabase.from('recipe_photos').delete().eq('recipe_id', recipe.id);
        await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipe.id);
        // 3. Delete recipe row
        await supabase.from('recipes').delete().eq('id', recipe.id);
      }
      // 4. Delete the item itself
      await supabase.from('items').delete().eq('id', itemId);
      // 5. Go back to the recipes list
      router.push('/products/semi-finished');
    } catch (err) {
      alert('Delete failed: ' + (err instanceof Error ? err.message : String(err)));
      setDeleting(false);
    }
  };

  /* ── Save item name translations ── */
  const handleSaveNames = async () => {
    setNameSaving(true);
    try {
      const { error } = await supabase
        .from('items')
        .update({
          name_en:     nameDraft.en.trim() || null,
          name_de:     nameDraft.de.trim() || null,
          name_es:     nameDraft.es.trim() || null,
          category_id: categoryDraft || null,
        })
        .eq('id', itemId);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ['item', itemId] });
      await qc.invalidateQueries({ queryKey: ['items-for-select'] });
      await qc.invalidateQueries({ queryKey: ['recipe-ingredients', itemId] });
      await qc.invalidateQueries({ queryKey: ['items'] }); // refresh product list pages
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 3000);
    } catch (err) {
      alert('Save failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setNameSaving(false);
    }
  };

  /* ── Ensure recipe row exists (needed before adding photos/video) ── */
  const ensureRecipe = async (): Promise<string | null> => {
    if (recipe?.id) return recipe.id;
    const { data, error } = await supabase
      .from('recipes')
      .insert({ output_item_id: itemId, output_quantity: null, yield_percent: null, instructions: null, process_steps_en: [], process_steps_de: [], process_steps_es: [] })
      .select('id').single();
    if (error) { alert('Could not create recipe record: ' + error.message); return null; }
    await qc.invalidateQueries({ queryKey: ['recipe', itemId] });
    return data.id;
  };

  /* ── Upload photos ── */
  const handlePhotoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPhotoUploading(true);
    try {
      const recipeId = await ensureRecipe();
      if (!recipeId) return;
      for (const file of Array.from(files)) {
        const ext = file.name.split('.').pop();
        const path = `${recipeId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('recipe-media').upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        const { error: dbErr } = await supabase.from('recipe_photos').insert({ recipe_id: recipeId, storage_path: path });
        if (dbErr) throw dbErr;
      }
      await qc.invalidateQueries({ queryKey: ['recipe-photos', itemId] });
    } catch (e: unknown) { alert('Photo upload failed: ' + (e as Error).message); }
    finally { setPhotoUploading(false); if (photoInputRef.current) photoInputRef.current.value = ''; }
  };

  const handleDeletePhoto = async (photo: PhotoRow) => {
    if (!confirm('Delete this photo?')) return;
    await supabase.storage.from('recipe-media').remove([photo.storage_path]);
    await supabase.from('recipe_photos').delete().eq('id', photo.id);
    qc.invalidateQueries({ queryKey: ['recipe-photos', itemId] });
  };

  /* ── Save video URL ── */
  const handleSaveVideo = async () => {
    const embed = getEmbedUrl(videoInput);
    if (!embed && videoInput.trim()) { alert('Please enter a valid YouTube or Vimeo URL.'); return; }
    setVideoSaving(true);
    try {
      const recipeId = await ensureRecipe();
      if (!recipeId) return;
      await supabase.from('recipes').update({ video_url: videoInput.trim() || null }).eq('id', recipeId);
      await qc.invalidateQueries({ queryKey: ['recipe', itemId] });
      setShowVideoModal(false); setVideoInput('');
    } catch (e: unknown) { alert('Save failed: ' + (e as Error).message); }
    finally { setVideoSaving(false); }
  };

  const handleDeleteVideo = async () => {
    if (!confirm('Remove the video link?')) return;
    if (recipe?.id) {
      await supabase.from('recipes').update({ video_url: null }).eq('id', recipe.id);
      qc.invalidateQueries({ queryKey: ['recipe', itemId] });
    }
  };

  /* ── Helpers ── */
  const getPhotoUrl = (path: string) =>
    supabase.storage.from('recipe-media').getPublicUrl(path).data.publicUrl;

  const catColor      = (item?.category as { color_hex?: string | null } | null)?.color_hex ?? '#9CA3AF';
  const catName       = (item?.category as { name?: string } | null)?.name ?? '';
  const itemUnit      = (item?.unit as { abbreviation?: string | null; name?: string } | null);
  const itemUnitLabel = itemUnit?.abbreviation || itemUnit?.name || '';
  const embedUrl      = recipe?.video_url ? getEmbedUrl(recipe.video_url) : null;

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
      <div className="flex items-start gap-2 flex-wrap">
        <button onClick={() => router.back()} className="mt-1 text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: catColor }} />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{catName}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">{item ? localizedName(item as { name: string; name_en?: string | null; name_de?: string | null; name_es?: string | null }, lang) : '…'}</h1>
        </div>

        {/* Action buttons — only shown to users with recipe_edit permission */}
        {canEdit && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Add Photos */}
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={photoUploading}
              className="flex items-center gap-1.5 border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <ImagePlus size={14} />
              {photoUploading ? 'Uploading…' : 'Add Photos'}
            </button>
            <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handlePhotoFiles(e.target.files)} />

            {/* Add / Change Video */}
            <button
              onClick={() => { setVideoInput(recipe?.video_url ?? ''); setShowVideoModal(true); }}
              className="flex items-center gap-1.5 border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <Video size={14} />
              {recipe?.video_url ? 'Change Video' : 'Add Video'}
            </button>

            {/* Edit recipe */}
            {editing ? (
              <>
                <button onClick={handleCancel} className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                  <X size={14} />Cancel
                </button>
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-60">
                  <Save size={14} />{saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <button onClick={handleEdit} className="flex items-center gap-1.5 border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                <Pencil size={14} />Edit
              </button>
            )}
          </div>
        )}
      </div>

      {saved && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3">
          Recipe saved successfully.
        </div>
      )}

      {/* ── Item Details (admin only) ── */}
      {profile?.role === 'admin' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 text-sm">{t('products.itemDetails')}</h2>
            {nameSaved && <span className="text-xs text-green-600 font-medium">✓ {t('products.namesSaved')}</span>}
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('products.itemCategory')}</label>
            <div className="relative">
              <select
                value={categoryDraft}
                onChange={e => setCategoryDraft(e.target.value)}
                className="w-full appearance-none border-2 border-gray-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] text-gray-900 pr-8"
              >
                <option value="">— {t('common.optional')} —</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>

          <div className="border-t border-gray-50 pt-3">
            <p className="text-xs text-gray-400 mb-3">{t('products.nameTranslationsDesc')}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">🇬🇧 {t('language.en')}</label>
                <input
                  value={nameDraft.en}
                  onChange={e => setNameDraft(d => ({ ...d, en: e.target.value }))}
                  placeholder={item?.name}
                  className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">🇩🇪 {t('language.de')}</label>
                <input
                  value={nameDraft.de}
                  onChange={e => setNameDraft(d => ({ ...d, de: e.target.value }))}
                  placeholder={item?.name}
                  className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">🇪🇸 {t('language.es')}</label>
                <input
                  value={nameDraft.es}
                  onChange={e => setNameDraft(d => ({ ...d, es: e.target.value }))}
                  placeholder={item?.name}
                  className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
                />
              </div>
            </div>
          </div>

          <button
            onClick={handleSaveNames}
            disabled={nameSaving}
            className="flex items-center gap-1.5 bg-[#1B5E20] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] transition-colors disabled:opacity-60"
          >
            <Save size={14} />
            {nameSaving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      )}

      {/* ── Recipe Settings ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 text-sm">Recipe Settings</h2>
        {editing ? (
          <>
            {/* Row 1: Output Qty + Yield */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Output Quantity</label>
                <input type="number" min="0" step="any" value={outputQty} onChange={e => setOutputQty(e.target.value)} placeholder="e.g. 10"
                  className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Yield %</label>
                <input type="number" min="0" max="100" step="any" value={yieldPct} onChange={e => setYieldPct(e.target.value)} placeholder="e.g. 95"
                  className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]" />
              </div>
            </div>
            {/* Row 2: Min to Produce + Days to Expiry */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Min. to Produce</label>
                <input type="number" min="0" step="1" value={minutesToProduce} onChange={e => setMinutesToProduce(e.target.value)} placeholder="e.g. 60"
                  className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Days to Expiry <span className="font-normal text-gray-400">(without freezing)</span></label>
                <input type="number" min="0" step="1" value={daysToExpiry} onChange={e => setDaysToExpiry(e.target.value)} placeholder="e.g. 5"
                  className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]" />
              </div>
            </div>
            {/* Row 3: Freezable toggle */}
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium text-gray-700">Freezable</p>
                <p className="text-xs text-gray-400">Can this recipe be frozen after production?</p>
              </div>
              <button
                type="button"
                onClick={() => setFreezable(v => v === true ? false : v === false ? null : true)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                  freezable === true ? 'bg-blue-500' : freezable === false ? 'bg-gray-200' : 'bg-gray-200'
                }`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${freezable === true ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          </>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="text-xs text-gray-400 mb-0.5">Output Quantity</dt>
              <dd className="font-semibold text-gray-900">
                {recipe?.output_quantity != null
                  ? <>{recipe.output_quantity}{itemUnitLabel && <span className="text-gray-400 font-normal ml-1">{itemUnitLabel}</span>}</>
                  : <span className="text-gray-300">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400 mb-0.5">Yield %</dt>
              <dd className="font-semibold text-gray-900">{recipe?.yield_percent != null ? `${recipe.yield_percent}%` : <span className="text-gray-300">—</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400 mb-0.5">Min. to Produce</dt>
              <dd className="font-semibold text-gray-900">{recipe?.minutes_to_produce != null ? `${recipe.minutes_to_produce} min` : <span className="text-gray-300">—</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400 mb-0.5">Days to Expiry (without freezing)</dt>
              <dd className="font-semibold text-gray-900">{recipe?.days_to_expiry != null ? `${recipe.days_to_expiry} days` : <span className="text-gray-300">—</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400 mb-0.5">Freezable</dt>
              <dd className="font-semibold text-gray-900">
                {recipe?.freezable === true
                  ? <span className="text-blue-600">✓ Yes</span>
                  : recipe?.freezable === false
                  ? <span className="text-gray-400">No</span>
                  : <span className="text-gray-300">—</span>}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {/* ── Ingredients ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
          <h2 className="font-semibold text-gray-900 text-sm">Ingredients</h2>
          {editing && (
            <button onClick={() => setRows(prev => [...prev, newRow()])} className="flex items-center gap-1.5 text-[#1B5E20] text-xs font-medium hover:text-[#2E7D32] transition-colors">
              <Plus size={14} />Add ingredient
            </button>
          )}
        </div>

        {editing ? (
          <>
            <div className="grid grid-cols-[1fr_80px_90px_36px] gap-2 px-5 py-2 bg-gray-50 border-b border-gray-100">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Ingredient</span>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Qty</span>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Unit</span>
              <span />
            </div>
            {rows.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-8">No ingredients yet — click &ldquo;Add ingredient&rdquo; to start.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {rows.map((row, idx) => (
                  <div key={`${uid}-${idx}`} className="grid grid-cols-[1fr_80px_90px_36px] gap-2 px-5 py-3 items-center">
                    <div className="relative">
                      <select value={row.item_id} onChange={e => updateRow(idx, { item_id: e.target.value })}
                        className="w-full appearance-none border-2 border-gray-300 rounded-lg pl-3 pr-7 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] text-gray-900">
                        <option value="">Select…</option>
                        {allItems.map(i => <option key={i.id} value={i.id}>{localizedName(i as { name: string; name_en?: string | null; name_de?: string | null; name_es?: string | null }, lang)}</option>)}
                      </select>
                      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                    <input type="number" min="0" step="any" value={row.quantity} onChange={e => updateRow(idx, { quantity: e.target.value })} placeholder="0"
                      className="w-full border-2 border-gray-300 bg-white rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]" />
                    <div className="relative">
                      <select value={row.unit_id} onChange={e => updateRow(idx, { unit_id: e.target.value })}
                        className="w-full appearance-none border-2 border-gray-300 rounded-lg pl-2 pr-6 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] text-gray-900">
                        <option value="">—</option>
                        {units.map(u => <option key={u.id} value={u.id}>{u.abbreviation || u.name}</option>)}
                      </select>
                      <ChevronDown size={13} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                    <button onClick={() => deleteRow(idx)} className="flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
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
                {[...savedIngredients]
                  .sort((a, b) => {
                    const unitA = (a as { unit?: { abbreviation: string | null } | null }).unit?.abbreviation;
                    const unitB = (b as { unit?: { abbreviation: string | null } | null }).unit?.abbreviation;
                    return normalizeQty(b.quantity, unitB) - normalizeQty(a.quantity, unitA);
                  })
                  .map((row, idx) => {
                    const ingredientName = localizedName((row as { ingredient?: { name: string; name_en?: string | null; name_de?: string | null; name_es?: string | null } | null }).ingredient, lang);
                    const unitRow = (row as { unit?: { name: string; abbreviation: string | null } | null }).unit;
                    const unitName = unitRow?.abbreviation || unitRow?.name || '—';
                    return (
                      <div key={idx} className={`grid grid-cols-[1fr_80px_72px] px-5 py-3 items-center border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>
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

      {/* ── Process ── */}
      {(() => {
        // Derive active set + setter from the selected tab
        const activeSteps = stepsTab === 'en' ? stepsEn : stepsTab === 'de' ? stepsDe : stepsEs;
        const setActiveSteps = stepsTab === 'en' ? setStepsEn : stepsTab === 'de' ? setStepsDe : setStepsEs;

        // Read view: show the user's language, fall back to English
        const readSteps = (() => {
          const langSteps =
            lang === 'de' ? recipe?.process_steps_de :
            lang === 'es' ? recipe?.process_steps_es :
            recipe?.process_steps_en;
          return (langSteps && langSteps.length > 0) ? langSteps : (recipe?.process_steps_en ?? []);
        })();

        const TABS = [
          { code: 'en' as const, flag: '🇬🇧', count: stepsEn.filter(s => s.trim()).length },
          { code: 'de' as const, flag: '🇩🇪', count: stepsDe.filter(s => s.trim()).length },
          { code: 'es' as const, flag: '🇪🇸', count: stepsEs.filter(s => s.trim()).length },
        ];

        return (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Card header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
              <h2 className="font-semibold text-gray-900 text-sm">{t('recipes.process')}</h2>
              {editing && (
                <button
                  onClick={() => setActiveSteps(prev => [...prev, ''])}
                  className="flex items-center gap-1.5 text-[#1B5E20] text-xs font-medium hover:text-[#2E7D32] transition-colors"
                >
                  <Plus size={14} />{t('recipes.addStep')}
                </button>
              )}
            </div>

            {editing ? (
              <>
                {/* Language tabs */}
                <div className="flex border-b border-gray-100">
                  {TABS.map(({ code, flag, count }) => (
                    <button
                      key={code}
                      onClick={() => setStepsTab(code)}
                      className={`flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                        stepsTab === code
                          ? 'border-[#1B5E20] text-[#1B5E20]'
                          : 'border-transparent text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      {flag} {code.toUpperCase()}
                      {count > 0 && (
                        <span className="w-4 h-4 rounded-full bg-[#1B5E20]/10 text-[#1B5E20] text-[10px] font-bold flex items-center justify-center">
                          {count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Steps for active tab */}
                {activeSteps.length === 0 ? (
                  <div className="text-center text-gray-400 text-sm py-8">{t('recipes.noSteps')}</div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {activeSteps.map((step, idx) => (
                      <div key={idx} className="flex items-start gap-3 px-5 py-3">
                        <span className="mt-2 flex-shrink-0 w-6 h-6 rounded-full bg-[#1B5E20]/10 text-[#1B5E20] text-xs font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <textarea
                          value={step}
                          onChange={e => setActiveSteps(prev => prev.map((s, i) => i === idx ? e.target.value : s))}
                          placeholder={t('recipes.stepPlaceholder')}
                          rows={2}
                          className="flex-1 border-2 border-gray-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] resize-none"
                        />
                        <div className="flex flex-col gap-1 flex-shrink-0 mt-1">
                          <button
                            disabled={idx === 0}
                            onClick={() => setActiveSteps(prev => { const a = [...prev]; [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]; return a; })}
                            className="text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors"
                            aria-label="Move up"
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2L2 8h10L7 2z" fill="currentColor"/></svg>
                          </button>
                          <button
                            disabled={idx === activeSteps.length - 1}
                            onClick={() => setActiveSteps(prev => { const a = [...prev]; [a[idx], a[idx + 1]] = [a[idx + 1], a[idx]]; return a; })}
                            className="text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors"
                            aria-label="Move down"
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 12L2 6h10L7 12z" fill="currentColor"/></svg>
                          </button>
                          <button
                            onClick={() => setActiveSteps(prev => prev.filter((_, i) => i !== idx))}
                            className="text-gray-300 hover:text-red-400 transition-colors mt-0.5"
                            aria-label="Delete step"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              readSteps.length === 0 ? (
                <div className="text-center text-gray-300 text-sm py-8">{t('recipes.noSteps')}</div>
              ) : (
                <ol className="px-5 py-4 space-y-3">
                  {readSteps.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#1B5E20]/10 text-[#1B5E20] text-xs font-bold flex items-center justify-center mt-0.5">
                        {idx + 1}
                      </span>
                      <span className="text-sm text-gray-800 leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              )
            )}
          </div>
        );
      })()}

      {/* ── Bottom save (edit mode only) ── */}
      {editing && (
        <button onClick={handleSave} disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-[#1B5E20] text-white py-3 rounded-xl text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-60">
          <Save size={16} />{saving ? 'Saving…' : 'Save Recipe'}
        </button>
      )}

      {/* ── Photos ── */}
      {(photos.length > 0 || photoUploading) && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
            <h2 className="font-semibold text-gray-900 text-sm">Photos</h2>
            <button onClick={() => photoInputRef.current?.click()} className="flex items-center gap-1.5 text-[#1B5E20] text-xs font-medium hover:text-[#2E7D32] transition-colors">
              <Plus size={14} />Add more
            </button>
          </div>
          <div className="p-4 grid grid-cols-3 gap-3">
            {photos.map(photo => (
              <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getPhotoUrl(photo.storage_path)}
                  alt=""
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={() => setLightboxSrc(getPhotoUrl(photo.storage_path))}
                />
                <button
                  onClick={() => handleDeletePhoto(photo)}
                  className="absolute top-1.5 right-1.5 bg-black/50 hover:bg-red-600 text-white rounded-full p-1 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {photoUploading && (
              <div className="aspect-square rounded-lg bg-gray-100 flex items-center justify-center">
                <Upload size={20} className="text-gray-400 animate-pulse" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Video ── */}
      {embedUrl && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
            <h2 className="font-semibold text-gray-900 text-sm">Video</h2>
            <button onClick={handleDeleteVideo} className="flex items-center gap-1.5 text-red-400 hover:text-red-600 text-xs font-medium transition-colors">
              <Trash2 size={13} />Remove
            </button>
          </div>
          <div className="aspect-video w-full">
            <iframe
              src={embedUrl}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}

      {/* ── Video Modal ── */}
      {showVideoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowVideoModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">{recipe?.video_url ? 'Change Video' : 'Add Video'}</h3>
              <button onClick={() => setShowVideoModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <p className="text-xs text-gray-500">Paste a YouTube or Vimeo URL. The video will be embedded directly on the recipe page.</p>
            <input
              type="url"
              value={videoInput}
              onChange={e => setVideoInput(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              className="w-full border-2 border-gray-300 bg-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
              autoFocus
            />
            {videoInput.trim() && !getEmbedUrl(videoInput) && (
              <p className="text-xs text-red-500">Not a recognised YouTube or Vimeo URL.</p>
            )}
            <div className="flex gap-2 pt-1">
              {recipe?.video_url && (
                <button onClick={async () => { await handleDeleteVideo(); setShowVideoModal(false); }} className="flex-1 border border-gray-200 text-red-500 py-2.5 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors">
                  Remove video
                </button>
              )}
              <button
                onClick={handleSaveVideo}
                disabled={videoSaving || (!!videoInput.trim() && !getEmbedUrl(videoInput))}
                className="flex-1 bg-[#1B5E20] text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-50"
              >
                {videoSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Photo lightbox ── */}
      {lightboxSrc && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxSrc(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxSrc} alt="" className="max-w-full max-h-full rounded-lg object-contain" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightboxSrc(null)} className="absolute top-4 right-4 text-white/70 hover:text-white">
            <X size={28} />
          </button>
        </div>
      )}

      {/* ── Delete Recipe (edit mode only) ── */}
      {canEdit && editing && (
        <div className="pt-2 pb-4">
          <button
            onClick={handleDeleteRecipe}
            disabled={deleting}
            className="w-full flex items-center justify-center gap-2 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-60"
          >
            <Trash2 size={15} />{deleting ? 'Deleting…' : 'Delete Recipe'}
          </button>
        </div>
      )}
    </div>
  );
}
