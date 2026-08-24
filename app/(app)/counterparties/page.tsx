'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronUp, Tag, TrendingUp, TrendingDown, Minus, Link2 } from 'lucide-react';
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

type BillLink = {
  id: string;
  note: string | null;
  bill: { id: string; supplier_name: string; invoice_number: string | null; gross_amount: number } | null;
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
  bill: { id: string; supplier_name: string; invoice_number: string | null } | null;
  transaction_bill_links: BillLink[];
};

type Bill = {
  id: string;
  supplier_name: string;
  invoice_number: string | null;
  invoice_date: string | null;
  gross_amount: number;
  net_amount: number;
  status: string;
  cashflow_transactions: { id: string }[];
  transaction_bill_links: { id: string; transaction_id: string }[];
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

/* ── Modal: link one transaction to multiple bills ── */
function LinkBillsModal({ tx, bills, onClose, onSave }: {
  tx: CfTx;
  bills: Bill[];
  onClose: () => void;
  onSave: (billIds: string[], note: string) => Promise<void>;
}) {
  // Pre-populate with bills already linked to this specific transaction
  const [selected, setSelected] = useState<Set<string>>(() =>
    new Set(bills.filter(b => b.transaction_bill_links.some(l => l.transaction_id === tx.id)).map(b => b.id))
  );
  const [note, setNote]         = useState('');
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const txAmt = Math.abs(tx.amount_cents) / 100;
  const selectedTotal = bills.filter(b => selected.has(b.id)).reduce((s, b) => s + b.gross_amount, 0);
  const diff = Math.abs(selectedTotal - txAmt);

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleSave = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave([...selected], note);
    } catch (e: any) {
      setSaveError(e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-900">Link bills to transaction</h2>
          <button onClick={onClose}><X size={16} className="text-gray-400" /></button>
        </div>
        <div className="text-xs text-gray-500 mb-4 bg-gray-50 rounded-lg px-3 py-2">
          {fmtDate(tx.date)} · <span className="font-semibold text-red-700">{eur(tx.amount_cents)}</span>
          {tx.counterparty && <span className="ml-2 text-gray-400">· {tx.counterparty}</span>}
        </div>

        <div className="space-y-1.5 max-h-64 overflow-y-auto mb-3">
          {bills.length === 0 && <div className="text-xs text-gray-400 italic py-2">No available bills for this counterparty.</div>}
          {bills.map(bill => {
            // Block bills that are directly matched to another CF, or junction-linked to a different transaction
            const linkedToThisTx  = bill.transaction_bill_links.some(l => l.transaction_id === tx.id);
            const linkedElsewhere = bill.cashflow_transactions.length > 0 ||
              bill.transaction_bill_links.some(l => l.transaction_id !== tx.id);
            const alreadyLinked = !linkedToThisTx && linkedElsewhere;
            return (
              <label key={bill.id} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer ${alreadyLinked ? 'opacity-50 border-gray-100 bg-gray-50' : 'border-gray-100 hover:bg-gray-50'}`}>
                <input type="checkbox" checked={selected.has(bill.id)} onChange={() => !alreadyLinked && toggle(bill.id)}
                  disabled={alreadyLinked} className="w-4 h-4 accent-green-600" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-800 truncate">{bill.supplier_name}</div>
                  <div className="text-xs text-gray-400">{bill.invoice_number ?? '—'} · {bill.invoice_date ? fmtDate(bill.invoice_date) : '—'}
                    {alreadyLinked && <span className="ml-1 text-green-600">· already linked</span>}
                  </div>
                </div>
                <div className="text-xs font-semibold text-red-700 whitespace-nowrap">{eurAmt(bill.gross_amount)}</div>
              </label>
            );
          })}
        </div>

        {selected.size > 0 && (
          <div className={`text-xs mb-3 px-3 py-2 rounded-lg ${diff <= 0.02 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
            Selected: {eurAmt(selectedTotal)} · Transaction: {eurAmt(txAmt)}
            {diff > 0.02 && ` · Difference: ${eurAmt(diff)}`}
          </div>
        )}

        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Note (optional) — e.g. supplier combined two invoices into one payment"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-green-500 mb-4" />

        {saveError && (
          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            Save failed: {saveError}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={selected.size === 0 || saving}
            className="px-4 py-2 text-xs font-medium bg-[#1B5E20] text-white rounded-lg hover:bg-[#2E7D32] disabled:opacity-60">
            {saving ? 'Saving…' : `Link ${selected.size} bill${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Chart helpers ── */
function niceNum(v: number) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}
function yTicks(maxVal: number, n = 5): number[] {
  const step = niceNum(maxVal / n);
  const ticks: number[] = [];
  for (let v = 0; v <= maxVal + step * 0.01; v += step) ticks.push(Math.round(v));
  return ticks;
}
function monthTicks(lo: Date, hi: Date): Date[] {
  const ticks: Date[] = [];
  let cur = new Date(lo.getFullYear(), lo.getMonth(), 1);
  const end = new Date(hi.getFullYear(), hi.getMonth() + 1, 1);
  while (cur < end) { ticks.push(new Date(cur)); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); }
  return ticks;
}
function fmtAmt(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : String(Math.round(v));
}
function fmtMo(d: Date) {
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

function CpChart({ bills }: { bills: Bill[] }) {
  const ML = 52, MR = 16, MT = 20, MB = 38;
  const VW = 780, VH = 220;
  const cW = VW - ML - MR, cH = VH - MT - MB;

  // Aggregate bills by invoice month, sum net_amount
  const pts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of bills) {
      if (!b.invoice_date) continue;
      const ym = b.invoice_date.slice(0, 7); // YYYY-MM
      map.set(ym, (map.get(ym) ?? 0) + b.net_amount);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, total]) => ({
        d: new Date(ym + '-01T00:00:00'),
        v: total,
        lbl: `${ym}  Net €${total.toFixed(2)}`,
      }));
  }, [bills]);

  if (pts.length === 0) return null;

  const allMs  = pts.map(p => p.d.getTime());
  const allVs  = pts.map(p => p.v);
  const loMs   = Math.min(...allMs), hiMs = Math.max(...allMs);
  const span   = hiMs - loMs || 86400000 * 30;
  const padMs  = span * 0.06;
  const minMs  = loMs - padMs, maxMs = hiMs + padMs;
  const maxVal = niceNum(Math.max(...allVs, 1) * 1.1);

  const sx = (ms: number) => ((ms - minMs) / (maxMs - minMs)) * cW;
  const sy = (v: number)  => cH - (v / maxVal) * cH;
  const linePath = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.d.getTime()).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ');

  let mTicks = monthTicks(new Date(minMs), new Date(maxMs));
  const step = Math.ceil(mTicks.length / 10);
  if (step > 1) mTicks = mTicks.filter((_, i) => i % step === 0);

  const yT = yTicks(maxVal);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 overflow-x-auto">
      <div className="flex items-center gap-4 mb-2 px-1">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Timeline</span>
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="w-3 h-0.5 bg-red-500 inline-block rounded" />
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
          Monthly bills (net ex-VAT)
        </span>
      </div>
      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', minWidth: 380, display: 'block' }}>
        <g transform={`translate(${ML},${MT})`}>
          {yT.map(v => (
            <g key={v}>
              <line x1={0} y1={sy(v)} x2={cW} y2={sy(v)} stroke="#f3f4f6" strokeWidth={1} />
              <text x={-6} y={sy(v) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{fmtAmt(v)}</text>
            </g>
          ))}
          <line x1={0} y1={0} x2={0} y2={cH} stroke="#e5e7eb" strokeWidth={1} />
          <line x1={0} y1={cH} x2={cW} y2={cH} stroke="#e5e7eb" strokeWidth={1} />
          {mTicks.map((d, i) => (
            <g key={i} transform={`translate(${sx(d.getTime()).toFixed(1)},${cH})`}>
              <line y2={4} stroke="#e5e7eb" strokeWidth={1} />
              <text y={16} textAnchor="middle" fontSize={10} fill="#9ca3af">{fmtMo(d)}</text>
            </g>
          ))}
          {pts.length > 1 && (
            <path d={linePath} fill="none" stroke="#ef4444" strokeWidth={2.5} strokeLinejoin="round" />
          )}
          {pts.map((p, i) => (
            <circle key={i} cx={sx(p.d.getTime())} cy={sy(p.v)} r={5} fill="#ef4444" stroke="white" strokeWidth={2}>
              <title>{p.lbl}</title>
            </circle>
          ))}
        </g>
      </svg>
    </div>
  );
}

/* ── Sortable column header ── */
type SortDir = 'asc' | 'desc';
function SortTh({ col, label, active, dir, align = 'left', onSort }: {
  col: string; label: string; active: boolean; dir: SortDir;
  align?: 'left' | 'right' | 'center'; onSort: (col: string) => void;
}) {
  return (
    <th onClick={() => onSort(col)}
      className={`py-2 px-3 font-semibold text-gray-500 whitespace-nowrap cursor-pointer select-none hover:text-gray-700 text-${align}`}>
      <span className={`inline-flex items-center gap-0.5 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {active
          ? (dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)
          : <ChevronDown size={10} className="opacity-20" />}
      </span>
    </th>
  );
}

/* ── Inline panel shown when a counterparty row is expanded ── */
function CpPanel({ cp }: { cp: Counterparty }) {
  const qc = useQueryClient();
  const [activeLinkTx, setActiveLinkTx] = useState<CfTx | null>(null);
  const [txSort,   setTxSort]   = useState<{ col: string; dir: SortDir }>({ col: 'date', dir: 'desc' });
  const [billSort, setBillSort] = useState<{ col: string; dir: SortDir }>({ col: 'date', dir: 'desc' });

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
        .select('id,supplier_name,invoice_number,invoice_date,gross_amount,net_amount,status,cashflow_transactions(id),transaction_bill_links(id,transaction_id)')
        .order('invoice_date', { ascending: false });
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const matchedTxs = useMemo(() => txPage?.data ?? [], [txPage]);

  const txIds = useMemo(() => matchedTxs.map(t => t.id), [matchedTxs]);

  // Bill ids that have a cash flow linked, taken from the admin-fetched transaction
  // data. The browser-side queries below go through RLS and can come back empty,
  // so this is the source the Cash Flow column trusts first.
  const linkedBillIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tx of matchedTxs) {
      if (tx.bill?.id) ids.add(tx.bill.id);
      for (const l of tx.transaction_bill_links ?? []) {
        if (l.bill?.id) ids.add(l.bill.id);
      }
    }
    return ids;
  }, [matchedTxs]);

  const { data: billLinks = [] } = useQuery<{ id: string; transaction_id: string; bill_id: string; note: string | null }[]>({
    queryKey: ['tx-bill-links', cp.id, kwParams],
    queryFn: async () => {
      if (txIds.length === 0) return [];
      const { data } = await supabase
        .from('transaction_bill_links')
        .select('id, transaction_id, bill_id, note')
        .in('transaction_id', txIds);
      return data ?? [];
    },
    enabled: txIds.length > 0,
    staleTime: 0,
  });

  const matchedBills = useMemo(() =>
    bills.filter(b => kwMatch(b.supplier_name, cp.keywords, cp.name))
  , [bills, cp.keywords, cp.name]);

  const toggleTxSort   = (col: string) => setTxSort(s   => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }));
  const toggleBillSort = (col: string) => setBillSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }));

  const sortedTxs = useMemo(() => {
    const arr = [...matchedTxs];
    arr.sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (txSort.col) {
        case 'counterparty': av = a.counterparty ?? ''; bv = b.counterparty ?? ''; break;
        case 'amount':       av = a.amount_cents;      bv = b.amount_cents;       break;
        case 'category':     av = a.category ?? '';    bv = b.category ?? '';     break;
        default:             av = a.date;              bv = b.date;               break;
      }
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return txSort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [matchedTxs, txSort]);

  const sortedBills = useMemo(() => {
    const arr = [...matchedBills];
    arr.sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (billSort.col) {
        case 'supplier':        av = a.supplier_name;       bv = b.supplier_name;       break;
        case 'invoice_number':  av = a.invoice_number ?? ''; bv = b.invoice_number ?? ''; break;
        case 'gross':           av = a.gross_amount;         bv = b.gross_amount;         break;
        case 'net':             av = a.net_amount;           bv = b.net_amount;           break;
        case 'status':          av = a.status;               bv = b.status;               break;
        default:                av = a.invoice_date ?? '';   bv = b.invoice_date ?? '';   break;
      }
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return billSort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [matchedBills, billSort]);

  const stats = useMemo(() => {
    let totalIn = 0, totalOut = 0;
    for (const tx of matchedTxs) {
      if (tx.direction === 'in') totalIn += tx.amount_cents;
      else totalOut += tx.amount_cents;
    }
    return { totalIn, totalOut, net: totalIn - totalOut };
  }, [matchedTxs]);

  const handleSaveLinks = async (billIds: string[], note: string) => {
    if (!activeLinkTx) return;
    const res = await fetch('/api/transaction-bill-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: activeLinkTx.id, billIds, note }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
    setActiveLinkTx(null);
    await Promise.all([
      qc.refetchQueries({ queryKey: ['cp-txs-all', cp.id, kwParams] }),
      qc.refetchQueries({ queryKey: ['cp-bills-all'] }),
      qc.refetchQueries({ queryKey: ['tx-bill-links', cp.id, kwParams] }),
    ]);
  };

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
                        <SortTh col="date"         label="Date"                 active={txSort.col==='date'}         dir={txSort.dir} onSort={toggleTxSort} />
                        <SortTh col="counterparty" label="Counterparty (Bank)"  active={txSort.col==='counterparty'} dir={txSort.dir} onSort={toggleTxSort} />
                        <SortTh col="amount"       label="Amount"               active={txSort.col==='amount'}       dir={txSort.dir} onSort={toggleTxSort} align="right" />
                        <SortTh col="category"     label="Category"             active={txSort.col==='category'}     dir={txSort.dir} onSort={toggleTxSort} />
                        <th className="py-2 px-3 text-left font-semibold text-gray-500 whitespace-nowrap">Match</th>
                        <th className="py-2 px-3 text-center font-semibold text-gray-500 whitespace-nowrap">Bill</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTxs.map(tx => {
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
                            <td className="py-1.5 px-3 text-center">
                              {(() => {
                                // Use embedded junction links from admin-fetched tx data (most reliable)
                                const embeddedLinks = tx.transaction_bill_links ?? [];
                                const queryLinks    = billLinks.filter(l => l.transaction_id === tx.id);
                                const linkedCount   = embeddedLinks.length > 0 ? embeddedLinks.length : queryLinks.length;
                                if (tx.bill) return (
                                  <span title={tx.bill.supplier_name + (tx.bill.invoice_number ? ' · ' + tx.bill.invoice_number : '')} className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100"><Check size={11} className="text-green-600" /></span>
                                );
                                if (linkedCount > 0) return (
                                  <button onClick={() => setActiveLinkTx(tx)} title="Edit bill links"
                                    className="inline-flex items-center justify-center gap-0.5 px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold whitespace-nowrap hover:bg-green-200 transition-colors">
                                    {linkedCount} bill{linkedCount !== 1 ? 's' : ''} <Check size={10} className="text-green-600" />
                                  </button>
                                );
                                return (
                                  <div className="flex items-center justify-center gap-1">
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100"><X size={11} className="text-red-500" /></span>
                                    <button onClick={() => setActiveLinkTx(tx)} title="Link to bill(s)"
                                      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 hover:bg-blue-100 hover:text-blue-600 text-gray-400 transition-colors">
                                      <Link2 size={10} />
                                    </button>
                                  </div>
                                );
                              })()}
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
                        <SortTh col="date"           label="Date"             active={billSort.col==='date'}           dir={billSort.dir} onSort={toggleBillSort} />
                        <SortTh col="supplier"       label="Supplier (Bill)"  active={billSort.col==='supplier'}       dir={billSort.dir} onSort={toggleBillSort} />
                        <SortTh col="invoice_number" label="Invoice #"        active={billSort.col==='invoice_number'} dir={billSort.dir} onSort={toggleBillSort} />
                        <SortTh col="gross"          label="Gross"            active={billSort.col==='gross'}          dir={billSort.dir} onSort={toggleBillSort} align="right" />
                        <SortTh col="net"            label="Net"              active={billSort.col==='net'}            dir={billSort.dir} onSort={toggleBillSort} align="right" />
                        <SortTh col="status"         label="Status"           active={billSort.col==='status'}         dir={billSort.dir} onSort={toggleBillSort} />
                        <th className="py-2 px-3 text-center font-semibold text-gray-500 whitespace-nowrap">Cash Flow</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedBills.map(bill => {
                        const linked =
                          linkedBillIds.has(bill.id) ||
                          (bill.cashflow_transactions?.length ?? 0) > 0 ||
                          (bill.transaction_bill_links?.length ?? 0) > 0 ||
                          billLinks.some(l => l.bill_id === bill.id);
                        return (
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
                          <td className="py-1.5 px-3 text-center">
                            {linked
                              ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100"><Check size={11} className="text-green-600" /></span>
                              : <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100"><X size={11} className="text-red-500" /></span>
                            }
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

          {/* Timeline chart */}
          {matchedBills.length > 0 && (
            <CpChart bills={matchedBills} />
          )}
        </>
      )}

      {activeLinkTx && (
        <LinkBillsModal
          tx={activeLinkTx}
          bills={matchedBills}
          onClose={() => setActiveLinkTx(null)}
          onSave={handleSaveLinks}
        />
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
