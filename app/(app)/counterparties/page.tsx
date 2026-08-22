'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronUp, Tag, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { supabase } from '@/lib/supabase-browser';

type Counterparty = {
  id: string;
  name: string;
  category: string | null;
  default_vat_rate: number | null;
  notes: string | null;
  keywords: string[];
  created_at: string;
};

type CfTx = {
  id: string;
  date: string;
  description: string;
  counterparty: string;
  amount_cents: number;
  direction: 'in' | 'out';
  category: string;
  counterparty_id: string | null;
};

type Bill = {
  id: string;
  supplier_name: string;
  invoice_number: string | null;
  invoice_date: string | null;
  gross_amount: number;
  net_amount: number;
  status: string;
};

const C_CATEGORIES = [
  'C - Personnel','C - Suppliers','C - Rent','C - OpenTable','C - Orderbird',
  'C - Tax Advisor','C - Insurance','C - Energy','C - Marketing',
  'C - Financing','C - Amazon','C - Other',
];
const S_CATEGORIES = ['S - In House','S - Delivery','S - Catering','S - Other'];
const VAT_OPTIONS = [0, 7, 10, 19];

function eur(cents: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
function eurAmt(n: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}
function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function kwMatch(raw: string | null, keywords: string[], name?: string): boolean {
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const terms = keywords.length > 0 ? keywords : (name ? [name] : []);
  return terms.some(kw => kw && lower.includes(kw.toLowerCase()));
}

/* ── Inline panel shown when a counterparty row is expanded ── */
function CpPanel({ cp }: { cp: Counterparty }) {
  const kwParams = useMemo(() => {
    const p = new URLSearchParams();
    for (const kw of (cp.keywords.length > 0 ? cp.keywords : [cp.name])) p.append('keyword', kw);
    return p.toString();
  }, [cp.keywords, cp.name]);

  const { data: txPage, isFetching: txLoading } = useQuery<{ data: CfTx[] }>({
    queryKey: ['cp-txs-all', cp.id, kwParams],
    queryFn: () => fetch(`/api/counterparties/${cp.id}/transactions?${kwParams}`).then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: bills = [], isFetching: billsLoading } = useQuery<Bill[]>({
    queryKey: ['cp-bills-all'],
    queryFn: async () => {
      const { data } = await supabase
        .from('bills')
        .select('id,supplier_name,invoice_number,invoice_date,gross_amount,net_amount,status')
        .order('invoice_date', { ascending: false });
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const matchedTxs = useMemo(() => (txPage?.data ?? []).sort((a, b) => b.date.localeCompare(a.date)), [txPage]);

  const matchedBills = useMemo(() =>
    bills.filter(b => kwMatch(b.supplier_name, cp.keywords, cp.name))
  , [bills, cp.keywords, cp.name]);

  const stats = useMemo(() => {
    let totalIn = 0, totalOut = 0;
    for (const tx of matchedTxs) {
      if (tx.direction === 'in') totalIn += tx.amount_cents;
      else totalOut += tx.amount_cents;
    }
    return { totalIn, totalOut, net: totalIn - totalOut };
  }, [matchedTxs]);

  const loading = txLoading || billsLoading;

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-4 space-y-5 rounded-b-xl">
      {loading ? (
        <div className="py-4 text-center text-gray-400 text-xs">Loading…</div>
      ) : (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-green-600 mb-0.5">
                <TrendingUp size={13} />
                <span className="text-xs font-semibold uppercase tracking-wide">Income</span>
              </div>
              <div className="text-base font-bold text-green-700">{eur(stats.totalIn)}</div>
              <div className="text-xs text-gray-400">{matchedTxs.filter(t => t.direction === 'in').length} tx</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-red-500 mb-0.5">
                <TrendingDown size={13} />
                <span className="text-xs font-semibold uppercase tracking-wide">Costs</span>
              </div>
              <div className="text-base font-bold text-red-600">{eur(stats.totalOut)}</div>
              <div className="text-xs text-gray-400">{matchedTxs.filter(t => t.direction === 'out').length} tx</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-gray-500 mb-0.5">
                <Minus size={13} />
                <span className="text-xs font-semibold uppercase tracking-wide">Net</span>
              </div>
              <div className={`text-base font-bold ${stats.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {eur(Math.abs(stats.net))}
              </div>
              <div className="text-xs text-gray-400">{stats.net >= 0 ? 'Positive' : 'Negative'}</div>
            </div>
          </div>

          {/* Cash Flows */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Cash Flows ({matchedTxs.length})
            </div>
            {matchedTxs.length === 0 ? (
              <div className="text-xs text-gray-400 italic">No matching cash flow transactions.</div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                      <tr>
                        <th className="py-2 px-3 text-left font-semibold text-gray-500 whitespace-nowrap">Date</th>
                        <th className="py-2 px-3 text-left font-semibold text-gray-500">Counterparty (Bank)</th>
                        <th className="py-2 px-3 text-right font-semibold text-gray-500 whitespace-nowrap">Amount</th>
                        <th className="py-2 px-3 text-left font-semibold text-gray-500">Category</th>
                        <th className="py-2 px-3 text-left font-semibold text-gray-500 whitespace-nowrap">Match</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchedTxs.map(tx => {
                        const isIn = tx.direction === 'in';
                        const isPinned = tx.counterparty_id === cp.id;
                        return (
                          <tr key={tx.id} className={`border-b border-gray-50 ${isIn ? 'border-l-2 border-l-green-400' : 'border-l-2 border-l-red-400'}`}>
                            <td className="py-1.5 px-3 font-mono text-gray-500 whitespace-nowrap">{fmtDate(tx.date)}</td>
                            <td className="py-1.5 px-3 max-w-[200px]">
                              <div className="truncate text-gray-800">{tx.counterparty || '—'}</div>
                            </td>
                            <td className={`py-1.5 px-3 text-right font-semibold tabular-nums whitespace-nowrap ${isIn ? 'text-green-700' : 'text-red-600'}`}>
                              {isIn ? '+' : '−'} {eur(tx.amount_cents)}
                            </td>
                            <td className="py-1.5 px-3 text-gray-500 truncate max-w-[120px]">{tx.category || '—'}</td>
                            <td className="py-1.5 px-3">
                              <span className={`px-1.5 py-0.5 rounded-full font-medium ${isPinned ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                                {isPinned ? 'Manual' : 'Auto'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Bills */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Bills ({matchedBills.length})
            </div>
            {matchedBills.length === 0 ? (
              <div className="text-xs text-gray-400 italic">No matching bills.</div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                      <tr>
                        <th className="py-2 px-3 text-left font-semibold text-gray-500 whitespace-nowrap">Date</th>
                        <th className="py-2 px-3 text-left font-semibold text-gray-500">Supplier (Bill)</th>
                        <th className="py-2 px-3 text-left font-semibold text-gray-500">Invoice #</th>
                        <th className="py-2 px-3 text-right font-semibold text-gray-500">Gross</th>
                        <th className="py-2 px-3 text-right font-semibold text-gray-500">Net</th>
                        <th className="py-2 px-3 text-left font-semibold text-gray-500">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchedBills.map(bill => (
                        <tr key={bill.id} className="border-b border-gray-50">
                          <td className="py-1.5 px-3 font-mono text-gray-500 whitespace-nowrap">
                            {bill.invoice_date ? fmtDate(bill.invoice_date) : '—'}
                          </td>
                          <td className="py-1.5 px-3 text-gray-800 max-w-[180px] truncate">{bill.supplier_name}</td>
                          <td className="py-1.5 px-3 text-gray-500">{bill.invoice_number ?? '—'}</td>
                          <td className="py-1.5 px-3 text-right text-red-600 font-semibold tabular-nums whitespace-nowrap">
                            {eurAmt(bill.gross_amount)}
                          </td>
                          <td className="py-1.5 px-3 text-right text-gray-500 tabular-nums whitespace-nowrap">
                            {eurAmt(bill.net_amount)}
                          </td>
                          <td className="py-1.5 px-3">
                            <span className={`px-1.5 py-0.5 rounded-full font-medium ${
                              bill.status === 'approved' ? 'bg-green-100 text-green-700'
                              : bill.status === 'pending' ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-gray-100 text-gray-500'
                            }`}>
                              {bill.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Form ── */
function CounterpartyForm({
  initial, onSave, onCancel, saving,
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
    const keywords = form.keywordsRaw.split(',').map(k => k.trim()).filter(Boolean);
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
            required value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="e.g. OpenTable"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Category</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
            <option value="">— None —</option>
            <optgroup label="── Cost (C) ──">{C_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
            <optgroup label="── Sales (S) ──">{S_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Default VAT %</label>
          <select value={form.default_vat_rate}
            onChange={e => set('default_vat_rate', e.target.value === '' ? '' : Number(e.target.value))}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
            <option value="">— None —</option>
            {VAT_OPTIONS.map(v => <option key={v} value={v}>{v}%</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">
            Keywords <span className="text-gray-400 font-normal">(comma-separated, for auto-matching)</span>
          </label>
          <input value={form.keywordsRaw} onChange={e => set('keywordsRaw', e.target.value)}
            placeholder="OpenTable, OT GMBH, ..."
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-1">Notes</label>
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button type="submit" disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-[#1B5E20] text-white text-sm font-medium rounded-lg hover:bg-[#2E7D32] disabled:opacity-60 transition-colors">
          <Check size={14} /> {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
          <X size={14} /> Cancel
        </button>
      </div>
    </form>
  );
}

/* ── Main page ── */
export default function CounterpartiesPage() {
  const qc = useQueryClient();
  const [adding, setAdding]         = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignedMsg, setAssignedMsg] = useState<string | null>(null);

  const { data: counterparties = [], isLoading } = useQuery<Counterparty[]>({
    queryKey: ['counterparties'],
    queryFn: () => fetch('/api/counterparties').then(r => r.json()),
    staleTime: 30_000,
  });

  const showAssigned = (count: number) => {
    if (count > 0) {
      setAssignedMsg(`✓ ${count} cash flow transaction${count === 1 ? '' : 's'} auto-assigned`);
      setTimeout(() => setAssignedMsg(null), 5000);
    }
    qc.invalidateQueries({ queryKey: ['cashflow-tx'] });
  };

  const createMut = useMutation({
    mutationFn: (body: object) => fetch('/api/counterparties', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.json()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['counterparties'] });
      setAdding(false);
      if (data?.id) setExpandedId(data.id);
      showAssigned(data?.assigned ?? 0);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => fetch(`/api/counterparties/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.json()),
    onSuccess: (data, { id }) => {
      qc.invalidateQueries({ queryKey: ['counterparties'] });
      setEditingId(null);
      setExpandedId(id);
      showAssigned(data?.assigned ?? 0);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => fetch(`/api/counterparties/${id}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['counterparties'] }),
  });

  const handleDelete = (cp: Counterparty) => {
    if (!confirm(`Delete "${cp.name}"? This will also clear any manual assignments in Cash Flow.`)) return;
    if (expandedId === cp.id) setExpandedId(null);
    deleteMut.mutate(cp.id);
  };

  const toggleExpand = (id: string) =>
    setExpandedId(prev => prev === id ? null : id);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Counterparties</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Define named counterparties with keywords for auto-matching against Cash Flow and Bills.
          </p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-medium rounded-lg hover:bg-[#2E7D32] transition-colors">
            <Plus size={16} /> Add Counterparty
          </button>
        )}
      </div>

      {assignedMsg && (
        <div className="mb-4 px-4 py-2.5 bg-green-50 border border-green-200 rounded-lg text-sm font-medium text-green-800">
          {assignedMsg}
        </div>
      )}

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
          {counterparties.map(cp => {
            const isExpanded = expandedId === cp.id;
            return (
              <div key={cp.id} className={`bg-white border rounded-xl overflow-hidden transition-colors ${isExpanded ? 'border-[#1B5E20]/40' : 'border-gray-200 hover:border-gray-300'}`}>
                {editingId === cp.id ? (
                  <div className="p-4">
                    <CounterpartyForm
                      initial={cp}
                      onSave={data => updateMut.mutate({ id: cp.id, body: data })}
                      onCancel={() => setEditingId(null)}
                      saving={updateMut.isPending}
                    />
                  </div>
                ) : (
                  <>
                    {/* Header row */}
                    <div className="px-4 py-3 flex items-start gap-3">
                      {/* Expand toggle */}
                      <button
                        onClick={() => toggleExpand(cp.id)}
                        className="flex-shrink-0 mt-0.5 text-gray-400 hover:text-[#1B5E20] transition-colors"
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>

                      {/* Info */}
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(cp.id)}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900">{cp.name}</span>
                          {cp.category && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                              cp.category.startsWith('C - ') ? 'bg-red-100 text-gray-700' : 'bg-green-100 text-gray-700'
                            }`}>{cp.category}</span>
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
                              <span key={kw} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{kw}</span>
                            ))}
                          </div>
                        )}
                        {cp.notes && <div className="text-xs text-gray-400 mt-1 truncate">{cp.notes}</div>}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => { setEditingId(cp.id); setExpandedId(null); }}
                          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDelete(cp)} disabled={deleteMut.isPending}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Expandable panel */}
                    {isExpanded && <CpPanel cp={cp} />}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
