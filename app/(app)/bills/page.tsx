'use client';

import { useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Upload, FileCheck, AlertCircle, Loader2,
  CheckCircle2, Clock, Banknote, Trash2,
  ChevronDown, Eye, X, FilePlus, Save,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────
type ExtractedLine = {
  description: string;
  quantity:    number;
  unit_price:  number;
  vat_rate:    number;
  line_total:  number;
  is_deposit:  boolean;
};

type Extracted = {
  supplier_name:      string;
  invoice_number:     string | null;
  invoice_date:       string | null;
  due_date:           string | null;
  currency:           string;
  payment_method:     string | null;
  net_amount:         number;
  vat_amount:         number;
  gross_amount:       number;
  suggested_category: string;
  lines:              ExtractedLine[];
};

// One item in the bulk queue
type QueueItem = {
  id:        string;          // random key
  fileName:  string;
  base64:    string;
  status:    'waiting' | 'extracting' | 'done' | 'error';
  data?:     Extracted;       // filled after extraction
  error?:    string;
  saved?:    boolean;
};

type Bill = {
  id:            string;
  created_at:    string;
  supplier_name: string;
  invoice_number:string | null;
  invoice_date:  string | null;
  due_date:      string | null;
  gross_amount:  number;
  net_amount:    number;
  vat_amount:    number;
  category:      string | null;
  status:        'pending' | 'approved' | 'paid';
  file_path:     string | null;
};

const CATEGORIES = [
  'Food Cost', 'Drinks Cost', 'Packaging',
  'Software & Technology', 'Delivery Platform Fees',
  'Repairs & Maintenance', 'Cleaning Services',
  'Utilities', 'Rent', 'Labour', 'Marketing', 'Other',
];

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-blue-50 text-blue-700 border-blue-200',
  paid:     'bg-green-50 text-green-700 border-green-200',
};

const fmt = (n: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);

const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

function uid() { return Math.random().toString(36).slice(2); }

