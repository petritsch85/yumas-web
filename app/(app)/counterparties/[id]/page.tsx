'use client';

import { use, useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, TrendingUp, TrendingDown, Minus, Tag, Check, Save } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase-browser';

type Counterparty = {
  id: string;
  name: string;
  category: string | null;
  default_vat_rate: number | null;
  notes: string | null;
  keywords: string[];
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
  vat_amount: number;
  category: string | null;
  status: string;
};

const C_CATEGORIES = [
  'C - Personnel','C - Suppliers','C - Rent','C - OpenTable','C - Orderbird',
  'C - Tax Advisor','C - Insurance','C - Energy','C - Marketing',
  'C - Financing','C - Amazon','C - Other',
];
const S_CATEGORIES = ['S - In House','S - Delivery','S - Catering','S - Other'];
const VAT_OPTIONS = [0, 7, 10, 19];

const YEARS = [2024, 2025, 2026, 2027];
type Period = 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'H1' | 'H2' | 'Jan' | 'Feb' | 'Mar' | 'Apr' | 'May' | 'Jun' | 'Jul' | 'Aug' | 'Sep' | 'Oct' | 'Nov' | 'Dec';
const QUARTER_PERIODS: Record<string, Period[]> = {
  Q1: ['Jan','Feb','Mar'], Q2: ['Apr','May','Jun'],
  Q3: ['Jul','Aug','Sep'], Q4: ['Oct','Nov','Dec'],
  H1: ['Jan','Feb','Mar','Apr','May','Jun'],
  H2: ['Jul','Aug','Sep','Oct','Nov','Dec'],
};
const MONTH_NUM: Record<string, number> = {
  Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12,
};

function periodDateRange(year: number, period: Period) {
  if (period === 'All') return null;
  if (period in QUARTER_PERIODS) {
    const months = QUARTER_PERIODS[period];
    const first = MONTH_NUM[months[0]];
    const last  = MONTH_NUM[months[months.length - 1]];
    return {
      dateFrom: `${year}-${String(first).padStart(2,'0')}-01`,
      dateTo:   `${year}-${String(last).padStart(2,'0')}-${new Date(year, last, 0).getDate()}`,
    };
  }
  const m = MONTH_NUM[period];
  return {
    dateFrom: `${year}-${String(m).padStart(2,'0')}-01`,
    dateTo:   `${year}-${String(m).padStart(2,'0')}-${new Date(year, m, 0).getDate()}`,
  };
}

