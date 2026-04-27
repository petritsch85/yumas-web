'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Upload, FileCheck, AlertCircle, Loader2,
  CheckCircle2, Clock, Banknote, Trash2,
  ChevronDown, Eye, X, FilePlus, Save, MapPin, Calendar, Pencil,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────
type Location = { id: string; name: string };

type ExtractedLine = {
  description: string;
  quantity:    number;
  unit_price:  number;
  vat_rate:    number;
  line_total:  number;
  is_deposit:  boolean;
};

type DeliveryAddress = {
  street:   string | null;
  postcode: string | null;
  city:     string | null;
  full:     string | null;
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
  delivery_address:   DeliveryAddress | null;
  lines:              ExtractedLine[];
};

type PeriodType = 'single_date' | 'month' | 'year' | 'custom';

type QueueItem = {
  id:             string;
  fileName:       string;
  base64:         string;
  status:         'waiting' | 'extracting' | 'done' | 'error';
  data?:          Extracted;
  error?:         string;
  saved?:         boolean;
  locationId?:    string | null;
  locationLabel?: string;
  periodType?:    PeriodType;
  periodStart?:   string | null;
  periodEnd?:     string | null;
};

type Bill = {
  id:             string;
  created_at:     string;
  supplier_name:  string;
  invoice_number: string | null;
  invoice_date:   string | null;
  due_date:       string | null;
  gross_amount:   number;
  net_amount:     number;
  vat_amount:     number;
  category:       string | null;
  location_label: string | null;
  period_type:    string | null;
  period_start:   string | null;
  period_end:     string | null;
  status:         'pending' | 'approved' | 'paid';
  file_path:      string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────
const CATEGORIES = [
  'Food Cost', 'Drinks Cost', 'Packaging',
  'Software & Technology', 'Delivery Platform Fees',
  'Repairs & Maintenance', 'Cleaning Services',
  'Utilities', 'Rent', 'Labour', 'Marketing', 'Other',
];

const PERIOD_LABELS: Record<PeriodType, string> = {
  single_date: 'Single Date',
  month:       'Monthly (1 month)',
  year:        'Annual (12 months)',
  custom:      'Custom Range',
};

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-blue-50 text-blue-700 border-blue-200',
  paid:     'bg-green-50 text-green-700 border-green-200',
};

