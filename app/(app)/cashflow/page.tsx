'use client';

import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Loader2, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────────── */
type CfUpload = {
  id: string;
  filename: string;
  period_label: string;
  uploaded_at: string;
  transaction_count: number;
};

type CfTx = {
  id: string;
  upload_id: string;
  date: string;
  description: string;
  counterparty: string;
  amount_cents: number;
  direction: 'in' | 'out';
  category: string;
  location: string;
  sales_type: string;
  notes: string;
};

type TxPage = { data: CfTx[]; count: number; page: number; pageSize: number };

/* ── Constants ──────────────────────────────────────────────────────── */
const OUT_CATEGORIES = ['Personnel','Suppliers','Rent','OpenTable','Orderbird','Tax Advisor','Insurance','Energy','Marketing','Financing','Other'];
const OUT_LOCATIONS  = ['Westend','Eschborn','Taunus','ZK','HQ/Admin','Other'];
const IN_LOCATIONS   = ['Westend','Eschborn','Taunus','Catering','Other'];
const SALES_TYPES    = ['In-House','Delivery','Other'];

/* ── Helpers ────────────────────────────────────────────────────────── */
function eur(cents: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/* ── Category colour chips ──────────────────────────────────────────── */
const CAT_COLOURS: Record<string, string> = {
  Personnel:    'bg-blue-100 text-blue-800',
  Suppliers:    'bg-orange-100 text-orange-800',
  Rent:         'bg-purple-100 text-purple-800',
  OpenTable:    'bg-teal-100 text-teal-800',
  Orderbird:    'bg-cyan-100 text-cyan-800',
  'Tax Advisor':'bg-yellow-100 text-yellow-800',
  Insurance:    'bg-pink-100 text-pink-800',
  Energy:       'bg-amber-100 text-amber-800',
  Marketing:    'bg-indigo-100 text-indigo-800',
  Financing:    'bg-red-100 text-red-800',
  Other:        'bg-gray-100 text-gray-600',
};

/* ── Row component ──────────────────────────────────────────────────── */
function TxRow({ tx, onSave }: { tx: CfTx; onSave: (id: string, patch: Partial<CfTx>) => void }) {
  const isIn = tx.direction === 'in';
  const locations = isIn ? IN_LOCATIONS : OUT_LOCATIONS;

  const [notes, setNotes] = useState(tx.notes ?? '');
  const notesTimer = useRef<ReturnType<typeof setTimeout>>();

  const patch = useCallback((field: string, value: string) => {
    onSave(tx.id, { [field]: value } as Partial<CfTx>);
  }, [tx.id, onSave]);

  const onNotesChange = (v: string) => {
    setNotes(v);
    clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => patch('notes', v), 800);
  };

  return (
    <tr className={`border-b border-gray-100 hover:bg-gray-50/50 text-sm ${isIn ? 'border-l-2 border-l-green-400' : 'border-l-2 border-l-red-400'}`}>
      {/* Date */}
      <td className="py-2 px-3 text-gray-500 whitespace-nowrap font-mono text-xs">
        {fmtDate(tx.date)}
      </td>

      {/* Counterparty */}
      <td className="py-2 px-3 max-w-[220px]" title={tx.counterparty}>
        <div className="truncate text-gray-900">{tx.counterparty || '—'}</div>
        {tx.description && (
          <div className="truncate text-gray-400 text-xs mt-0.5" title={tx.description}>
            {tx.description.slice(0, 80)}
          </div>
        )}
      </td>

      {/* Amount */}
      <td className={`py-2 px-3 text-right whitespace-nowrap font-semibold tabular-nums ${isIn ? 'text-green-700' : 'text-red-700'}`}>
        {isIn ? '+' : '−'} {eur(tx.amount_cents)}
      </td>

      {/* Category (outgoing only) */}
      <td className="py-2 px-3">
        {isIn ? (
          <span className="text-xs text-gray-400 italic">—</span>
        ) : (
          <select
            value={tx.category}
            onChange={e => patch('category', e.target.value)}
            className={`text-xs font-medium px-1.5 py-0.5 rounded-full border-0 outline-none cursor-pointer ${CAT_COLOURS[tx.category] ?? CAT_COLOURS.Other}`}
          >
            {OUT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </td>

      {/* Location */}
      <td className="py-2 px-3">
        <select
          value={tx.location}
          onChange={e => patch('location', e.target.value)}
          className="text-xs bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-700 outline-none cursor-pointer hover:border-gray-400"
        >
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </td>

      {/* Sales type (incoming only) */}
      <td className="py-2 px-3">
        {!isIn ? (
          <span className="text-xs text-gray-400 italic">—</span>
        ) : (
          <select
            value={tx.sales_type}
            onChange={e => patch('sales_type', e.target.value)}
            className="text-xs bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-700 outline-none cursor-pointer hover:border-gray-400"
          >
            {SALES_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </td>

      {/* Notes */}
      <td className="py-2 px-3">
        <input
          type="text"
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
          placeholder="Add note…"
          className="w-full text-xs bg-transparent border-b border-dashed border-gray-200 focus:border-gray-400 outline-none py-0.5 text-gray-700 placeholder-gray-300"
        />
      </td>
    </tr>
  );
}

/* ── Main page ──────────────────────────────────────────────────────── */
export default function CashFlowPage() {
  const qc = useQueryClient();

  /* Upload state */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [periodLabel, setPeriodLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  /* Filters */
  const [selectedUploadId, setSelectedUploadId] = useState<string>('');
  const [dirFilter, setDirFilter] = useState<'all' | 'in' | 'out'>('all');
  const [catFilter, setCatFilter] = useState('All');
  const [locFilter, setLocFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [page, setPage] = useState(1);

  /* Fetch uploads list */
  const { data: uploads = [] } = useQuery<CfUpload[]>({
    queryKey: ['cashflow-uploads'],
    queryFn: () => fetch('/api/cashflow/uploads').then(r => r.json()),
  });

  /* Fetch transactions */
  const params = new URLSearchParams({ page: String(page) });
  if (selectedUploadId) params.set('uploadId', selectedUploadId);
  if (dirFilter !== 'all') params.set('direction', dirFilter);
  if (catFilter !== 'All') params.set('category', catFilter);
  if (locFilter !== 'All') params.set('location', locFilter);
  if (typeFilter !== 'All') params.set('salesType', typeFilter);

  const { data: txPage, isFetching } = useQuery<TxPage>({
    queryKey: ['cashflow-tx', selectedUploadId, dirFilter, catFilter, locFilter, typeFilter, page],
    queryFn: () => fetch(`/api/cashflow/transactions?${params}`).then(r => r.json()),
    enabled: !!selectedUploadId,
    placeholderData: prev => prev,
  });

  const txs: CfTx[] = txPage?.data ?? [];
  const totalCount  = txPage?.count ?? 0;
  const pageSize    = txPage?.pageSize ?? 100;
  const totalPages  = Math.max(1, Math.ceil(totalCount / pageSize));

  /* Summary totals (from current filtered set — all pages) */
  const { data: allTx } = useQuery<TxPage>({
    queryKey: ['cashflow-tx-all', selectedUploadId],
    queryFn: () => fetch(`/api/cashflow/transactions?uploadId=${selectedUploadId}&page=1`).then(r => r.json()),
    enabled: !!selectedUploadId,
  });

  // Get full summary from the upload record since it may have many pages
  const selectedUpload = uploads.find(u => u.id === selectedUploadId);

  /* Compute summary from all fetched txs — approximate from current page is not ideal,
     so we compute from the full-page query, which fetches up to 100 rows.
     For a full total we'd need a dedicated endpoint; for now show what we have. */
  const allRows: CfTx[] = allTx?.data ?? [];
  const totalIn  = allRows.filter(t => t.direction === 'in').reduce((s, t) => s + t.amount_cents, 0);
  const totalOut = allRows.filter(t => t.direction === 'out').reduce((s, t) => s + t.amount_cents, 0);
  const net      = totalIn - totalOut;

  /* Patch mutation */
  const patchMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CfTx> }) =>
      fetch(`/api/cashflow/transactions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cashflow-tx'] });
    },
  });

  const handleSave = useCallback((id: string, patch: Partial<CfTx>) => {
    patchMut.mutate({ id, patch });
  }, [patchMut]);

  /* Upload handler */
  const handleUpload = async (file: File) => {
    if (!periodLabel.trim()) { alert('Please enter a period label first (e.g. Q1-2026).'); return; }
    setUploading(true);
    setUploadMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('periodLabel', periodLabel.trim());
      const res  = await fetch('/api/cashflow/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Upload failed');
      setUploadMsg(`✓ ${json.count} transactions imported`);
      qc.invalidateQueries({ queryKey: ['cashflow-uploads'] });
      setSelectedUploadId(json.uploadId);
      setPage(1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload error';
      setUploadMsg(`Error: ${msg}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const resetFilters = () => { setDirFilter('all'); setCatFilter('All'); setLocFilter('All'); setTypeFilter('All'); setPage(1); };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cash Flow</h1>
          <p className="text-sm text-gray-500 mt-0.5">Bank account transactions — classify and allocate</p>
        </div>

        {/* Upload section */}
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            value={periodLabel}
            onChange={e => setPeriodLabel(e.target.value)}
            placeholder="Period label (e.g. Q1-2026)"
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 w-48 outline-none focus:border-[#1B5E20]"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-semibold rounded-lg hover:bg-[#2E7D32] disabled:opacity-60 transition-colors"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? 'Importing…' : 'Upload CSV'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
          />
          {uploadMsg && (
            <span className={`text-sm font-medium ${uploadMsg.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>
              {uploadMsg}
            </span>
          )}
        </div>
      </div>

      {/* Period selector */}
      {uploads.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-600">Period:</span>
          <div className="flex flex-wrap gap-2">
            {uploads.map(u => (
              <button
                key={u.id}
                onClick={() => { setSelectedUploadId(u.id); resetFilters(); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  selectedUploadId === u.id
                    ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                }`}
              >
                {u.period_label}
                <span className="ml-1.5 text-xs opacity-70">({u.transaction_count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {uploads.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <Upload size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No data yet</p>
          <p className="text-gray-400 text-sm mt-1">Enter a period label and upload your bank CSV file to get started.</p>
        </div>
      )}

      {selectedUploadId && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <TrendingUp size={18} className="text-green-700" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total In</p>
                <p className="text-lg font-bold text-green-700 tabular-nums">{eur(totalIn)}</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <TrendingDown size={18} className="text-red-700" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total Out</p>
                <p className="text-lg font-bold text-red-700 tabular-nums">{eur(totalOut)}</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${net >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                <Minus size={18} className={net >= 0 ? 'text-green-700' : 'text-red-700'} />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Net</p>
                <p className={`text-lg font-bold tabular-nums ${net >= 0 ? 'text-green-700' : 'text-red-700'}`}>{eur(Math.abs(net))}</p>
              </div>
            </div>
          </div>

          {/* Note: summary is based on first 100 rows */}
          {selectedUpload && selectedUpload.transaction_count > 100 && (
            <p className="text-xs text-gray-400 -mt-2">Summary figures are based on the first 100 transactions. Full aggregation will be added in a future update.</p>
          )}

          {/* Filter bar */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
            {/* Direction toggle */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              {(['all','in','out'] as const).map(d => (
                <button
                  key={d}
                  onClick={() => { setDirFilter(d); setPage(1); }}
                  className={`px-3 py-1.5 font-medium capitalize transition-colors ${dirFilter === d ? 'bg-[#1B5E20] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  {d === 'all' ? 'All' : d === 'in' ? 'Incoming' : 'Outgoing'}
                </button>
              ))}
            </div>

            {/* Category filter (outgoing only) */}
            {(dirFilter !== 'in') && (
              <select
                value={catFilter}
                onChange={e => { setCatFilter(e.target.value); setPage(1); }}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-gray-400"
              >
                <option value="All">All categories</option>
                {OUT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}

            {/* Location filter */}
            <select
              value={locFilter}
              onChange={e => { setLocFilter(e.target.value); setPage(1); }}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-gray-400"
            >
              <option value="All">All locations</option>
              {[...new Set([...OUT_LOCATIONS, ...IN_LOCATIONS])].map(l => <option key={l} value={l}>{l}</option>)}
            </select>

            {/* Sales type filter (incoming only) */}
            {(dirFilter !== 'out') && (
              <select
                value={typeFilter}
                onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-gray-400"
              >
                <option value="All">All types</option>
                {SALES_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}

            <span className="ml-auto text-xs text-gray-400">
              {totalCount} transactions
            </span>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {isFetching && (
              <div className="flex items-center justify-center py-8 text-gray-400 gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading…
              </div>
            )}
            {!isFetching && txs.length === 0 && (
              <div className="py-12 text-center text-gray-400 text-sm">No transactions match your filters.</div>
            )}
            {txs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Counterparty</th>
                      <th className="text-right py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txs.map(tx => (
                      <TxRow key={tx.id} tx={tx} onSave={handleSave} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={14} /> Previous
                </button>
                <span className="text-sm text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