function eur(cents: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
function eurAmt(euros: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(euros);
}
function fmtDate(iso: string) {
  const [y,m,d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function kwMatch(raw: string | null, keywords: string[], name?: string): boolean {
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const terms = keywords.length > 0 ? keywords : (name ? [name] : []);
  return terms.some(kw => kw && lower.includes(kw.toLowerCase()));
}

export default function CounterpartyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();

  const [year, setYear]     = useState(new Date().getFullYear());
  const [period, setPeriod] = useState<Period>('All');
  const [activeTab, setActiveTab] = useState<'cashflow' | 'bills'>('cashflow');
  const [saved, setSaved]   = useState(false);

  const { data: cp, isLoading: cpLoading } = useQuery<Counterparty>({
    queryKey: ['counterparty', id],
    queryFn: () => fetch(`/api/counterparties/${id}`).then(r => r.json()),
    staleTime: 30_000,
  });

  // Editable form state — synced from cp once loaded
  const [form, setForm] = useState({
    name: '', category: '', default_vat_rate: '' as '' | number, notes: '', keywordsRaw: '',
  });
  useEffect(() => {
    if (cp) setForm({
      name:             cp.name,
      category:         cp.category ?? '',
      default_vat_rate: cp.default_vat_rate ?? '',
      notes:            cp.notes ?? '',
      keywordsRaw:      (cp.keywords ?? []).join(', '),
    });
  }, [cp]);
  const setF = (k: keyof typeof form, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: (body: object) => fetch(`/api/counterparties/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['counterparty', id] });
      qc.invalidateQueries({ queryKey: ['counterparties'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const keywords = form.keywordsRaw.split(',').map(k => k.trim()).filter(Boolean);
    saveMut.mutate({
      name: form.name.trim(),
      category: form.category,
      default_vat_rate: form.default_vat_rate === '' ? null : Number(form.default_vat_rate),
      notes: form.notes.trim(),
      keywords,
    });
  };

  // Derive current keywords from form (for live matching)
  const currentKeywords = useMemo(() =>
    form.keywordsRaw.split(',').map(k => k.trim()).filter(Boolean),
  [form.keywordsRaw]);

  const dateRange = periodDateRange(year, period);

  const txParams = useMemo(() => {
    const p = new URLSearchParams();
    if (dateRange) { p.set('dateFrom', dateRange.dateFrom); p.set('dateTo', dateRange.dateTo); }
    return p.toString();
  }, [dateRange]);

  const { data: txPage, isFetching: txLoading } = useQuery<{ data: CfTx[] }>({
    queryKey: ['cp-txs', id, txParams],
    queryFn: async () => {
      const first = await fetch(`/api/cashflow/transactions?${txParams}&page=1`).then(r => r.json());
      const effectivePageSize = first.data?.length ?? 0;
      if (effectivePageSize === 0 || effectivePageSize >= first.count) return first;
      const totalPages = Math.ceil(first.count / effectivePageSize);
      // Use effectivePageSize (actual rows Supabase returned) for subsequent page offsets
      const rest = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) =>
          fetch(`/api/cashflow/transactions?${txParams}&page=${i + 2}&pageSize=${effectivePageSize}`).then(r => r.json())
        )
      );
      return { ...first, data: [...first.data, ...rest.flatMap((p: { data: CfTx[] }) => p.data)] };
    },
    staleTime: 30_000,
    enabled: !!cp,
  });

  const { data: allBills = [], isFetching: billsLoading } = useQuery<Bill[]>({
    queryKey: ['bills-list'],
    queryFn: async () => {
      const { data } = await supabase
        .from('bills')
        .select('id,supplier_name,invoice_number,invoice_date,gross_amount,net_amount,vat_amount,category,status')
        .order('invoice_date', { ascending: false });
      return data ?? [];
    },
    staleTime: 60_000,
    enabled: activeTab === 'bills',
  });

  const matchedTxs = useMemo(() => {
    if (!txPage?.data) return [];
    return txPage.data.filter(tx =>
      tx.counterparty_id === id || kwMatch(tx.counterparty, currentKeywords, cp?.name)
    );
  }, [txPage, id, currentKeywords]);

  const matchedBills = useMemo(() =>
    allBills.filter(b => kwMatch(b.supplier_name, currentKeywords, cp?.name)),
  [allBills, currentKeywords, cp?.name]);

  const stats = useMemo(() => {
    let totalIn = 0, totalOut = 0;
    for (const tx of matchedTxs) {
      if (tx.direction === 'in') totalIn += tx.amount_cents;
      else totalOut += tx.amount_cents;
    }
    return { totalIn, totalOut, net: totalIn - totalOut };
  }, [matchedTxs]);

  const QUARTERS: Period[] = ['Q1','Q2','Q3','Q4'];
  const MONTHS: Period[]   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  if (cpLoading) {
    return <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>;
  }
  if (!cp) {
    return <div className="py-16 text-center text-gray-400 text-sm">Counterparty not found.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Back */}
      <Link href="/counterparties" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-5">
        <ArrowLeft size={14} /> Counterparties
      </Link>

      {/* ── Editable details form ── */}
      <form onSubmit={handleSave} className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">{form.name || cp.name}</h1>
          <button
            type="submit"
            disabled={saveMut.isPending}
            className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              saved
                ? 'bg-green-600 text-white'
                : 'bg-[#1B5E20] text-white hover:bg-[#2E7D32] disabled:opacity-60'
            }`}
          >
            {saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> Save Changes</>}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Name *</label>
            <input
              required value={form.name} onChange={e => setF('name', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Category</label>
            <select value={form.category} onChange={e => setF('category', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
              <option value="">— None —</option>
              <optgroup label="── Cost (C) ──">{C_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="── Sales (S) ──">{S_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Default VAT %</label>
            <select value={form.default_vat_rate}
              onChange={e => setF('default_vat_rate', e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
              <option value="">— None —</option>
              {VAT_OPTIONS.map(v => <option key={v} value={v}>{v}%</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Keywords <span className="text-gray-400 font-normal">(comma-separated, for auto-matching)</span>
            </label>
            <input value={form.keywordsRaw} onChange={e => setF('keywordsRaw', e.target.value)}
              placeholder="OpenTable, OT GMBH, ..."
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-gray-600 block mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setF('notes', e.target.value)} rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>
        </div>

        {currentKeywords.length > 0 && (
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            <Tag size={12} className="text-gray-400" />
            <span className="text-xs text-gray-400">Matching on:</span>
            {currentKeywords.map(kw => (
              <span key={kw} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{kw}</span>
            ))}
          </div>
        )}
      </form>

      {/* ── Period selector ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <div className="h-5 w-px bg-gray-200" />
          {(['All', ...QUARTERS, 'H1', 'H2'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                period === p ? 'bg-[#1B5E20] text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}>{p}</button>
          ))}
          <div className="h-5 w-px bg-gray-200" />
          {MONTHS.map(m => (
            <button key={m} onClick={() => setPeriod(m)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                period === m ? 'bg-[#1B5E20] text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}>{m}</button>
          ))}
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-green-600 mb-1">
            <TrendingUp size={16} />
            <span className="text-xs font-semibold uppercase tracking-wide">Income</span>
          </div>
          <div className="text-xl font-bold text-green-700">{eur(stats.totalIn)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{matchedTxs.filter(t => t.direction === 'in').length} transactions</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-red-600 mb-1">
            <TrendingDown size={16} />
            <span className="text-xs font-semibold uppercase tracking-wide">Costs</span>
          </div>
          <div className="text-xl font-bold text-red-700">{eur(stats.totalOut)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{matchedTxs.filter(t => t.direction === 'out').length} transactions</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-600 mb-1">
            <Minus size={16} />
            <span className="text-xs font-semibold uppercase tracking-wide">Net</span>
          </div>
          <div className={`text-xl font-bold ${stats.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {eur(Math.abs(stats.net))}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">{stats.net >= 0 ? 'Positive' : 'Negative'}</div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
        {(['cashflow', 'bills'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {tab === 'cashflow' ? `Cash Flow (${matchedTxs.length})` : `Bills (${matchedBills.length})`}
          </button>
        ))}
      </div>

      {/* ── Cash Flow tab ── */}
      {activeTab === 'cashflow' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {txLoading ? (
            <div className="py-10 text-center text-gray-400 text-sm">Loading transactions…</div>
          ) : matchedTxs.length === 0 ? (
            <div className="py-10 text-center text-gray-400 text-sm">
              No matching transactions.{currentKeywords.length === 0 && ' Add keywords above to auto-match transactions.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left whitespace-nowrap">Date</th>
                    <th className="py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">Counterparty (Bank)</th>
                    <th className="py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right whitespace-nowrap">Amount Brutto</th>
                    <th className="py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">Category</th>
                    <th className="py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {matchedTxs.map(tx => {
                    const isIn     = tx.direction === 'in';
                    const isPinned = tx.counterparty_id === id;
                    return (
                      <tr key={tx.id} className={`border-b border-gray-100 ${isIn ? 'border-l-2 border-l-green-400' : 'border-l-2 border-l-red-400'}`}>
                        <td className="py-2 px-3 text-gray-500 whitespace-nowrap font-mono text-xs">{fmtDate(tx.date)}</td>
                        <td className="py-2 px-3 max-w-[240px]">
                          <div className="truncate text-gray-900 text-xs">{tx.counterparty || '—'}</div>
                          {tx.description && (
                            <div className="truncate text-gray-400 text-xs mt-0.5">{tx.description.slice(0, 80)}</div>
                          )}
                        </td>
                        <td className={`py-2 px-3 text-right whitespace-nowrap font-semibold tabular-nums ${isIn ? 'text-green-700' : 'text-red-700'}`}>
                          {isIn ? '+' : '−'} {eur(tx.amount_cents)}
                        </td>
                        <td className="py-2 px-3">
                          {tx.category && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                              tx.category.startsWith('C - ') ? 'bg-red-100 text-gray-700' : 'bg-green-100 text-gray-700'
                            }`}>{tx.category}</span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                            isPinned ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {isPinned ? 'Manual' : 'Auto'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Bills tab ── */}
      {activeTab === 'bills' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {billsLoading ? (
            <div className="py-10 text-center text-gray-400 text-sm">Loading bills…</div>
          ) : matchedBills.length === 0 ? (
            <div className="py-10 text-center text-gray-400 text-sm">
              No matching bills.{currentKeywords.length === 0 && ' Add keywords above to auto-match bills.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left whitespace-nowrap">Date</th>
                    <th className="py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">Supplier</th>
                    <th className="py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">Invoice #</th>
                    <th className="py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Gross</th>
                    <th className="py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Net</th>
                    <th className="py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {matchedBills.map(bill => (
                    <tr key={bill.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 text-gray-500 whitespace-nowrap font-mono text-xs">
                        {bill.invoice_date ? fmtDate(bill.invoice_date) : '—'}
                      </td>
                      <td className="py-2 px-3 text-gray-900 text-xs max-w-[200px] truncate">{bill.supplier_name}</td>
                      <td className="py-2 px-3 text-gray-500 text-xs">{bill.invoice_number ?? '—'}</td>
                      <td className="py-2 px-3 text-right text-red-700 font-semibold tabular-nums">
                        {eurAmt(bill.gross_amount)}
                      </td>
                      <td className="py-2 px-3 text-right text-gray-600 tabular-nums text-xs">
                        {eurAmt(bill.net_amount)}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          bill.status === 'approved' ? 'bg-green-100 text-green-700'
                          : bill.status === 'pending' ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-gray-100 text-gray-500'
                        }`}>{bill.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
