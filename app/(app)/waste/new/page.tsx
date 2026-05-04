'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { ArrowLeft } from 'lucide-react';
import type { WasteReason } from '@/types';
import { useT } from '@/lib/i18n';

const REASONS: WasteReason[] = ['expired', 'damaged', 'spoiled', 'other'];

export default function NewWastePage() {
  const router = useRouter();
  const { t } = useT();
  const [locationId, setLocationId] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<WasteReason>('expired');
  const [wasteDate, setWasteDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [itemSearch, setItemSearch] = useState('');

  const { data: locations } = useQuery({
    queryKey: ['locations-list'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').order('name');
      return data ?? [];
    },
  });

  const { data: items } = useQuery({
    queryKey: ['items-waste', itemSearch],
    queryFn: async () => {
      let q = supabase.from('items').select('id, name').eq('is_active', true).order('name').limit(50);
      if (itemSearch) q = q.ilike('name', `%${itemSearch}%`);
      const { data } = await q;
      return data ?? [];
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationId || !itemId || !quantity) {
      setError(t('waste.new.errorRequired'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const { error: err } = await supabase.from('waste_logs').insert({
        location_id: locationId,
        item_id: itemId,
        quantity: parseFloat(quantity),
        reason,
        logged_by: user?.id ?? '',
        waste_date: wasteDate,
        notes: notes || null,
      });
      if (err) throw err;
      router.push('/waste');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{t('waste.new.title')}</h1>
      </div>

      <div className="max-w-xl">
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('waste.new.location')}</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
            >
              <option value="">{t('waste.new.selectLocation')}</option>
              {(locations as { id: string; name: string }[])?.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('waste.new.item')}</label>
            <input
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder={t('waste.new.searchItem')}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none mb-1"
            />
            <select
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
            >
              <option value="">{t('waste.new.selectItem')}</option>
              {(items as { id: string; name: string }[])?.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('waste.new.quantity')}</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
                min={0}
                step={0.01}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('waste.new.date')}</label>
              <input
                type="date"
                value={wasteDate}
                onChange={(e) => setWasteDate(e.target.value)}
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('waste.new.reason')}</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as WasteReason)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>{t(`status.${r}`)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('waste.new.notes')}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
              placeholder={t('waste.new.optionalNotes')}
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              {t('waste.new.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-[#1B5E20] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#2E7D32] disabled:opacity-50"
            >
              {saving ? t('waste.new.saving') : t('waste.logWaste')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
