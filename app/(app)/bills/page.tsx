'use client';

import { useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Upload, FileCheck, AlertCircle, Loader2,
  CheckCircle2, Clock, Banknote, Trash2,
  ChevronDown, Eye, X, FilePlus,
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

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending:  <Clock size={11} />,
  approved: <CheckCircle2 size={11} />,
  paid:     <Banknote size={11} />,
};

const fmt = (n: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);

const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

// ── Page ──────────────────────────────────────────────────────────────────────
export default function BillsPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab]               = useState<'upload' | 'bills'>('bills');
  const [isDragging, setIsDragging] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [fileName, setFileName]     = useState<string | null>(null);
  const [pdfBase64, setPdfBase64]   = useState<string | null>(null);
  const [extracted, setExtracted]   = useState<Extracted | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Editable review form state
  const [form, setForm] = useState<Partial<Extracted>>({});

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

  // ── File handling ──
  const processFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setExtractError('Please upload a PDF file.');
      return;
    }
    setFileName(file.name);
    setExtracted(null);
    setExtractError(null);
    setExtracting(true);

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl  = e.target?.result as string;
      const base64   = dataUrl.split(',')[1];
      setPdfBase64(base64);

      try {
        const res  = await fetch('/api/extract-bill', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ pdfBase64: base64, fileName: file.name }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Extraction failed');

        const data = json.data as Extracted;
        setExtracted(data);
        setForm(data);
      } catch (err: any) {
        setExtractError(err.message);
      } finally {
        setExtracting(false);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  // ── Save to DB ──
  const handleSave = useCallback(async () => {
    if (!form.supplier_name) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Upload PDF to Supabase Storage
      let file_path: string | null = null;
      if (pdfBase64 && fileName) {
        const bytes    = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
        const blob     = new Blob([bytes], { type: 'application/pdf' });
        const path     = `bills/${Date.now()}_${fileName}`;
        const { error: upErr } = await supabase.storage.from('bills').upload(path, blob);
        if (!upErr) file_path = path;
      }

      // Insert bill header
      const { data: bill, error: billErr } = await supabase
        .from('bills')
        .insert({
          supplier_name:  form.supplier_name,
          invoice_number: form.invoice_number ?? null,
          invoice_date:   form.invoice_date   ?? null,
          due_date:       form.due_date        ?? null,
          net_amount:     form.net_amount      ?? 0,
          vat_amount:     form.vat_amount      ?? 0,
          gross_amount:   form.gross_amount    ?? 0,
          currency:       form.currency        ?? 'EUR',
          category:       form.suggested_category ?? null,
          payment_method: form.payment_method  ?? null,
          status:         'pending',
          file_path,
          uploaded_by:    user?.id ?? null,
        })
        .select('id').single();
      if (billErr) throw billErr;

      // Insert line items
      if (form.lines && form.lines.length > 0) {
        const lineRows = form.lines.map((l) => ({
          bill_id:     bill.id,
          description: l.description,
          quantity:    l.quantity,
          unit_price:  l.unit_price,
          vat_rate:    l.vat_rate,
          line_total:  l.line_total,
          category:    form.suggested_category ?? null,
        }));
        const { error: lineErr } = await supabase.from('bill_lines').insert(lineRows);
        if (lineErr) throw lineErr;
      }

      queryClient.invalidateQueries({ queryKey: ['bills'] });

      // Reset
      setExtracted(null); setForm({});
      setFileName(null);  setPdfBase64(null);
      setTab('bills');
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [form, pdfBase64, fileName, queryClient]);

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

  const canSave = !!extracted && !!form.supplier_name && !saving;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bills</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload invoices · AI extracts the data · review and save</p>
        </div>
        <button
          onClick={() => setTab('upload')}
          className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-semibold rounded-xl hover:bg-[#2E7D32] transition-colors"
        >
          <FilePlus size={15} />
          Upload Bill
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {([['bills', 'All Bills'], ['upload', 'Upload New']] as const).map(([t, label]) => (
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
            </button>
          ))}
        </nav>
      </div>

      {/* ═══════ UPLOAD TAB ═══════ */}
      {tab === 'upload' && (
        <div className="flex gap-6 items-start">

          {/* Left — drop zone */}
          <div className="w-80 flex-shrink-0 space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">PDF Invoice</label>

              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  isDragging          ? 'border-[#1B5E20] bg-green-50' :
                  extracting          ? 'border-blue-300 bg-blue-50'  :
                  extracted           ? 'border-green-400 bg-green-50' :
                  extractError        ? 'border-red-300 bg-red-50'    :
                  'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                {extracting ? (
                  <>
                    <Loader2 className="mx-auto mb-2 text-blue-500 animate-spin" size={32} />
                    <p className="text-sm font-semibold text-blue-600">Claude is reading the invoice…</p>
                    <p className="text-xs text-blue-400 mt-1">This takes a few seconds</p>
                  </>
                ) : extracted ? (
                  <>
                    <FileCheck className="mx-auto mb-2 text-green-600" size={32} />
                    <p className="text-sm font-semibold text-green-700">{fileName}</p>
                    <p className="text-xs text-green-500 mt-1">Data extracted — review below</p>
                  </>
                ) : (
                  <>
                    <Upload className="mx-auto mb-2 text-gray-400" size={32} />
                    <p className="text-sm font-semibold text-gray-600">{fileName ?? 'Drop PDF here'}</p>
                    <p className="text-xs text-gray-400 mt-1 mb-3">or click to browse</p>
                    <span className="px-4 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 inline-block">
                      Browse files
                    </span>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }}
                />
              </div>

              {extractError && (
                <div className="mt-2 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{extractError}</p>
                </div>
              )}
            </div>

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={!canSave}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-colors ${
                canSave
                  ? 'bg-[#1B5E20] text-white hover:bg-[#2E7D32]'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {saving
                ? <Loader2 size={16} className="animate-spin" />
                : <CheckCircle2 size={16} />
              }
              {saving ? 'Saving…' : extracted ? `Save · ${fmt(form.gross_amount ?? 0)}` : 'Drop a PDF to start'}
            </button>

            <p className="text-xs text-gray-400 text-center">
              Claude reads the PDF and extracts all invoice data automatically.
              Review and correct before saving.
            </p>
          </div>

          {/* Right — review form */}
          {extracted && (
            <div className="flex-1 min-w-0 space-y-5">

              {/* Header fields */}
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Invoice Details</h2>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Supplier',        key: 'supplier_name',      type: 'text' },
                    { label: 'Invoice Number',  key: 'invoice_number',     type: 'text' },
                    { label: 'Invoice Date',    key: 'invoice_date',       type: 'date' },
                    { label: 'Due Date',        key: 'due_date',           type: 'date' },
                    { label: 'Payment Method',  key: 'payment_method',     type: 'text' },
                  ].map(({ label, key, type }) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                      <input
                        type={type}
                        value={(form as any)[key] ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value || null }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
                      />
                    </div>
                  ))}

                  {/* Category */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
                    <div className="relative">
                      <select
                        value={form.suggested_category ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, suggested_category: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] appearance-none pr-8"
                      >
                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Amounts */}
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Amounts (EUR)</h2>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'Net Amount',   key: 'net_amount'   },
                    { label: 'VAT',          key: 'vat_amount'   },
                    { label: 'Gross Total',  key: 'gross_amount' },
                  ].map(({ label, key }) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                      <input
                        type="number"
                        step="0.01"
                        value={(form as any)[key] ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
                        className={`w-full border rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] ${
                          key === 'gross_amount'
                            ? 'border-[#1B5E20] text-[#1B5E20] bg-green-50'
                            : 'border-gray-200 text-gray-900'
                        }`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Line items */}
              {form.lines && form.lines.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="px-5 py-3 border-b border-gray-100">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Line Items</h2>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide">Qty</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide">Unit €</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide">VAT%</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide">Total €</th>
                        <th className="px-3 py-2.5 w-6"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {form.lines.map((line, i) => (
                        <tr key={i} className={line.is_deposit ? 'bg-gray-50/50' : ''}>
                          <td className="px-4 py-2">
                            <span className={line.is_deposit ? 'text-gray-400 italic' : 'text-gray-800'}>
                              {line.description}
                              {line.is_deposit && <span className="ml-1 text-gray-400 text-xs">(deposit)</span>}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600 tabular-nums">{line.quantity}</td>
                          <td className="px-3 py-2 text-right text-gray-600 tabular-nums">{line.unit_price.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 tabular-nums">{line.vat_rate}%</td>
                          <td className={`px-3 py-2 text-right font-semibold tabular-nums ${line.line_total < 0 ? 'text-red-500' : 'text-gray-900'}`}>
                            {line.line_total.toFixed(2)}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => setForm((f) => ({ ...f, lines: f.lines?.filter((_, j) => j !== i) }))}
                              className="text-gray-300 hover:text-red-400 transition-colors"
                            >
                              <X size={12} />
                            </button>
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
      )}

      {/* ═══════ BILLS TAB ═══════ */}
      {tab === 'bills' && (
        <div>
          {/* Summary cards */}
          {bills.length > 0 && (
            <div className="grid grid-cols-3 gap-4 mb-5">
              {[
                { label: 'Gross Total',  value: fmt(totals.gross), color: 'text-gray-900' },
                { label: 'Net Total',    value: fmt(totals.net),   color: 'text-blue-700' },
                { label: 'VAT Total',    value: fmt(totals.vat),   color: 'text-amber-700' },
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
              <p className="text-sm text-gray-400">No bills yet — upload your first invoice</p>
              <button
                onClick={() => setTab('upload')}
                className="px-4 py-2 bg-[#1B5E20] text-white text-xs font-bold rounded-lg hover:bg-[#2E7D32] transition-colors"
              >
                Upload Bill
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
