'use client';

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Upload, FileCheck, AlertCircle, Loader2,
  CheckCircle2, Clock, Banknote, Trash2,
  ChevronDown, ChevronUp, Eye, X, FilePlus, Save, MapPin, Calendar, Pencil, LayoutList,
  AlertTriangle,
} from 'lucide-react';

import { useT } from '@/lib/i18n';

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
  storagePath?:   string;   // set after pre-upload; used by saveBillToDB to skip re-upload
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

type Counterparty = {
  id:       string;
  name:     string;
  keywords: string[];
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

  let file_path: string;
  if (item.storagePath) {
    // PDF was already uploaded to storage during extraction — reuse it
    file_path = item.storagePath;
  } else {
    const bytes = Uint8Array.from(atob(item.base64), (c) => c.charCodeAt(0));
    const blob  = new Blob([bytes], { type: 'application/pdf' });
    const safeName = item.fileName
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_');
    const path = `bills/${Date.now()}_${safeName}`;
    const { error: upErr } = await supabase.storage.from('bills').upload(path, blob);
    if (upErr) throw new Error(`PDF upload failed: ${upErr.message}`);
    file_path = path;
  }

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

// ── Bill Period Picker ────────────────────────────────────────────────────────
const BP_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function BPMonthSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [y, m] = value ? value.split('-') : ['', ''];
  const cls = 'border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1B5E20] bg-white';
  const curYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => curYear - 7 + i);
  const set = (ny: string, nm: string) => { if (ny && nm) onChange(`${ny}-${nm}`); };
  return (
    <div className="flex gap-2">
      <select value={m ?? ''} onChange={e => set(y, e.target.value)} className={`${cls} flex-1`}>
        <option value="">Month</option>
        {BP_MONTHS.map((mn, i) => <option key={i} value={String(i+1).padStart(2,'0')}>{mn}</option>)}
      </select>
      <select value={y ?? ''} onChange={e => set(e.target.value, m)} className={`${cls} w-24`}>
        <option value="">Year</option>
        {years.map(yr => <option key={yr} value={String(yr)}>{yr}</option>)}
      </select>
    </div>
  );
}