// ── Save one bill to DB ───────────────────────────────────────────────────────
async function saveBillToDB(item: QueueItem, userId: string | null): Promise<void> {
  const d = item.data!;

  let file_path: string | null = null;
  const bytes = Uint8Array.from(atob(item.base64), (c) => c.charCodeAt(0));
  const blob  = new Blob([bytes], { type: 'application/pdf' });
  const path  = `bills/${Date.now()}_${item.fileName}`;
  const { error: upErr } = await supabase.storage.from('bills').upload(path, blob);
  if (!upErr) file_path = path;

  const { data: bill, error: billErr } = await supabase
    .from('bills')
    .insert({
      supplier_name:  d.supplier_name,
      invoice_number: d.invoice_number  ?? null,
      invoice_date:   d.invoice_date    ?? null,
      due_date:       d.due_date        ?? null,
      net_amount:     d.net_amount      ?? 0,
      vat_amount:     d.vat_amount      ?? 0,
      gross_amount:   d.gross_amount    ?? 0,
      currency:       d.currency        ?? 'EUR',
      category:       d.suggested_category ?? null,
      payment_method: d.payment_method  ?? null,
      status:         'pending',
      file_path,
      uploaded_by:    userId,
    })
    .select('id').single();
  if (billErr) throw billErr;

  if (d.lines?.length) {
    const { error: lineErr } = await supabase.from('bill_lines').insert(
      d.lines.map((l) => ({
        bill_id:     bill.id,
        description: l.description,
        quantity:    l.quantity,
        unit_price:  l.unit_price,
        vat_rate:    l.vat_rate,
        line_total:  l.line_total,
        category:    d.suggested_category ?? null,
      }))
    );
    if (lineErr) throw lineErr;
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function BillsPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab]             = useState<'upload' | 'bills'>('bills');
  const [isDragging, setIsDragging] = useState(false);
  const [queue, setQueue]         = useState<QueueItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  // Filters
  const [filterStatus,   setFilterStatus]   = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  // ── Queries ──
  const { data: bills = [], isLoading } = useQuery({
    queryKey: ['bills'],
    queryFn: async () => {
      const { data } = await supabase
        .from('bills')
        .select('id, created_at, supplier_name, invoice_number, invoice_date, due_date, gross_amount, net_amount, vat_amount, category, status, file_path')
        .order('invoice_date', { ascending: false });
      return (data ?? []) as Bill[];
    },
  });

  const filtered = bills.filter((b) => {
    if (filterStatus   !== 'all' && b.status   !== filterStatus)   return false;
    if (filterCategory !== 'all' && b.category !== filterCategory) return false;
    return true;
  });

  const totals = {
    gross: filtered.reduce((s, b) => s + b.gross_amount, 0),
    net:   filtered.reduce((s, b) => s + b.net_amount,   0),
    vat:   filtered.reduce((s, b) => s + b.vat_amount,   0),
  };

  // ── Extract one item via Claude ──
  const extractItem = useCallback(async (item: QueueItem) => {
    setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'extracting' } : i));
    try {
      const res  = await fetch('/api/extract-bill', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pdfBase64: item.base64, fileName: item.fileName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Extraction failed');
      setQueue((q) => q.map((i) => i.id === item.id
        ? { ...i, status: 'done', data: json.data }
        : i
      ));
    } catch (err: any) {
      setQueue((q) => q.map((i) => i.id === item.id
        ? { ...i, status: 'error', error: err.message }
        : i
      ));
    }
  }, []);

  // ── Add files → queue → extract sequentially ──
  const processFiles = useCallback(async (files: File[]) => {
    const pdfs = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) return;

    // Read all files as base64 first
    const newItems: QueueItem[] = await Promise.all(
      pdfs.map((file) => new Promise<QueueItem>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          resolve({
            id:       uid(),
            fileName: file.name,
            base64:   dataUrl.split(',')[1],
            status:   'waiting',
          });
        };
        reader.readAsDataURL(file);
      }))
    );

    setQueue((q) => [...q, ...newItems]);
    setTab('upload');

    // Extract sequentially (one at a time to respect rate limits)
    for (const item of newItems) {
      await extractItem(item);
    }
  }, [extractItem]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  }, [processFiles]);

  // ── Update a field in a queue item's data ──
  const updateField = (id: string, field: keyof Extracted, value: any) => {
    setQueue((q) => q.map((i) => i.id === id
      ? { ...i, data: { ...i.data!, [field]: value } }
      : i
    ));
  };

  // ── Save all done items ──
  const saveAll = useCallback(async () => {
    const toSave = queue.filter((i) => i.status === 'done' && !i.saved);
    if (!toSave.length) return;
    setSavingAll(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      for (const item of toSave) {
        await saveBillToDB(item, user?.id ?? null);
        setQueue((q) => q.map((i) => i.id === item.id ? { ...i, saved: true } : i));
      }
      queryClient.invalidateQueries({ queryKey: ['bills'] });
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSavingAll(false);
    }
  }, [queue, queryClient]);

  // ── Remove from queue ──
  const removeFromQueue = (id: string) => setQueue((q) => q.filter((i) => i.id !== id));

  // ── Status update ──
  const updateStatus = async (id: string, status: string) => {
    await supabase.from('bills').update({ status }).eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['bills'] });
  };

  // ── Delete ──
  const deleteBill = async (id: string) => {
    if (!confirm('Delete this bill permanently?')) return;
    await supabase.from('bills').delete().eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['bills'] });
  };

  const doneCount   = queue.filter((i) => i.status === 'done' && !i.saved).length;
  const savedCount  = queue.filter((i) => i.saved).length;
  const activeCount = queue.filter((i) => !i.saved).length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bills</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload invoices · AI extracts the data · review and save</p>
        </div>
        <button
          onClick={() => { setTab('upload'); setTimeout(() => fileInputRef.current?.click(), 100); }}
          className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-semibold rounded-xl hover:bg-[#2E7D32] transition-colors"
        >
          <FilePlus size={15} />
          Upload Bills
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {([['bills', 'All Bills'], ['upload', 'Upload']] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 transition-colors ${
                tab === t
                  ? 'border-[#1B5E20] text-[#1B5E20]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'upload' ? <Upload size={14} /> : <Banknote size={14} />}
              {label}
              {t === 'bills' && bills.length > 0 && (
                <span className="bg-gray-100 text-gray-600 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {bills.length}
                </span>
              )}
              {t === 'upload' && activeCount > 0 && (
                <span className="bg-[#1B5E20] text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {activeCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ═══════ UPLOAD TAB ═══════ */}
      {tab === 'upload' && (
        <div className="space-y-5">

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
              isDragging ? 'border-[#1B5E20] bg-green-50' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <Upload className={`mx-auto mb-3 ${isDragging ? 'text-[#1B5E20]' : 'text-gray-300'}`} size={36} />
            <p className="text-sm font-semibold text-gray-600 mb-1">
              Drop multiple PDF invoices here
            </p>
            <p className="text-xs text-gray-400 mb-4">
              or click to browse — you can select several files at once
            </p>
            <span className="px-5 py-2 bg-[#1B5E20] text-white rounded-lg text-xs font-bold inline-block">
              Browse Files
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              className="hidden"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) processFiles(files);
                e.target.value = '';
              }}
            />
          </div>

          {/* Queue */}
          {queue.length > 0 && (
            <div className="space-y-3">
              {/* Bulk save bar */}
              {doneCount > 0 && (
                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                  <p className="text-sm font-semibold text-green-800">
                    {doneCount} bill{doneCount !== 1 ? 's' : ''} ready to save
                    {savedCount > 0 && <span className="text-green-600 font-normal"> · {savedCount} already saved</span>}
                  </p>
                  <button
                    onClick={saveAll}
                    disabled={savingAll}
                    className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-bold rounded-lg hover:bg-[#2E7D32] disabled:opacity-50 transition-colors"
                  >
                    {savingAll ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {savingAll ? 'Saving…' : `Save All ${doneCount} Bills`}
                  </button>
                </div>
              )}

              {/* Queue items */}
              {queue.map((item) => (
                <div
                  key={item.id}
                  className={`bg-white border rounded-xl overflow-hidden shadow-sm ${
                    item.saved ? 'border-green-200 opacity-60' : 'border-gray-200'
                  }`}
                >
                  {/* Item header row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Status icon */}
                    <div className="flex-shrink-0">
                      {item.status === 'waiting'    && <Clock size={18} className="text-gray-300" />}
                      {item.status === 'extracting' && <Loader2 size={18} className="text-blue-500 animate-spin" />}
                      {item.status === 'done' && !item.saved && <FileCheck size={18} className="text-green-500" />}
                      {item.status === 'done' && item.saved  && <CheckCircle2 size={18} className="text-green-400" />}
                      {item.status === 'error'      && <AlertCircle size={18} className="text-red-400" />}
                    </div>

                    {/* File name + extracted summary */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 truncate">{item.fileName}</p>
                      {item.status === 'extracting' && (
                        <p className="text-sm font-semibold text-blue-600">Claude is reading…</p>
                      )}
                      {item.status === 'waiting' && (
                        <p className="text-sm text-gray-400">Waiting…</p>
                      )}
                      {item.status === 'done' && item.data && (
                        <p className="text-sm font-semibold text-gray-900">
                          {item.data.supplier_name}
                          <span className="ml-2 text-[#1B5E20] font-bold">{fmt(item.data.gross_amount)}</span>
                          <span className="ml-2 text-xs font-normal text-gray-400">{item.data.suggested_category}</span>
                          {item.saved && <span className="ml-2 text-xs text-green-500">✓ Saved</span>}
                        </p>
                      )}
                      {item.status === 'error' && (
                        <p className="text-sm text-red-500">{item.error}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {item.status === 'done' && !item.saved && (
                        <button
                          onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                          className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-200 rounded-lg"
                        >
                          {expandedId === item.id ? 'Hide' : 'Review'}
                          <ChevronDown size={12} className={`transition-transform ${expandedId === item.id ? 'rotate-180' : ''}`} />
                        </button>
                      )}
                      <button
                        onClick={() => removeFromQueue(item.id)}
                        className="text-gray-300 hover:text-red-400 transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Expandable review form */}
                  {expandedId === item.id && item.data && (
                    <div className="border-t border-gray-100 px-4 py-4 bg-gray-50 space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: 'Supplier',       field: 'supplier_name'  as keyof Extracted, type: 'text' },
                          { label: 'Invoice Number', field: 'invoice_number' as keyof Extracted, type: 'text' },
                          { label: 'Invoice Date',   field: 'invoice_date'   as keyof Extracted, type: 'date' },
                          { label: 'Due Date',       field: 'due_date'       as keyof Extracted, type: 'date' },
                          { label: 'Net (€)',        field: 'net_amount'     as keyof Extracted, type: 'number' },
                          { label: 'VAT (€)',        field: 'vat_amount'     as keyof Extracted, type: 'number' },
                          { label: 'Gross (€)',      field: 'gross_amount'   as keyof Extracted, type: 'number' },
                        ].map(({ label, field, type }) => (
                          <div key={field}>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                            <input
                              type={type}
                              step={type === 'number' ? '0.01' : undefined}
                              value={(item.data as any)[field] ?? ''}
                              onChange={(e) => updateField(item.id, field, type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value || null)}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                            />
                          </div>
                        ))}

                        {/* Category dropdown */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
                          <div className="relative">
                            <select
                              value={item.data.suggested_category}
                              onChange={(e) => updateField(item.id, 'suggested_category', e.target.value)}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 appearance-none pr-6"
                            >
                              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                            </select>
                            <ChevronDown size={12} className="absolute right-2 top-2 text-gray-400 pointer-events-none" />
                          </div>
                        </div>
                      </div>

                      {/* Line items */}
                      {item.data.lines.length > 0 && (
                        <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="px-3 py-2 text-left font-semibold text-gray-500">Description</th>
                                <th className="px-3 py-2 text-right font-semibold text-gray-500">Qty</th>
                                <th className="px-3 py-2 text-right font-semibold text-gray-500">Unit €</th>
                                <th className="px-3 py-2 text-right font-semibold text-gray-500">VAT%</th>
                                <th className="px-3 py-2 text-right font-semibold text-gray-500">Total €</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {item.data.lines.map((line, i) => (
                                <tr key={i} className={line.is_deposit ? 'text-gray-400 italic' : ''}>
                                  <td className="px-3 py-1.5">{line.description}{line.is_deposit && ' (deposit)'}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums">{line.quantity}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums">{line.unit_price.toFixed(2)}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums">{line.vat_rate}%</td>
                                  <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${line.line_total < 0 ? 'text-red-400' : ''}`}>
                                    {line.line_total.toFixed(2)}
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
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════ BILLS TAB ═══════ */}
      {tab === 'bills' && (
        <div>
          {/* Summary cards */}
          {bills.length > 0 && (
            <div className="grid grid-cols-3 gap-4 mb-5">
              {[
                { label: 'Gross Total', value: fmt(totals.gross), color: 'text-gray-900' },
                { label: 'Net Total',   value: fmt(totals.net),   color: 'text-blue-700' },
                { label: 'VAT Total',   value: fmt(totals.vat),   color: 'text-amber-700' },
              ].map((s) => (
                <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{s.label}</p>
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
            </select>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            >
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <span className="text-xs text-gray-400 ml-auto">{filtered.length} bill{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 size={24} className="text-gray-300 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 border border-dashed border-gray-200 rounded-xl gap-3">
              <Banknote size={36} className="text-gray-200" />
              <p className="text-sm text-gray-400">No bills yet — upload your first invoices</p>
              <button
                onClick={() => setTab('upload')}
                className="px-4 py-2 bg-[#1B5E20] text-white text-xs font-bold rounded-lg hover:bg-[#2E7D32] transition-colors"
              >
                Upload Bills
              </button>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Supplier</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoice #</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Due</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Net</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Gross</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((bill) => (
                    <tr key={bill.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-gray-900">{bill.supplier_name}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{bill.invoice_number ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(bill.invoice_date)}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(bill.due_date)}</td>
                      <td className="px-4 py-3">
                        {bill.category && (
                          <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                            {bill.category}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 tabular-nums">{fmt(bill.net_amount)}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 tabular-nums">{fmt(bill.gross_amount)}</td>
                      <td className="px-4 py-3">
                        <select
                          value={bill.status}
                          onChange={(e) => updateStatus(bill.id, e.target.value)}
                          className={`text-xs font-semibold px-2 py-1 rounded-full border cursor-pointer focus:outline-none ${STATUS_STYLES[bill.status]}`}
                        >
                          <option value="pending">Pending</option>
                          <option value="approved">Approved</option>
                          <option value="paid">Paid</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {bill.file_path && (
                            <a
                              href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bills/${bill.file_path}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-300 hover:text-blue-500 transition-colors"
                              title="View PDF"
                            >
                              <Eye size={14} />
                            </a>
                          )}
                          <button
                            onClick={() => deleteBill(bill.id)}
                            className="text-gray-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200">
                    <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-gray-500">
                      {filtered.length} bills
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-gray-700 tabular-nums">{fmt(totals.net)}</td>
                    <td className="px-4 py-3 text-right font-bold text-[#1B5E20] tabular-nums">{fmt(totals.gross)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
