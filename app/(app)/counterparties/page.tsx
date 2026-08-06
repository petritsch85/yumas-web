'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Check, ChevronRight, Tag } from 'lucide-react';
import Link from 'next/link';

type Counterparty = {
  id: string;
  name: string;
  category: string | null;
  default_vat_rate: number | null;
  notes: string | null;
  keywords: string[];
  created_at: string;
};

const C_CATEGORIES = [
  'C - Personnel','C - Suppliers','C - Rent','C - OpenTable','C - Orderbird',
  'C - Tax Advisor','C - Insurance','C - Energy','C - Marketing',
  'C - Financing','C - Amazon','C - Other',
];
const S_CATEGORIES = ['S - In House','S - Delivery','S - Catering','S - Other'];
const ALL_CATEGORIES = [...C_CATEGORIES, ...S_CATEGORIES];
const VAT_OPTIONS = [0, 7, 10, 19];

const EMPTY_FORM = { name: '', category: '', default_vat_rate: '' as '' | number, notes: '', keywordsRaw: '' };

function CounterpartyForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Counterparty;
  onSave: (data: { name: string; category: string; default_vat_rate: number | null; notes: string; keywords: string[] }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    name:             initial?.name ?? '',
    category:         initial?.category ?? '',
    default_vat_rate: initial?.default_vat_rate ?? ('' as '' | number),
    notes:            initial?.notes ?? '',
    keywordsRaw:      (initial?.keywords ?? []).join(', '),
  });

  const set = (k: keyof typeof form, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const keywords = form.keywordsRaw
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);
    onSave({
      name: form.name.trim(),
      category: form.category,
      default_vat_rate: form.default_vat_rate === '' ? null : Number(form.default_vat_rate),
      notes: form.notes.trim(),
      keywords,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Name *</label>
          <input
            required
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. OpenTable"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Category</label>
          <select
            value={form.category}
            onChange={e => set('category', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
          >
            <option value="">— None —</option>
            <optgroup label="── Cost (C) ──">
              {C_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </optgroup>
            <optgroup label="── Sales (S) ──">
              {S_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </optgroup>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Default VAT %</label>
          <select
            value={form.default_vat_rate}
            onChange={e => set('default_vat_rate', e.target.value === '' ? '' : Number(e.target.value))}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
          >
            <option value="">— None —</option>
            {VAT_OPTIONS.map(v => <option key={v} value={v}>{v}%</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">
            Keywords <span className="text-gray-400 font-normal">(comma-separated, used for auto-matching)</span>
          </label>
          <input
            value={form.keywordsRaw}
            onChange={e => set('keywordsRaw', e.target.value)}
            placeholder="OpenTable, OT GMBH, ..."
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-1">Notes</label>
        <textarea
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          rows={2}
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-[#1B5E20] text-white text-sm font-medium rounded-lg hover:bg-[#2E7D32] disabled:opacity-60 transition-colors"
        >
          <Check size={14} /> {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
        >
          <X size={14} /> Cancel
        </button>
      </div>
    </form>
  );
}

export default function CounterpartiesPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: counterparties = [], isLoading } = useQuery<Counterparty[]>({
    queryKey: ['counterparties'],
    queryFn: () => fetch('/api/counterparties').then(r => r.json()),
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: (body: object) => fetch('/api/counterparties', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['counterparties'] }); setAdding(false); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => fetch(`/api/counterparties/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['counterparties'] }); setEditingId(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => fetch(`/api/counterparties/${id}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['counterparties'] }),
  });

  const handleDelete = (cp: Counterparty) => {
    if (!confirm(`Delete "${cp.name}"? This will also clear any manual assignments in Cash Flow.`)) return;
    deleteMut.mutate(cp.id);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Counterparties</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Define named counterparties with keywords for auto-matching against Cash Flow transactions.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-medium rounded-lg hover:bg-[#2E7D32] transition-colors"
          >
            <Plus size={16} /> Add Counterparty
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-4">
          <CounterpartyForm
            onSave={data => createMut.mutate(data)}
            onCancel={() => setAdding(false)}
            saving={createMut.isPending}
          />
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
      ) : counterparties.length === 0 && !adding ? (
        <div className="py-16 text-center">
          <div className="text-gray-300 mb-3"><Tag size={40} className="mx-auto" /></div>
          <div className="text-gray-500 font-medium">No counterparties yet</div>
          <div className="text-gray-400 text-sm mt-1">Add your first one to start matching Cash Flow transactions.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {counterparties.map(cp => (
            <div key={cp.id}>
              {editingId === cp.id ? (
                <CounterpartyForm
                  initial={cp}
                  onSave={data => updateMut.mutate({ id: cp.id, body: data })}
                  onCancel={() => setEditingId(null)}
                  saving={updateMut.isPending}
                />
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start gap-4 hover:border-gray-300 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/counterparties/${cp.id}`}
                        className="font-semibold text-gray-900 hover:text-[#1B5E20] transition-colors"
                      >
                        {cp.name}
                      </Link>
                      {cp.category && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          cp.category.startsWith('C - ') ? 'bg-red-100 text-gray-700' : 'bg-green-100 text-gray-700'
                        }`}>
                          {cp.category}
                        </span>
                      )}
                      {cp.default_vat_rate != null && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                          {cp.default_vat_rate}% VAT
                        </span>
                      )}
                    </div>
                    {cp.keywords.length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        <Tag size={11} className="text-gray-400 flex-shrink-0" />
                        {cp.keywords.map(kw => (
                          <span key={kw} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                    {cp.notes && (
                      <div className="text-xs text-gray-400 mt-1 truncate">{cp.notes}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Link
                      href={`/counterparties/${cp.id}`}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#1B5E20] px-2 py-1 rounded transition-colors"
                    >
                      View <ChevronRight size={12} />
                    </Link>
                    <button
                      onClick={() => setEditingId(cp.id)}
                      className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(cp)}
                      disabled={deleteMut.isPending}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