function bpLastDay(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 0).getDate();
  return `${String(y)}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

type BPType = 'one-off' | 'monthly' | 'annual' | 'custom';

function BillPeriodPicker({ bill, onSave }: {
  bill: Bill;
  onSave: (periodType: string, periodStart: string | null, periodEnd: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState({ top: 0, left: 0, flipUp: false });
  const [type, setType] = useState<BPType>('monthly');
  const [start, setStart] = useState('');
  const [end,   setEnd]   = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const initFromBill = () => {
    const pt = bill.period_type;
    const ps = bill.period_start ?? '';
    const pe = bill.period_end   ?? '';
    if (pt === 'single_date') { setType('one-off');  setStart(ps); setEnd(''); }
    else if (pt === 'month')  { setType('monthly');  setStart(ps.slice(0,7)); setEnd(''); }
    else if (pt === 'year')   { setType('annual');   setStart(ps.slice(0,7)); setEnd(pe.slice(0,7)); }
    else if (pt === 'custom') { setType('custom');   setStart(ps); setEnd(pe); }
    else                      { setType('monthly');  setStart(''); setEnd(''); }
  };

  const openPicker = () => {
    initFromBill();
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      const popWidth = 288;
      const left = Math.min(rect.left, window.innerWidth - popWidth - 8);
      setPos({ top: spaceBelow < 280 ? rect.top : rect.bottom + 4, left: Math.max(8, left), flipUp: spaceBelow < 280 });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const apply = () => {
    let pt: string, ps: string | null, pe: string | null;
    if (type === 'one-off') {
      pt = 'single_date'; ps = start || null; pe = ps;
    } else if (type === 'monthly' && start) {
      pt = 'month';
      ps = `${start}-01`;
      pe = bpLastDay(start);
    } else if (type === 'annual' && start) {
      pt = 'year';
      ps = `${start}-01`;
      // end = last day of the month 11 months later (start + 12 months − 1 day)
      const [sy, sm] = start.split('-').map(Number);
      const endMonth = ((sm - 1 + 11) % 12) + 1;
      const endYear  = sy + Math.floor((sm - 1 + 11) / 12);
      pe = bpLastDay(`${String(endYear)}-${String(endMonth).padStart(2,'0')}`);
    } else if (type === 'custom') {
      pt = 'custom'; ps = start || null; pe = end || null;
    } else return;
    onSave(pt, ps, pe);
    setOpen(false);
  };

  const label = bill.period_start
    ? bill.period_type === 'month'
        ? new Date(bill.period_start + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
      : bill.period_type === 'year'
        ? new Date(bill.period_start + 'T00:00:00').getFullYear().toString()
      : bill.period_type === 'custom'
        ? `${fmtDate(bill.period_start)} – ${fmtDate(bill.period_end)}`
      : fmtDate(bill.period_start)
    : '';

  const TYPES: { key: BPType; label: string }[] = [
    { key: 'one-off',  label: 'One-off' },
    { key: 'monthly',  label: 'Monthly' },
    { key: 'annual',   label: 'Annual' },
    { key: 'custom',   label: 'Other period' },
  ];
  const inputCls = 'w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1B5E20]';

  return (
    <div className="relative inline-block">
      <button ref={btnRef} onClick={openPicker}
        className={`text-xs rounded px-1.5 py-0.5 border whitespace-nowrap transition-colors ${
          label
            ? 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100'
            : 'bg-white border-dashed border-gray-300 text-gray-400 hover:border-gray-500 hover:text-gray-600'
        }`}>
        {label || '+ Set period'}
      </button>

      {open && (
        <div ref={popRef}
          style={{ position: 'fixed', top: pos.flipUp ? undefined : pos.top, bottom: pos.flipUp ? (window.innerHeight - pos.top) : undefined, left: pos.left, zIndex: 9999 }}
          className="bg-white border border-gray-200 rounded-xl shadow-2xl p-4 w-72">
          <div className="grid grid-cols-2 gap-1.5 mb-4">
            {TYPES.map(t => (
              <button key={t.key} onClick={() => setType(t.key)}
                className={`py-1.5 px-2 text-xs rounded-lg font-medium border transition-colors ${
                  type === t.key ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}>{t.label}</button>
            ))}
          </div>
          <div className="space-y-2 mb-4">
            {type === 'one-off' && (
              <div><label className="text-xs text-gray-500 block mb-1">Date</label>
                <input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} /></div>
            )}
            {type === 'monthly' && (
              <div><label className="text-xs text-gray-500 block mb-1">Month</label>
                <BPMonthSelect value={start} onChange={setStart} /></div>
            )}
            {type === 'annual' && (
              <div><label className="text-xs text-gray-500 block mb-1">Start month</label>
                <BPMonthSelect value={start} onChange={setStart} /></div>
            )}
            {type === 'custom' && (<>
              <div><label className="text-xs text-gray-500 block mb-1">Start date</label>
                <input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">End date</label>
                <input type="date" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} /></div>
            </>)}
          </div>
          <div className="flex gap-2 items-center">
            {bill.period_start && (
              <button onClick={() => { onSave('', null, null); setOpen(false); }}
                className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg border border-red-200">Clear</button>
            )}
            <div className="flex gap-2 ml-auto">
              <button onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 rounded-lg border border-gray-200">Cancel</button>
              <button onClick={apply}
                className="px-3 py-1.5 text-xs font-medium bg-[#1B5E20] text-white rounded-lg hover:bg-[#2E7D32]">Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function BillsPage() {
  const queryClient  = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useT();

  const [tab, setTab]               = useState<'upload' | 'bills'>('bills');
  const [isDragging, setIsDragging] = useState(false);
  const [queue, setQueue]           = useState<QueueItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingAll, setSavingAll]   = useState(false);
  const [linesBillId, setLinesBillId] = useState<string | null>(null);

  const [filterStatus,     setFilterStatus]     = useState('all');
  const [filterCategory,   setFilterCategory]   = useState('all');
  const [filterLocation,   setFilterLocation]   = useState('all');
  const [filterMonth,      setFilterMonth]      = useState('all');
  const [filterDuplicates, setFilterDuplicates] = useState(false);
  const [sortCol, setSortCol] = useState<string>('invoice_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

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
        .order('invoice_date', { ascending: false, nullsFirst: false });
      return (data ?? []) as Bill[];
    },
  });

  const { data: counterparties = [] } = useQuery<Counterparty[]>({
    queryKey: ['counterparties'],
    queryFn: () => fetch('/api/counterparties').then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: billLines = [] } = useQuery({
    queryKey: ['bill-lines', linesBillId],
    queryFn: async () => {
      if (!linesBillId) return [];
      const { data } = await supabase
        .from('bill_lines')
        .select('id, description, quantity, unit_price, vat_rate, line_total, category')
        .eq('bill_id', linesBillId)
        .order('id');
      return data ?? [];
    },
    enabled: !!linesBillId,
  });

  const uniqueLocations = Array.from(new Set(bills.map((b) => b.location_label).filter(Boolean))) as string[];

  // Build sorted list of months that have at least one bill (keyed as "YYYY-MM")
  const uniqueMonths: { value: string; label: string }[] = Array.from(
    new Set(
      bills
        .map((b) => b.invoice_date)
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

  // ── Duplicate detection ───────────────────────────────────────────────────────
  // A duplicate requires ALL THREE: same supplier + same gross + same net + same invoice number
  const duplicateIds = useMemo(() => {
    const ids = new Set<string>();
    const byKey = new Map<string, string[]>();
    for (const b of bills) {
      if (!b.invoice_number) continue;
      const key = [
        b.supplier_name.toLowerCase().trim(),
        Math.round(b.gross_amount * 100),
        Math.round(b.net_amount * 100),
        b.invoice_number.toLowerCase().trim(),
      ].join('|');
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(b.id);
    }
    for (const group of byKey.values()) {
      if (group.length > 1) group.forEach(id => ids.add(id));
    }
    return ids;
  }, [bills]);

  const isDuplicateInQueue = useCallback((item: QueueItem): boolean => {
    if (item.status !== 'done' || !item.data) return false;
    const d = item.data;
    if (!d.invoice_number) return false;
    const norm = (s: string) => s.toLowerCase().trim();
    const isMatch = (supplier: string, gross: number, net: number, inv: string) =>
      norm(supplier) === norm(d.supplier_name) &&
      Math.abs(gross - d.gross_amount) < 0.01 &&
      Math.abs(net - d.net_amount) < 0.01 &&
      norm(inv) === norm(d.invoice_number!);
    return bills.some(b => b.invoice_number && isMatch(b.supplier_name, b.gross_amount, b.net_amount, b.invoice_number))
      || queue.some(other => {
        if (other.id === item.id || other.status !== 'done' || !other.data?.invoice_number) return false;
        return isMatch(other.data.supplier_name, other.data.gross_amount, other.data.net_amount, other.data.invoice_number);
      });
  }, [bills, queue]);

  // Effective supplier name = matched counterparty name (if any), else raw supplier_name.
  // Used for BOTH display and sorting so the table sorts by what the user actually sees.
  const matchedCpByBill = useMemo(() => {
    const map = new Map<string, Counterparty>();
    for (const b of bills) {
      const lower = (b.supplier_name ?? '').toLowerCase();
      const cp = counterparties.find(cp => {
        const terms = cp.keywords.length > 0 ? cp.keywords : [cp.name];
        return terms.some(kw => kw && lower.includes(kw.toLowerCase()));
      });
      if (cp) map.set(b.id, cp);
    }
    return map;
  }, [bills, counterparties]);

  const displayName = useCallback(
    (b: Bill) => matchedCpByBill.get(b.id)?.name ?? b.supplier_name ?? '',
    [matchedCpByBill],
  );

  const filtered = bills.filter((b) => {
    if (filterStatus   !== 'all' && b.status         !== filterStatus)   return false;
    if (filterCategory !== 'all' && b.category        !== filterCategory) return false;
    if (filterLocation !== 'all' && b.location_label  !== filterLocation) return false;
    if (filterMonth !== 'all') {
      const dateStr = b.invoice_date ?? '';
      if (!dateStr.startsWith(filterMonth)) return false;
    }
    if (filterDuplicates && !duplicateIds.has(b.id)) return false;
    return true;
  });

  const sortedFiltered = useMemo(() => [...filtered].sort((a, b) => {
    let av: string | number, bv: string | number;
    switch (sortCol) {
      case 'supplier':     av = displayName(a);                     bv = displayName(b);                     break;
      case 'invoice_date': av = a.invoice_date ?? ''; bv = b.invoice_date ?? ''; break;
      case 'period_start': av = a.period_start ?? a.invoice_date ?? ''; bv = b.period_start ?? b.invoice_date ?? ''; break;
      case 'location':     av = a.location_label ?? '';             bv = b.location_label ?? '';             break;
      case 'category':     av = a.category ?? '';                   bv = b.category ?? '';                   break;
      case 'net':          av = a.net_amount;                       bv = b.net_amount;                       break;
      case 'vat_pct':      av = a.net_amount > 0 ? a.vat_amount / a.net_amount : 0;
                           bv = b.net_amount > 0 ? b.vat_amount / b.net_amount : 0; break;
      case 'vat_eur':      av = a.vat_amount;                       bv = b.vat_amount;                       break;
      case 'gross':        av = a.gross_amount;                     bv = b.gross_amount;                     break;
      case 'status':       av = a.status ?? '';                     bv = b.status ?? '';                     break;
      default:             av = '';                                  bv = '';
    }
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDir === 'asc' ? cmp : -cmp;
  }), [filtered, sortCol, sortDir, displayName]);

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
    // Fallback: match known keywords / postcodes / streets to location names
    const KEYWORD_MAP: Record<string, string> = {
      // Westend — Feuerbachstrasse 36, 60325 Frankfurt
      'feuerbachstr':   'Westend',
      '60325':          'Westend',
      'westend':        'Westend',
      // Eschborn — Rahmannstrasse 1, 65760 Eschborn
      'rahmannstr':     'Eschborn',
      '65760':          'Eschborn',
      'eschborn':       'Eschborn',
      // Taunus — Taunusstrasse 22, 60329 Frankfurt
      'taunusstr':      'Taunus',
      '60329':          'Taunus',
      'taunus':         'Taunus',
      // Central Kitchen — Alte Königsteiner Strasse 23a, 65779 Kelkheim
      'königsteiner':   'ZK',
      'koenigsteiner':  'ZK',
      'alte k':         'ZK',
      '65779':          'ZK',
      'kelkheim':       'ZK',
      'zentralküche':   'ZK',
      'zentralkueche':  'ZK',
      'central kitchen':'ZK',
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
      // Upload to Supabase Storage first so the API downloads it server-side
      // (avoids Vercel 4.5 MB request body limit on large PDFs)
      const safeName = item.fileName
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_');
      const storagePath = `bills/${Date.now()}_${safeName}`;
      const bytes = Uint8Array.from(atob(item.base64), (c) => c.charCodeAt(0));
      const blob  = new Blob([bytes], { type: 'application/pdf' });
      const { error: upErr } = await supabase.storage.from('bills').upload(storagePath, blob);
      if (upErr) throw new Error(`PDF upload failed: ${upErr.message}`);

      // Record the storage path so saveBillToDB can skip re-uploading
      setQueue((q) => q.map((i) => i.id === item.id ? { ...i, storagePath } : i));

      const res = await fetch('/api/extract-bill', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ storagePath, fileName: item.fileName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Extraction failed');
      const invoiceDate = json.data?.invoice_date ?? null;
      const bpStart = json.data?.billing_period_start ?? null;
      const bpEnd   = json.data?.billing_period_end   ?? null;
      const autoLocation = matchLocation(json.data?.delivery_address ?? null, locations);

      // Derive period type from extracted billing period
      let periodType: PeriodType;
      let periodStart: string | null;
      let periodEnd: string | null;
      if (bpStart && bpEnd) {
        const s = new Date(bpStart + 'T00:00:00');
        const e = new Date(bpEnd   + 'T00:00:00');
        const sameMonthYear = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth();
        const fullYear = s.getMonth() === 0 && e.getMonth() === 11 && s.getFullYear() === e.getFullYear();
        periodType  = sameMonthYear ? 'month' : fullYear ? 'year' : 'custom';
        periodStart = bpStart;
        periodEnd   = bpEnd;
      } else {
        periodType  = 'single_date';
        periodStart = invoiceDate;
        periodEnd   = invoiceDate;
      }

      setQueue((q) => q.map((i) => i.id === item.id
        ? {
            ...i,
            status: 'done',
            data: json.data,
            periodType,
            periodStart,
            periodEnd,
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

  const patchBillPeriod = async (billId: string, periodType: string, periodStart: string | null, periodEnd: string | null) => {
    await fetch(`/api/bills/${billId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period_type: periodType || null, period_start: periodStart, period_end: periodEnd }),
    });
    queryClient.invalidateQueries({ queryKey: ['bills'] });
  };

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
          <h1 className="text-2xl font-bold text-gray-900">{t('bills.title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('bills.subtitle')}</p>
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
                        <p className="text-sm font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                          {item.data.supplier_name}
                          <span className="text-[#1B5E20] font-bold">{fmt(item.data.gross_amount)}</span>
                          <span className="text-xs font-normal text-gray-400">{item.data.suggested_category}</span>
                          {item.locationLabel && (
                            <span className="text-xs font-normal text-indigo-500">· {item.locationLabel}</span>
                          )}
                          {!item.saved && isDuplicateInQueue(item) && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                              <AlertTriangle size={10} /> Possible duplicate
                            </span>
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
            <button
              onClick={() => setFilterDuplicates(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                filterDuplicates
                  ? 'bg-red-50 border-red-300 text-red-700'
                  : duplicateIds.size > 0
                    ? 'bg-white border-red-200 text-red-500 hover:bg-red-50'
                    : 'bg-white border-gray-200 text-gray-400 cursor-default'
              }`}
              disabled={duplicateIds.size === 0}
            >
              <AlertTriangle size={12} />
              Duplicates {duplicateIds.size > 0 && `(${duplicateIds.size})`}
            </button>
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
              <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {([
                      { col: 'supplier',     label: 'Supplier',    align: 'left'  },
                      { col: 'invoice_date', label: 'Issue Date',  align: 'left'  },
                      { col: 'period_start', label: 'Period',       align: 'left'  },
                      { col: 'location',     label: 'Location',    align: 'left'  },
                      { col: 'category',     label: 'Category',    align: 'left'  },
                      { col: 'net',          label: 'Net',         align: 'left' },
                      { col: 'vat_pct',      label: 'VAT %',       align: 'left' },
                      { col: 'vat_eur',      label: 'VAT €',       align: 'left' },
                      { col: 'gross',        label: 'Gross',       align: 'left' },
                      { col: 'status',       label: 'Status',      align: 'left'  },
                    ] as { col: string; label: string; align: 'left' | 'right' }[]).map(({ col, label, align }) => {
                      const active = sortCol === col;
                      return (
                        <th key={col} onClick={() => handleSort(col)}
                          className={`px-2 py-2 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap transition-colors text-left
                            ${active ? 'text-[#1B5E20]' : 'text-gray-500 hover:text-gray-800'}`}>
                          <span className="inline-flex items-center gap-1">
                            {label}
                            <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-20'}`}>
                              {active && sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </span>
                          </span>
                        </th>
                      );
                    })}
                    <th className="px-2 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedFiltered.map((bill) => {
                    const vatAmount = bill.vat_amount;
                    const vatPct    = bill.net_amount > 0 ? (vatAmount / bill.net_amount * 100) : 0;
                    const matchedCp = matchedCpByBill.get(bill.id);
                    return (
                      <React.Fragment key={bill.id}>
                      <tr className={`hover:bg-gray-50 transition-colors ${duplicateIds.has(bill.id) ? 'bg-red-50/40' : ''}`}>
                        <td className="px-2 py-1.5 font-semibold text-gray-900 text-xs max-w-[160px]">
                          <div className="flex items-center gap-1 min-w-0">
                            {duplicateIds.has(bill.id) && (
                              <span title="Possible duplicate bill" className="text-red-500 flex-shrink-0 cursor-default">
                                <AlertTriangle size={11} />
                              </span>
                            )}
                            <span className="truncate">{matchedCp ? matchedCp.name : bill.supplier_name}</span>
                            {matchedCp && (
                              <span title="Matched counterparty" className="text-green-500 flex-shrink-0 cursor-default">
                                <CheckCircle2 size={11} />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap text-xs">{fmtDate(bill.invoice_date)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <BillPeriodPicker
                            bill={bill}
                            onSave={(pt, ps, pe) => patchBillPeriod(bill.id, pt, ps, pe)}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          {bill.location_label && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-full whitespace-nowrap">
                              <MapPin size={9} />{bill.location_label}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 max-w-[110px]">
                          {bill.category && (
                            <span className="inline-block px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full whitespace-nowrap truncate max-w-full">
                              {bill.category}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums text-xs text-gray-900 whitespace-nowrap">{fmt(bill.net_amount)}</td>
                        <td className="px-2 py-1.5 tabular-nums text-xs text-gray-500 whitespace-nowrap">{vatPct.toFixed(1)}%</td>
                        <td className="px-2 py-1.5 tabular-nums text-xs text-gray-500 whitespace-nowrap">{fmt(vatAmount)}</td>
                        <td className="px-2 py-1.5 font-bold text-gray-900 tabular-nums text-xs whitespace-nowrap">{fmt(bill.gross_amount)}</td>
                        <td className="px-2 py-1.5">
                          <select value={bill.status} onChange={(e) => updateStatus(bill.id, e.target.value)}
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full border cursor-pointer focus:outline-none ${STATUS_STYLES[bill.status]}`}>
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                            <option value="paid">Paid</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            {bill.invoice_number && (
                              <span title={`Invoice #${bill.invoice_number}`} className="text-gray-300 cursor-default text-[10px] font-mono leading-none">#</span>
                            )}
                            {bill.file_path && (
                              <a href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bills/${bill.file_path}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-gray-300 hover:text-blue-500 transition-colors" title="View PDF">
                                <Eye size={14} />
                              </a>
                            )}
                            <button
                              onClick={() => setLinesBillId(linesBillId === bill.id ? null : bill.id)}
                              className={`transition-colors ${linesBillId === bill.id ? 'text-green-600' : 'text-gray-300 hover:text-green-600'}`}
                              title="View line items"
                            >
                              <LayoutList size={14} />
                            </button>
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
                          <td colSpan={11} className="px-4 py-4">
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
                    <td colSpan={6} className="px-3 py-2 text-xs font-semibold text-gray-500">{filtered.length} bills</td>
                    <td className="px-3 py-2 text-right font-bold text-gray-700 tabular-nums text-xs">{fmt(totals.net)}</td>
                    <td className="px-3 py-2 text-right text-xs text-gray-400 tabular-nums">
                      {totals.net > 0 ? (totals.vat / totals.net * 100).toFixed(0) + '%' : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-amber-700 tabular-nums text-xs">{fmt(totals.vat)}</td>
                    <td className="px-3 py-2 text-right font-bold text-[#1B5E20] tabular-nums text-xs">{fmt(totals.gross)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
              </div>
            </div>
          )}
        </div>
      )}
      {/* ── Line items modal ─────────────────────────────────────── */}
      {linesBillId && (() => {
        const bill = bills.find(b => b.id === linesBillId);
        const fmtNum = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setLinesBillId(null)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">{bill?.supplier_name}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Invoice {bill?.invoice_number} · {fmtDate(bill?.invoice_date ?? null)}</p>
                </div>
                <button onClick={() => setLinesBillId(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              </div>
              <div className="overflow-y-auto flex-1">
                {billLines.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-sm">No line items captured for this bill</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">VAT %</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(billLines as Record<string, unknown>[]).map((line, i) => (
                        <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-800">{line.description as string}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{line.quantity as number}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600">€{fmtNum(line.unit_price as number)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-500">{line.vat_rate as number}%</td>
                          <td className="px-4 py-2.5 text-right font-medium text-gray-900">€{fmtNum(line.line_total as number)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50">
                        <td colSpan={4} className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">GROSS TOTAL</td>
                        <td className="px-4 py-2.5 text-right font-bold text-gray-900">€{fmtNum(bill?.gross_amount ?? 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
