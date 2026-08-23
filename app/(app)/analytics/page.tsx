'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, RefreshCw } from 'lucide-react';

type UnmatchedTx = {
  id: string;
  date: string;
  description: string;
  counterparty: string;
  amount_cents: number;
  direction: 'in' | 'out';
  category: string;
  location: string | null;
};

type UnmatchedBill = {
  id: string;
  supplier_name: string;
  invoice_number: string | null;
  invoice_date: string | null;
  gross_amount: number;
  net_amount: number;
  status: string;
  location: string | null;
};

type Analytics = {
  unmatchedCashFlows: UnmatchedTx[];
  unmatchedBills: UnmatchedBill[];
};

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

const DIRECTIONS = ['All', 'in', 'out'] as const;

export default function AnalyticsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<Analytics>({
    queryKey: ['analytics-unmatched'],
    queryFn: () => fetch('/api/analytics/unmatched').then(r => r.json()),
    staleTime: 0,
  });

  const [txDir, setTxDir]         = useState<'All' | 'in' | 'out'>('All');
  const [txSearch, setTxSearch]   = useState('');
  const [billSearch, setBillSearch] = useState('');
  const [billStatus, setBillStatus] = useState('All');

  const txs = useMemo(() => {
    let rows = data?.unmatchedCashFlows ?? [];
    if (txDir !== 'All') rows = rows.filter(r => r.direction === txDir);
    if (txSearch.trim()) {
      const q = txSearch.toLowerCase();
      rows = rows.filter(r =>
        r.counterparty?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.category?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [data, txDir, txSearch]);

  const bills = useMemo(() => {
    let rows = data?.unmatchedBills ?? [];
    if (billStatus !== 'All') rows = rows.filter(r => r.status === billStatus);
    if (billSearch.trim()) {
      const q = billSearch.toLowerCase();
      rows = rows.filter(r =>
        r.supplier_name?.toLowerCase().includes(q) ||
        r.invoice_number?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [data, billStatus, billSearch]);

  const txTotalOut = useMemo(() => txs.filter(r => r.direction === 'out').reduce((s, r) => s + r.amount_cents, 0), [txs]);
  const txTotalIn  = useMemo(() => txs.filter(r => r.direction === 'in').reduce((s, r) => s + r.amount_cents, 0), [txs]);
  const billsTotal = useMemo(() => bills.reduce((s, b) => s + b.gross_amount, 0), [bills]);

  const billStatuses = useMemo(() => {
    const s = new Set((data?.unmatchedBills ?? []).map(b => b.status));
    return ['All', ...Array.from(s).sort()];
  }, [data]);

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8 flex items-center justify-center py-24">
        <div className="text-gray-400 text-sm">Loading analytics…</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Unmatched cash flows and bills — everything here needs a match eventually.
          </p>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* ── Unmatched Cash Flows ── */}
      <section>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <div>
            <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
              <AlertCircle size={16} className="text-amber-500" />
              Unmatched Cash Flows
              <span className="text-sm font-normal text-gray-400">({txs.length} of {data?.unmatchedCashFlows.length ?? 0})</span>
            </h2>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {DIRECTIONS.map(d => (
                <button key={d} onClick={() => setTxDir(d)}
                  className={`px-3 py-1.5 font-medium transition-colors ${txDir === d ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {d === 'All' ? 'All' : d === 'in' ? 'Inflows' : 'Outflows'}
                </button>
              ))}
            </div>
            <input value={txSearch} onChange={e => setTxSearch(e.target.value)}
              placeholder="Search counterparty / category…"
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 w-52" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
            <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Unmatched outflows</div>
            <div className="text-lg font-bold text-red-600">{eur(txTotalOut)}</div>
            <div className="text-xs text-gray-400">{txs.filter(r => r.direction === 'out').length} transactions</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
            <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Unmatched inflows</div>
            <div className="text-lg font-bold text-green-700">{eur(txTotalIn)}</div>
            <div className="text-xs text-gray-400">{txs.filter(r => r.direction === 'in').length} transactions</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
            <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Unmatched bills total</div>
            <div className="text-lg font-bold text-gray-800">{eurAmt(billsTotal)}</div>
            <div className="text-xs text-gray-400">{data?.unmatchedBills.length ?? 0} bills</div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-3 text-left font-semibold text-gray-500 whitespace-nowrap">Date</th>
                  <th className="py-2.5 px-3 text-left font-semibold text-gray-500">Counterparty</th>
                  <th className="py-2.5 px-3 text-left font-semibold text-gray-500">Description</th>
                  <th className="py-2.5 px-3 text-right font-semibold text-gray-500 whitespace-nowrap">Amount</th>
                  <th className="py-2.5 px-3 text-left font-semibold text-gray-500">Category</th>
                  <th className="py-2.5 px-3 text-left font-semibold text-gray-500">Location</th>
                </tr>
              </thead>
              <tbody>
                {txs.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-400 italic">No unmatched cash flows.</td></tr>
                ) : txs.map(tx => {
                  const isIn = tx.direction === 'in';
                  return (
                    <tr key={tx.id} className={`border-b border-gray-50 hover:bg-gray-50/50 border-l-2 ${isIn ? 'border-l-green-400' : 'border-l-red-400'}`}>
                      <td className="py-2 px-3 font-mono text-gray-500 whitespace-nowrap">{fmtDate(tx.date)}</td>
                      <td className="py-2 px-3 text-gray-800 max-w-[200px] truncate">{tx.counterparty || '—'}</td>
                      <td className="py-2 px-3 text-gray-500 max-w-[200px] truncate">{tx.description || '—'}</td>
                      <td className={`py-2 px-3 text-right font-semibold tabular-nums whitespace-nowrap ${isIn ? 'text-green-700' : 'text-red-600'}`}>
                        {isIn ? '+' : '−'} {eur(tx.amount_cents)}
                      </td>
                      <td className="py-2 px-3 text-gray-500 truncate max-w-[120px]">{tx.category || '—'}</td>
                      <td className="py-2 px-3 text-gray-400">{tx.location || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Unmatched Bills ── */}
      <section>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <AlertCircle size={16} className="text-amber-500" />
            Unmatched Bills
            <span className="text-sm font-normal text-gray-400">({bills.length} of {data?.unmatchedBills.length ?? 0})</span>
          </h2>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <select value={billStatus} onChange={e => setBillStatus(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
              {billStatuses.map(s => <option key={s} value={s}>{s === 'All' ? 'All statuses' : s}</option>)}
            </select>
            <input value={billSearch} onChange={e => setBillSearch(e.target.value)}
              placeholder="Search supplier / invoice #…"
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 w-52" />
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-3 text-left font-semibold text-gray-500 whitespace-nowrap">Date</th>
                  <th className="py-2.5 px-3 text-left font-semibold text-gray-500">Supplier</th>
                  <th className="py-2.5 px-3 text-left font-semibold text-gray-500">Invoice #</th>
                  <th className="py-2.5 px-3 text-right font-semibold text-gray-500">Gross</th>
                  <th className="py-2.5 px-3 text-right font-semibold text-gray-500">Net</th>
                  <th className="py-2.5 px-3 text-left font-semibold text-gray-500">Status</th>
                  <th className="py-2.5 px-3 text-left font-semibold text-gray-500">Location</th>
                </tr>
              </thead>
              <tbody>
                {bills.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400 italic">No unmatched bills.</td></tr>
                ) : bills.map(bill => (
                  <tr key={bill.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2 px-3 font-mono text-gray-500 whitespace-nowrap">
                      {bill.invoice_date ? fmtDate(bill.invoice_date) : '—'}
                    </td>
                    <td className="py-2 px-3 text-gray-800 max-w-[200px] truncate">{bill.supplier_name}</td>
                    <td className="py-2 px-3 text-gray-500">{bill.invoice_number ?? '—'}</td>
                    <td className="py-2 px-3 text-right font-semibold text-red-600 tabular-nums whitespace-nowrap">{eurAmt(bill.gross_amount)}</td>
                    <td className="py-2 px-3 text-right text-gray-500 tabular-nums whitespace-nowrap">{eurAmt(bill.net_amount)}</td>
                    <td className="py-2 px-3">
                      <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                        bill.status === 'approved' ? 'bg-green-100 text-green-700'
                        : bill.status === 'pending' ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-gray-100 text-gray-500'
                      }`}>{bill.status}</span>
                    </td>
                    <td className="py-2 px-3 text-gray-400">{bill.location ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