const SPECIAL_LOCATIONS = [
  { id: 'corporate', name: 'Corporate' },
  { id: 'other',     name: 'Other' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);

const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

function fmtPeriod(bill: Bill): string {
  const start = bill.period_start;
  if (!start) return fmtDate(bill.invoice_date);
  if (bill.period_type === 'single_date') return fmtDate(start);
  if (bill.period_type === 'month') {
    const d = new Date(start + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }
  if (bill.period_type === 'year')
    return new Date(start + 'T00:00:00').getFullYear().toString();
  return `${fmtDate(start)} – ${fmtDate(bill.period_end)}`;
}

function uid() { return Math.random().toString(36).slice(2); }

// ── Save one bill to DB ───────────────────────────────────────────────────────
async function saveBillToDB(item: QueueItem, userId: string | null): Promise<void> {
  const d = item.data!;

  const bytes = Uint8Array.from(atob(item.base64), (c) => c.charCodeAt(0));
  const blob  = new Blob([bytes], { type: 'application/pdf' });
  const path  = `bills/${Date.now()}_${item.fileName}`;
  const { error: upErr } = await supabase.storage.from('bills').upload(path, blob);
  if (upErr) throw new Error(`PDF upload failed: ${upErr.message}`);
  const file_path = path;

  const isSpecial    = item.locationId === 'corporate' || item.locationId === 'other';
  const dbLocationId = isSpecial ? null : (item.locationId ?? null);
  const pType        = item.periodType ?? 'single_date';

  // Compute normalised period_start / period_end
  let periodStart = item.periodStart ?? d.invoice_date ?? null;
  let periodEnd   = item.periodEnd   ?? null;

  if (pType === 'month' && periodStart) {
    const dt = new Date(periodStart + 'T00:00:00');
    const y  = dt.getFullYear(), mo = dt.getMonth() + 1;
    const lastDay = new Date(y, mo, 0).getDate();
    periodStart = `${y}-${String(mo).padStart(2,'0')}-01`;
    periodEnd   = `${y}-${String(mo).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  } else if (pType === 'year' && periodStart) {
    const yr = new Date(periodStart + 'T00:00:00').getFullYear();
    periodStart = `${yr}-01-01`;
    periodEnd   = `${yr}-12-31`;
  } else if (pType === 'single_date') {
    periodEnd = periodStart;
  }

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
      location_id:    dbLocationId,
      location_label: item.locationLabel ?? null,
      period_type:    pType,
      period_start:   periodStart,
      period_end:     periodEnd,
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
  const queryClient  = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab]               = useState<'upload' | 'bills'>('bills');
  const [isDragging, setIsDragging] = useState(false);
  const [queue, setQueue]           = useState<QueueItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingAll, setSavingAll]   = useState(false);

  const [filterStatus,   setFilterStatus]   = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterLocation, setFilterLocation] = useState('all');
  const [filterMonth,    setFilterMonth]    = useState('all');

  // Inline edit state for saved bills
  type EditDraft = {
    locationId:    string;
    locationLabel: string;
    category:      string;
    periodType:    PeriodType;
    periodStart:   string;
    periodEnd:     string;
  };
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [editDraft,     setEditDraft]     = useState<EditDraft | null>(null);
  const [savingEdit,    setSavingEdit]    = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').order('name');
      return (data ?? []) as Location[];
    },
  });

  const allLocationOptions = [...locations, ...SPECIAL_LOCATIONS];

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ['bills'],
    queryFn: async () => {
      const { data } = await supabase
        .from('bills')
        .select('id, created_at, supplier_name, invoice_number, invoice_date, due_date, gross_amount, net_amount, vat_amount, category, location_label, period_type, period_start, period_end, status, file_path')
        .order('period_start', { ascending: false });
      return (data ?? []) as Bill[];
    },
  });

  const uniqueLocations = Array.from(new Set(bills.map((b) => b.location_label).filter(Boolean))) as string[];

  // Build sorted list of months that have at least one bill (keyed as "YYYY-MM")
  const uniqueMonths: { value: string; label: string }[] = Array.from(
    new Set(
      bills
        .map((b) => b.invoice_date ?? b.period_start)
        .filter(Boolean)
        .map((d) => d!.slice(0, 7)) // "YYYY-MM"
    )
  )
    .sort((a, b) => b.localeCompare(a)) // newest first
    .map((ym) => {
      const [y, m] = ym.split('-');
      const label = new Date(Number(y), Number(m) - 1, 1)
        .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      return { value: ym, label };
    });

  const filtered = bills.filter((b) => {
    if (filterStatus   !== 'all' && b.status         !== filterStatus)   return false;
    if (filterCategory !== 'all' && b.category        !== filterCategory) return false;
    if (filterLocation !== 'all' && b.location_label  !== filterLocation) return false;
    if (filterMonth !== 'all') {
      const dateStr = b.invoice_date ?? b.period_start ?? '';
      if (!dateStr.startsWith(filterMonth)) return false;
    }
    return true;
  });

  const totals = {
    gross: filtered.reduce((s, b) => s + b.gross_amount, 0),
    net:   filtered.reduce((s, b) => s + b.net_amount,   0),
    vat:   filtered.reduce((s, b) => s + b.vat_amount,   0),
  };

  // ── Match delivery address to a known location ────────────────────────────────
  const matchLocation = useCallback((addr: DeliveryAddress | null, locs: Location[]): { locationId: string; locationLabel: string } | null => {
    if (!addr || locs.length === 0) return null;
    const haystack = [addr.full, addr.street, addr.postcode, addr.city]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack) return null;
    // Try each location name as a substring match in the address text
    for (const loc of locs) {
      if (haystack.includes(loc.name.toLowerCase())) {
        return { locationId: loc.id, locationLabel: loc.name };
      }
    }
    // Fallback: match known keywords / postcodes to location names
    const KEYWORD_MAP: Record<string, string> = {
      'eschborn':   'Eschborn',
      '65760':      'Eschborn',
      'taunus':     'Taunus',
      'westend':    'Westend',
      'zentralküche': 'ZK',
      'zentralkueche': 'ZK',
      'central':    'ZK',
      'produktion': 'ZK',
    };
    for (const [kw, locName] of Object.entries(KEYWORD_MAP)) {
      if (haystack.includes(kw)) {
        const loc = locs.find((l) => l.name === locName);
        if (loc) return { locationId: loc.id, locationLabel: loc.name };
      }
    }
    return null;
  }, []);

  // ── Extract via Claude ────────────────────────────────────────────────────────
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
      const invoiceDate = json.data?.invoice_date ?? null;
      const autoLocation = matchLocation(json.data?.delivery_address ?? null, locations);
      setQueue((q) => q.map((i) => i.id === item.id
        ? {
            ...i,
            status: 'done',
            data: json.data,
            periodType: 'single_date',
            periodStart: invoiceDate,
            periodEnd: invoiceDate,
            ...(autoLocation && !i.locationId ? autoLocation : {}),
          }
        : i
      ));
    } catch (err: any) {
      setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'error', error: err.message } : i));
    }
  }, [locations, matchLocation]);

  const processFiles = useCallback(async (files: File[]) => {
    const pdfs = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) return;
    const newItems: QueueItem[] = await Promise.all(
      pdfs.map((file) => new Promise<QueueItem>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          resolve({ id: uid(), fileName: file.name, base64: dataUrl.split(',')[1], status: 'waiting' });
        };
        reader.readAsDataURL(file);
      }))
    );
    setQueue((q) => [...q, ...newItems]);
    setTab('upload');
    for (const item of newItems) await extractItem(item);
  }, [extractItem]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(Array.from(e.dataTransfer.files));
  }, [processFiles]);

  const updateField = (id: string, field: keyof Extracted, value: any) =>
    setQueue((q) => q.map((i) => i.id === id ? { ...i, data: { ...i.data!, [field]: value } } : i));

  const updateMeta = (id: string, patch: Partial<Pick<QueueItem, 'locationId' | 'locationLabel' | 'periodType' | 'periodStart' | 'periodEnd'>>) =>
    setQueue((q) => q.map((i) => i.id === id ? { ...i, ...patch } : i));

  // ── Save all ──────────────────────────────────────────────────────────────────
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

  const removeFromQueue = (id: string) => setQueue((q) => q.filter((i) => i.id !== id));

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('bills').update({ status }).eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['bills'] });
  };

  const deleteBill = async (id: string) => {
    if (!confirm('Delete this bill permanently?')) return;
    // Remove the stored PDF first
    const bill = bills.find((b) => b.id === id);
    if (bill?.file_path) {
      await supabase.storage.from('bills').remove([bill.file_path]);
    }
    await supabase.from('bills').delete().eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['bills'] });
  };

  const startEdit = (bill: Bill) => {
    const isSpecial = !locations.some((l) => l.name === bill.location_label);
    const matchedLoc = locations.find((l) => l.name === bill.location_label);
    setEditDraft({
      locationId:    matchedLoc?.id ?? (bill.location_label === 'Corporate' ? 'corporate' : bill.location_label === 'Other' ? 'other' : ''),
      locationLabel: bill.location_label ?? '',
      category:      bill.category      ?? CATEGORIES[0],
      periodType:    (bill.period_type   as PeriodType) ?? 'single_date',
      periodStart:   bill.period_start   ?? '',
      periodEnd:     bill.period_end     ?? '',
    });
    setEditingBillId(bill.id);
  };

  const saveEdit = async () => {
    if (!editingBillId || !editDraft) return;
    setSavingEdit(true);
    try {
      const pType = editDraft.periodType;
      let periodStart = editDraft.periodStart || null;
      let periodEnd   = editDraft.periodEnd   || null;

      if (pType === 'month' && periodStart) {
        const dt = new Date(periodStart + 'T00:00:00');
        const y = dt.getFullYear(), mo = dt.getMonth() + 1;
        const lastDay = new Date(y, mo, 0).getDate();
        periodStart = `${y}-${String(mo).padStart(2,'0')}-01`;
        periodEnd   = `${y}-${String(mo).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
      } else if (pType === 'year' && periodStart) {
        const yr = new Date(periodStart + 'T00:00:00').getFullYear();
        periodStart = `${yr}-01-01`;
        periodEnd   = `${yr}-12-31`;
      } else if (pType === 'single_date') {
        periodEnd = periodStart;
      }

      const isSpecial    = editDraft.locationId === 'corporate' || editDraft.locationId === 'other';
      const dbLocationId = isSpecial ? null : (editDraft.locationId || null);

      await supabase.from('bills').update({
        category:       editDraft.category,
        location_id:    dbLocationId,
        location_label: editDraft.locationLabel || null,
        period_type:    pType,
        period_start:   periodStart,
        period_end:     periodEnd,
      }).eq('id', editingBillId);

      queryClient.invalidateQueries({ queryKey: ['bills'] });
      setEditingBillId(null);
      setEditDraft(null);
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const doneCount   = queue.filter((i) => i.status === 'done' && !i.saved).length;
  const savedCount  = queue.filter((i) => i.saved).length;
  const activeCount = queue.filter((i) => !i.saved).length;

  // ── Render ────────────────────────────────────────────────────────────────────
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
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 transition-colors ${
                tab === t ? 'border-[#1B5E20] text-[#1B5E20]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'upload' ? <Upload size={14} /> : <Banknote size={14} />}
              {label}
              {t === 'bills' && bills.length > 0 && (
                <span className="bg-gray-100 text-gray-600 text-xs font-bold px-1.5 py-0.5 rounded-full">{bills.length}</span>
              )}
              {t === 'upload' && activeCount > 0 && (
                <span className="bg-[#1B5E20] text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{activeCount}</span>
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
            <p className="text-sm font-semibold text-gray-600 mb-1">Drop multiple PDF invoices here</p>
            <p className="text-xs text-gray-400 mb-4">or click to browse — you can select several files at once</p>
            <span className="px-5 py-2 bg-[#1B5E20] text-white rounded-lg text-xs font-bold inline-block">Browse Files</span>
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
              {doneCount > 0 && (
                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                  <p className="text-sm font-semibold text-green-800">
                    {doneCount} bill{doneCount !== 1 ? 's' : ''} ready to save
                    {savedCount > 0 && <span className="text-green-600 font-normal"> · {savedCount} already saved</span>}
                  </p>
                  <button onClick={saveAll} disabled={savingAll}
                    className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-bold rounded-lg hover:bg-[#2E7D32] disabled:opacity-50 transition-colors">
                    {savingAll ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {savingAll ? 'Saving…' : `Save All ${doneCount} Bills`}
                  </button>
                </div>
              )}

              {queue.map((item) => (
                <div key={item.id}
                  className={`bg-white border rounded-xl overflow-hidden shadow-sm ${item.saved ? 'border-green-200 opacity-60' : 'border-gray-200'}`}>
                  {/* Header */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-shrink-0">
                      {item.status === 'waiting'    && <Clock       size={18} className="text-gray-300" />}
                      {item.status === 'extracting' && <Loader2     size={18} className="text-blue-500 animate-spin" />}
                      {item.status === 'done' && !item.saved && <FileCheck   size={18} className="text-green-500" />}
                      {item.status === 'done' &&  item.saved && <CheckCircle2 size={18} className="text-green-400" />}
                      {item.status === 'error'      && <AlertCircle size={18} className="text-red-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 truncate">{item.fileName}</p>
                      {item.status === 'extracting' && <p className="text-sm font-semibold text-blue-600">Claude is reading…</p>}
                      {item.status === 'waiting'    && <p className="text-sm text-gray-400">Waiting…</p>}
                      {item.status === 'done' && item.data && (
                        <p className="text-sm font-semibold text-gray-900">
                          {item.data.supplier_name}
                          <span className="ml-2 text-[#1B5E20] font-bold">{fmt(item.data.gross_amount)}</span>
                          <span className="ml-2 text-xs font-normal text-gray-400">{item.data.suggested_category}</span>
                          {item.locationLabel && (
                            <span className="ml-2 text-xs font-normal text-indigo-500">· {item.locationLabel}</span>
                          )}
                          {item.saved && <span className="ml-2 text-xs text-green-500">✓ Saved</span>}
                        </p>
                      )}
                      {item.status === 'error' && <p className="text-sm text-red-500">{item.error}</p>}
                    </div>
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
                      <button onClick={() => removeFromQueue(item.id)} className="text-gray-300 hover:text-red-400 transition-colors">
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Review form */}
                  {expandedId === item.id && item.data && (
                    <div className="border-t border-gray-100 px-4 py-4 bg-gray-50 space-y-4">

                      {/* Row 1: Supplier + dates */}
                      <div className="grid grid-cols-4 gap-3">
                        {([
                          { label: 'Supplier',       field: 'supplier_name'  as keyof Extracted, type: 'text' },
                          { label: 'Invoice Number', field: 'invoice_number' as keyof Extracted, type: 'text' },
                          { label: 'Invoice Date',   field: 'invoice_date'   as keyof Extracted, type: 'date' },
                          { label: 'Due Date',       field: 'due_date'       as keyof Extracted, type: 'date' },
                        ]).map(({ label, field, type }) => (
                          <div key={field}>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                            <input type={type} value={(item.data as any)[field] ?? ''}
                              onChange={(e) => updateField(item.id, field, e.target.value || null)}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
                          </div>
                        ))}
                      </div>

                      {/* Row 2: Amounts + category */}
                      <div className="grid grid-cols-4 gap-3">
                        {([
                          { label: 'Net (€)',   field: 'net_amount'   as keyof Extracted },
                          { label: 'VAT (€)',   field: 'vat_amount'   as keyof Extracted },
                          { label: 'Gross (€)', field: 'gross_amount' as keyof Extracted },
                        ]).map(({ label, field }) => (
                          <div key={field}>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                            <input type="number" step="0.01" value={(item.data as any)[field] ?? ''}
                              onChange={(e) => updateField(item.id, field, parseFloat(e.target.value) || 0)}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
                          </div>
                        ))}
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
                          <div className="relative">
                            <select value={item.data.suggested_category}
                              onChange={(e) => updateField(item.id, 'suggested_category', e.target.value)}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 appearance-none pr-6">
                              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                            </select>
                            <ChevronDown size={12} className="absolute right-2 top-2 text-gray-400 pointer-events-none" />
                          </div>
                        </div>
                      </div>

                      {/* Row 3: Location + period */}
                      <div className="grid grid-cols-4 gap-3 pt-2 border-t border-gray-200">
                        {/* Location */}
                        <div>
                          <label className="flex items-center gap-1 text-xs font-semibold text-gray-500 mb-1">
                            <MapPin size={10} />Location
                          </label>
                          <div className="relative">
                            <select value={item.locationId ?? ''}
                              onChange={(e) => {
                                const opt = allLocationOptions.find((l) => l.id === e.target.value);
                                updateMeta(item.id, { locationId: e.target.value || null, locationLabel: opt?.name ?? '' });
                              }}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 appearance-none pr-6">
                              <option value="">— Select location —</option>
                              {locations.length > 0 && (
                                <optgroup label="Restaurants / Sites">
                                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                                </optgroup>
                              )}
                              <optgroup label="Other">
                                {SPECIAL_LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                              </optgroup>
                            </select>
                            <ChevronDown size={12} className="absolute right-2 top-2 text-gray-400 pointer-events-none" />
                          </div>
                          {/* Show detected delivery address */}
                          {item.data?.delivery_address?.full && (
                            <p className="text-[10px] text-gray-400 mt-1 truncate" title={item.data.delivery_address.full}>
                              📍 {item.data.delivery_address.full}
                            </p>
                          )}
                        </div>

                        {/* Period type */}
                        <div>
                          <label className="flex items-center gap-1 text-xs font-semibold text-gray-500 mb-1">
                            <Calendar size={10} />Period Type
                          </label>
                          <div className="relative">
                            <select value={item.periodType ?? 'single_date'}
                              onChange={(e) => {
                                const pt = e.target.value as PeriodType;
                                updateMeta(item.id, { periodType: pt, periodStart: item.data?.invoice_date ?? null, periodEnd: null });
                              }}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 appearance-none pr-6">
                              {(Object.entries(PERIOD_LABELS) as [PeriodType, string][]).map(([v, l]) => (
                                <option key={v} value={v}>{l}</option>
                              ))}
                            </select>
                            <ChevronDown size={12} className="absolute right-2 top-2 text-gray-400 pointer-events-none" />
                          </div>
                        </div>

                        {/* Period start */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">
                            {item.periodType === 'single_date' ? 'Date' :
                             item.periodType === 'month'       ? 'Month (pick any day)' :
                             item.periodType === 'year'        ? 'Year (pick any day)' : 'Start Date'}
                          </label>
                          <input type="date" value={item.periodStart ?? ''}
                            onChange={(e) => updateMeta(item.id, { periodStart: e.target.value || null })}
                            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
                        </div>

                        {/* Period end (custom only) */}
                        {item.periodType === 'custom' ? (
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">End Date</label>
                            <input type="date" value={item.periodEnd ?? ''}
                              onChange={(e) => updateMeta(item.id, { periodEnd: e.target.value || null })}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
                          </div>
                        ) : (
                          <div className="flex items-end pb-1">
                            <p className="text-xs text-gray-400 italic">
                              {item.periodType === 'month' && 'Cost spread over 1 month'}
                              {item.periodType === 'year'  && 'Cost spread over 12 months (÷12/month)'}
                              {item.periodType === 'single_date' && 'Full cost in invoice month'}
                            </p>
                          </div>
                        )}
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
                              {item.data.lines.map((line, li) => (
                                <tr key={li} className={line.is_deposit ? 'text-gray-400 italic' : ''}>
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

              {/* Clear all button */}
              <div className="flex justify-end pt-1">
                <button
                  onClick={() => setQueue([])}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors underline underline-offset-2"
                >
                  Clear all
                </button>
              </div>
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
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30">
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
            </select>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30">
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30">
              <option value="all">All locations</option>
              {uniqueLocations.map((l) => <option key={l}>{l}</option>)}
            </select>
            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30">
              <option value="all">All dates</option>
              {uniqueMonths.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
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
              <button onClick={() => setTab('upload')}
                className="px-4 py-2 bg-[#1B5E20] text-white text-xs font-bold rounded-lg hover:bg-[#2E7D32] transition-colors">
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
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Issue Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Net / Mo</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Gross</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((bill) => {
                    // Compute monthly amount for display
                    let monthlyNet = bill.net_amount;
                    if (bill.period_start && bill.period_end && bill.period_type !== 'single_date') {
                      const s  = new Date(bill.period_start + 'T00:00:00');
                      const e2 = new Date(bill.period_end   + 'T00:00:00');
                      const months = (e2.getFullYear() - s.getFullYear()) * 12 + (e2.getMonth() - s.getMonth()) + 1;
                      if (months > 1) monthlyNet = bill.net_amount / months;
                    }
                    const isSpread = bill.period_type === 'year' || bill.period_type === 'custom';
                    return (
                      <React.Fragment key={bill.id}>
                      <tr className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-semibold text-gray-900">{bill.supplier_name}</td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{bill.invoice_number ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">{fmtPeriod(bill)}</td>
                        <td className="px-4 py-3">
                          {bill.location_label && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-full">
                              <MapPin size={9} />{bill.location_label}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {bill.category && (
                            <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                              {bill.category}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className="text-gray-900">{fmt(monthlyNet)}</span>
                          {isSpread && <span className="block text-[10px] text-gray-400">÷ month</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900 tabular-nums">{fmt(bill.gross_amount)}</td>
                        <td className="px-4 py-3">
                          <select value={bill.status} onChange={(e) => updateStatus(bill.id, e.target.value)}
                            className={`text-xs font-semibold px-2 py-1 rounded-full border cursor-pointer focus:outline-none ${STATUS_STYLES[bill.status]}`}>
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                            <option value="paid">Paid</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {bill.file_path && (
                              <a href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bills/${bill.file_path}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-gray-300 hover:text-blue-500 transition-colors" title="View PDF">
                                <Eye size={14} />
                              </a>
                            )}
                            <button
                              onClick={() => editingBillId === bill.id ? setEditingBillId(null) : startEdit(bill)}
                              className={`transition-colors ${editingBillId === bill.id ? 'text-indigo-500' : 'text-gray-300 hover:text-indigo-500'}`}
                              title="Edit"
                            >
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => deleteBill(bill.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {/* Inline edit row */}
                      {editingBillId === bill.id && editDraft && (
                        <tr className="bg-indigo-50/60">
                          <td colSpan={9} className="px-4 py-4">
                            <div className="grid grid-cols-5 gap-3 items-end">
                              {/* Location */}
                              <div>
                                <label className="flex items-center gap-1 text-xs font-semibold text-gray-500 mb-1">
                                  <MapPin size={10} />Location
                                </label>
                                <div className="relative">
                                  <select
                                    value={editDraft.locationId}
                                    onChange={(e) => {
                                      const opt = allLocationOptions.find((l) => l.id === e.target.value);
                                      setEditDraft((d) => d ? { ...d, locationId: e.target.value, locationLabel: opt?.name ?? '' } : d);
                                    }}
                                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 appearance-none pr-6"
                                  >
                                    <option value="">— Select location —</option>
                                    {locations.length > 0 && (
                                      <optgroup label="Restaurants / Sites">
                                        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                                      </optgroup>
                                    )}
                                    <optgroup label="Other">
                                      {SPECIAL_LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                                    </optgroup>
                                  </select>
                                  <ChevronDown size={12} className="absolute right-2 top-2 text-gray-400 pointer-events-none" />
                                </div>
                              </div>

                              {/* Category */}
                              <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
                                <div className="relative">
                                  <select
                                    value={editDraft.category}
                                    onChange={(e) => setEditDraft((d) => d ? { ...d, category: e.target.value } : d)}
                                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 appearance-none pr-6"
                                  >
                                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                                  </select>
                                  <ChevronDown size={12} className="absolute right-2 top-2 text-gray-400 pointer-events-none" />
                                </div>
                              </div>

                              {/* Period type */}
                              <div>
                                <label className="flex items-center gap-1 text-xs font-semibold text-gray-500 mb-1">
                                  <Calendar size={10} />Period Type
                                </label>
                                <div className="relative">
                                  <select
                                    value={editDraft.periodType}
                                    onChange={(e) => setEditDraft((d) => d ? { ...d, periodType: e.target.value as PeriodType } : d)}
                                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 appearance-none pr-6"
                                  >
                                    {(Object.entries(PERIOD_LABELS) as [PeriodType, string][]).map(([v, l]) => (
                                      <option key={v} value={v}>{l}</option>
                                    ))}
                                  </select>
                                  <ChevronDown size={12} className="absolute right-2 top-2 text-gray-400 pointer-events-none" />
                                </div>
                              </div>

                              {/* Period start */}
                              <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">
                                  {editDraft.periodType === 'single_date' ? 'Date' :
                                   editDraft.periodType === 'month'       ? 'Month (any day)' :
                                   editDraft.periodType === 'year'        ? 'Year (any day)' : 'Start Date'}
                                </label>
                                <input
                                  type="date"
                                  value={editDraft.periodStart}
                                  onChange={(e) => setEditDraft((d) => d ? { ...d, periodStart: e.target.value } : d)}
                                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                />
                              </div>

                              {/* End date (custom only) or save/cancel */}
                              {editDraft.periodType === 'custom' ? (
                                <div>
                                  <label className="block text-xs font-semibold text-gray-500 mb-1">End Date</label>
                                  <input
                                    type="date"
                                    value={editDraft.periodEnd}
                                    onChange={(e) => setEditDraft((d) => d ? { ...d, periodEnd: e.target.value } : d)}
                                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                  />
                                </div>
                              ) : (
                                <div />
                              )}
                            </div>

                            {/* Save / Cancel buttons */}
                            <div className="flex items-center gap-2 mt-3">
                              <button
                                onClick={saveEdit}
                                disabled={savingEdit}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                              >
                                {savingEdit ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                {savingEdit ? 'Saving…' : 'Save Changes'}
                              </button>
                              <button
                                onClick={() => { setEditingBillId(null); setEditDraft(null); }}
                                className="px-3 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg bg-white transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200">
                    <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-gray-500">{filtered.length} bills</td>
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
