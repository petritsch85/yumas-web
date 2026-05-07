'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Upload, FileCheck, AlertCircle, Loader2,
  CheckCircle2, Clock, Banknote, Trash2,
  ChevronDown, Eye, X, Save, Pencil,
  FilePlus, Plus, FileDown,
} from 'lucide-react';
import type { BillData, LineItem } from '@/components/bills/BillDocument';
import { useT } from '@/lib/i18n';

// ── Types ─────────────────────────────────────────────────────────────────────

type Extracted = {
  customer_name:    string;
  customer_address: string | null;
  invoice_number:   string | null;
  invoice_date:     string | null;
  event_date:       string | null;
  issuing_location: string | null;
  shift_type:       'lunch' | 'dinner' | null;
  net_food:         number;
  net_drinks:       number;
  net_total:        number;
  vat_7:            number;
  vat_19:           number;
  gross_total:      number;
  tips:             number;
  total_payable:    number;
};

type QueueItem = {
  id:       string;
  fileName: string;
  base64:   string;
  status:   'waiting' | 'extracting' | 'done' | 'error';
  data?:    Extracted;
  error?:   string;
  saved?:   boolean;
};

type OutgoingBill = {
  id:               string;
  created_at:       string;
  invoice_number:   string | null;
  invoice_date:     string | null;
  event_date:       string | null;
  customer_name:    string;
  customer_address: string | null;
  issuing_location: string | null;
  shift_type:       'lunch' | 'dinner' | null;
  net_food:         number;
  net_drinks:       number;
  net_total:        number;
  vat_7:            number;
  vat_19:           number;
  gross_total:      number;
  tips:             number;
  total_payable:    number;
  status:           'pending' | 'paid';
  file_path:        string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const LOCATIONS = ['Westend', 'Eschborn', 'Taunus'];

const isItemReady = (item: { status: string; saved?: boolean; data?: Extracted }) =>
  item.status === 'done' && !item.saved &&
  !!item.data?.issuing_location && !!item.data?.shift_type;

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  paid:    'bg-green-50 text-green-700 border-green-200',
};

const DEFAULT_INTRO_MONTHLY = 'Wir bedanken uns für Ihren Auftrag und stellen Ihnen für die Bestellungen wie folgt eine Rechnung:';
const makeIntroDinner = (eventDate: string) =>
  eventDate
    ? `Wir bedanken uns für Ihren Auftrag und stellen Ihnen für das Abendessen am ${eventDate} wie folgt eine Rechnung:`
    : 'Wir bedanken uns für Ihren Auftrag und stellen Ihnen für das Abendessen wie folgt eine Rechnung:';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);

const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
};

function uid() { return Math.random().toString(36).slice(2); }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OutgoingBillsPage() {
  const queryClient  = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useT();

  const [tab, setTab]               = useState<'bills' | 'upload' | 'create'>('bills');
  const [isDragging, setIsDragging] = useState(false);
  const [queue, setQueue]           = useState<QueueItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingAll, setSavingAll]   = useState(false);

  const [filterStatus,   setFilterStatus]   = useState('all');
  const [filterLocation, setFilterLocation] = useState('all');
  const [filterMonth,    setFilterMonth]    = useState('all');

  // Inline edit
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [editDraft,  setEditDraft]  = useState<Partial<OutgoingBill> | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Create Bill state ─────────────────────────────────────────────────────

  const [billType,          setBillType]          = useState<'monthly' | 'dinner'>('dinner');
  const [invoiceNumber,     setInvoiceNumber]     = useState('');
  const [billDate,          setBillDate]          = useState(today());
  const [billEventDate,     setBillEventDate]     = useState('');
  const [billIssuingLoc,    setBillIssuingLoc]    = useState('');
  const [company,           setCompany]           = useState('');
  const [extra,             setExtra]             = useState('');
  const [contactName,       setContactName]       = useState('');
  const [street,            setStreet]            = useState('');
  const [postcode,          setPostcode]          = useState('');
  const [city,              setCity]              = useState('');
  const [poNumber,          setPoNumber]          = useState('');
  const [att,               setAtt]               = useState('');
  const [introText,         setIntroText]         = useState(makeIntroDinner(''));
  const [essenNetto,        setEssenNetto]        = useState('');
  const [getraenkeNetto,    setGetraenkeNetto]    = useState('');
  const [trinkgeld,         setTrinkgeld]         = useState('');
  const [lineItems,         setLineItems]         = useState<LineItem[]>([{ qty: 1, item: '', unitPrice: 0 }]);
  const [generating,        setGenerating]        = useState(false);

  // Auto-update intro text when event date or bill type changes
  useEffect(() => {
    if (billType === 'dinner') {
      setIntroText(makeIntroDinner(billEventDate));
    } else {
      setIntroText(DEFAULT_INTRO_MONTHLY);
    }
  }, [billType, billEventDate]);

  const handleBillTypeChange = (t: 'monthly' | 'dinner') => {
    setBillType(t);
  };

  const addLineItem = () =>
    setLineItems((prev) => [...prev, { qty: 1, item: '', unitPrice: 0 }]);

  const updateLineItem = (i: number, field: keyof LineItem, value: string) => {
    setLineItems((prev) =>
      prev.map((row, idx) =>
        idx === i ? { ...row, [field]: field === 'item' ? value : parseFloat(value) || 0 } : row
      )
    );
  };

  const removeLineItem = (i: number) =>
    setLineItems((prev) => prev.filter((_, idx) => idx !== i));

  const buildBillData = useCallback((): BillData => ({
    invoiceNumber,
    date:            billDate,
    eventDate:       billEventDate || undefined,
    issuingLocation: billIssuingLoc || undefined,
    type:            billType,
    recipient: { company, extra, contact: contactName, street, postcode, city, poNumber, att },
    introText,
    lineItems:      billType === 'monthly' ? lineItems   : undefined,
    essenNetto:     billType === 'dinner'  ? parseFloat(essenNetto)     || 0 : undefined,
    getraenkeNetto: billType === 'dinner'  ? parseFloat(getraenkeNetto) || 0 : undefined,
    trinkgeld:      billType === 'dinner'  ? parseFloat(trinkgeld)      || 0 : undefined,
  }), [invoiceNumber, billDate, billEventDate, billIssuingLoc, billType, company, extra,
       contactName, street, postcode, city, poNumber, att, introText, lineItems,
       essenNetto, getraenkeNetto, trinkgeld]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const [{ pdf }, { BillDocument: BillDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/bills/BillDocument'),
      ]);
      const data = buildBillData();
      const blob = await pdf(<BillDoc data={data} />).toBlob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${invoiceNumber || 'Rechnung'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('PDF generation failed:', err);
      alert(`Could not generate PDF: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setGenerating(false);
    }
  };

  // Live totals
  const essenN     = parseFloat(essenNetto)     || 0;
  const getraenkeN = parseFloat(getraenkeNetto) || 0;
  const trinkgeldN = parseFloat(trinkgeld)      || 0;
  const linesTotal = lineItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const netto      = billType === 'monthly' ? linesTotal : essenN + getraenkeN;
  const mwst7      = billType === 'monthly' ? netto * 0.07 : essenN * 0.07;
  const mwst19     = billType === 'dinner'  ? getraenkeN * 0.19 : 0;
  const brutto     = netto + mwst7 + mwst19;
  const billTotal  = brutto + (billType === 'dinner' ? trinkgeldN : 0);

  const fmtEur = (n: number) =>
    n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ['outgoing-bills'],
    queryFn: async () => {
      const { data } = await supabase
        .from('outgoing_bills')
        .select('*')
        .order('event_date', { ascending: false });
      return (data ?? []) as OutgoingBill[];
    },
  });

  const uniqueMonths: { value: string; label: string }[] = Array.from(
    new Set(bills.map((b) => (b.event_date ?? b.invoice_date)?.slice(0, 7)).filter(Boolean) as string[])
  )
    .sort((a, b) => b.localeCompare(a))
    .map((ym) => {
      const [y, m] = ym.split('-');
      return { value: ym, label: new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
    });

  const filtered = bills.filter((b) => {
    if (filterStatus   !== 'all' && b.status           !== filterStatus)   return false;
    if (filterLocation !== 'all' && b.issuing_location !== filterLocation) return false;
    if (filterMonth    !== 'all') {
      const d = b.event_date ?? b.invoice_date ?? '';
      if (!d.startsWith(filterMonth)) return false;
    }
    return true;
  });

  const totals = {
    gross: filtered.reduce((s, b) => s + b.gross_total,   0),
    net:   filtered.reduce((s, b) => s + b.net_total,     0),
    tips:  filtered.reduce((s, b) => s + b.tips,          0),
    total: filtered.reduce((s, b) => s + b.total_payable, 0),
  };

  // ── Extract via Claude ────────────────────────────────────────────────────

  const extractItem = useCallback(async (item: QueueItem) => {
    setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'extracting' } : i));
    try {
      const res  = await fetch('/api/extract-outgoing-bill', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pdfBase64: item.base64, fileName: item.fileName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Extraction failed');
      setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'done', data: json.data } : i));
    } catch (err: any) {
      setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'error', error: err.message } : i));
    }
  }, []);

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

  // ── Save all ──────────────────────────────────────────────────────────────

  const saveAll = useCallback(async () => {
    const toSave = queue.filter(isItemReady);
    if (!toSave.length) return;
    // Auto-expand blocked items so the user can fill in the missing fields
    const blocked = queue.filter((i) => i.status === 'done' && !i.saved && !isItemReady(i));
    if (blocked.length > 0) {
      setExpandedId(blocked[0].id);
    }
    setSavingAll(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      for (const item of toSave) {
        const d = item.data!;
        const bytes    = Uint8Array.from(atob(item.base64), (c) => c.charCodeAt(0));
        const blob     = new Blob([bytes], { type: 'application/pdf' });
        const path     = `outgoing-bills/${Date.now()}_${item.fileName}`;
        const { error: upErr } = await supabase.storage.from('bills').upload(path, blob);
        if (upErr) throw new Error(`PDF upload failed: ${upErr.message}`);
        const { error } = await supabase.from('outgoing_bills').insert({
          invoice_number:   d.invoice_number   ?? null,
          invoice_date:     d.invoice_date     ?? null,
          event_date:       d.event_date       ?? null,
          customer_name:    d.customer_name,
          customer_address: d.customer_address ?? null,
          issuing_location: d.issuing_location,
          shift_type:       d.shift_type,
          net_food:         d.net_food         ?? 0,
          net_drinks:       d.net_drinks       ?? 0,
          net_total:        d.net_total        ?? 0,
          vat_7:            d.vat_7            ?? 0,
          vat_19:           d.vat_19           ?? 0,
          gross_total:      d.gross_total      ?? 0,
          tips:             d.tips             ?? 0,
          total_payable:    d.total_payable    ?? 0,
          status:           'pending',
          file_path:        path,
          uploaded_by:      user?.id ?? null,
        });
        if (error) throw error;
        setQueue((q) => q.map((i) => i.id === item.id ? { ...i, saved: true } : i));
      }
      queryClient.invalidateQueries({ queryKey: ['outgoing-bills'] });
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSavingAll(false);
    }
  }, [queue, queryClient]);

  const removeFromQueue = (id: string) => setQueue((q) => q.filter((i) => i.id !== id));

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('outgoing_bills').update({ status }).eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['outgoing-bills'] });
  };

  const deleteBill = async (id: string) => {
    if (!confirm('Delete this outgoing bill permanently?')) return;
    const bill = bills.find((b) => b.id === id);
    if (bill?.file_path) await supabase.storage.from('bills').remove([bill.file_path]);
    await supabase.from('outgoing_bills').delete().eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['outgoing-bills'] });
  };

  const startEdit = (bill: OutgoingBill) => {
    setEditDraft({ ...bill });
    setEditingId(bill.id);
  };

  const saveEdit = async () => {
    if (!editingId || !editDraft) return;
    setSavingEdit(true);
    try {
      await supabase.from('outgoing_bills').update({
        customer_name:    editDraft.customer_name,
        invoice_number:   editDraft.invoice_number   ?? null,
        invoice_date:     editDraft.invoice_date     ?? null,
        event_date:       editDraft.event_date       ?? null,
        issuing_location: editDraft.issuing_location ?? null,
        shift_type:       editDraft.shift_type       ?? null,
        net_food:         editDraft.net_food         ?? 0,
        net_drinks:       editDraft.net_drinks       ?? 0,
        net_total:        editDraft.net_total        ?? 0,
        vat_7:            editDraft.vat_7            ?? 0,
        vat_19:           editDraft.vat_19           ?? 0,
        gross_total:      editDraft.gross_total      ?? 0,
        tips:             editDraft.tips             ?? 0,
        total_payable:    editDraft.total_payable    ?? 0,
      }).eq('id', editingId);
      queryClient.invalidateQueries({ queryKey: ['outgoing-bills'] });
      setEditingId(null);
      setEditDraft(null);
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const doneCount    = queue.filter((i) => i.status === 'done' && !i.saved).length;
  const readyCount   = queue.filter(isItemReady).length;
  const blockedCount = queue.filter((i) => i.status === 'done' && !i.saved && !isItemReady(i)).length;
  const savedCount   = queue.filter((i) => i.saved).length;
  const activeCount  = queue.filter((i) => !i.saved).length;

  const inputCls = 'w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/40 focus:border-[#1B5E20] transition-colors';
  const labelCls = 'block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('bills.outgoingTitle')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('bills.outgoingSubtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTab('create')}
            className="flex items-center gap-2 px-4 py-2 bg-white text-[#1B5E20] border border-[#1B5E20] text-sm font-semibold rounded-xl hover:bg-green-50 transition-colors"
          >
            <FilePlus size={15} />
            Create Bill
          </button>
          <button
            onClick={() => { setTab('upload'); setTimeout(() => fileInputRef.current?.click(), 100); }}
            className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-semibold rounded-xl hover:bg-[#2E7D32] transition-colors"
          >
            <Upload size={15} />
            Upload Invoice
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {([
            ['bills',  'All Invoices', <Banknote size={14} />],
            ['upload', 'Upload',       <Upload   size={14} />],
            ['create', 'Create Bill',  <FilePlus size={14} />],
          ] as const).map(([t, label, icon]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 transition-colors ${
                tab === t ? 'border-[#1B5E20] text-[#1B5E20]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {icon}
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
            <p className="text-sm font-semibold text-gray-600 mb-1">Drop outgoing invoice PDFs here</p>
            <p className="text-xs text-gray-400 mb-4">or click to browse — Claude will extract all fields automatically</p>
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

          {queue.length > 0 && (
            <div className="space-y-3">
              {doneCount > 0 && (
                <div className="space-y-2">
                  {blockedCount > 0 && (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700">
                      <AlertCircle size={15} className="flex-shrink-0" />
                      <span>
                        <span className="font-bold">{blockedCount} invoice{blockedCount !== 1 ? 's' : ''}</span>
                        {' '}missing <span className="font-semibold">Location</span> and/or <span className="font-semibold">Shift Type</span> — click Review to complete them before saving.
                      </span>
                    </div>
                  )}
                  <div className={`flex items-center justify-between rounded-xl px-4 py-3 border ${readyCount > 0 ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                    <p className="text-sm font-semibold text-green-800">
                      {readyCount > 0
                        ? <>{readyCount} invoice{readyCount !== 1 ? 's' : ''} ready to save</>
                        : <span className="text-gray-500">No invoices ready yet — fill in required fields above</span>
                      }
                      {savedCount > 0 && <span className="text-green-600 font-normal"> · {savedCount} already saved</span>}
                    </p>
                    <button onClick={saveAll} disabled={savingAll || readyCount === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-bold rounded-lg hover:bg-[#2E7D32] disabled:opacity-50 transition-colors">
                      {savingAll ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      {savingAll ? 'Saving…' : `Save ${readyCount > 0 ? readyCount : 'All'}`}
                    </button>
                  </div>
                </div>
              )}

              {queue.map((item) => {
                const missingFields = item.status === 'done' && !item.saved && (
                  !item.data?.issuing_location || !item.data?.shift_type
                );
                const missingList = item.status === 'done' && !item.saved ? [
                  !item.data?.issuing_location && 'Location',
                  !item.data?.shift_type       && 'Shift Type',
                ].filter(Boolean).join(' & ') : '';
                return (
                <div key={item.id}
                  className={`bg-white border rounded-xl overflow-hidden shadow-sm ${
                    item.saved        ? 'border-green-200 opacity-60' :
                    missingFields     ? 'border-red-200' :
                    'border-gray-200'
                  }`}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-shrink-0">
                      {item.status === 'waiting'    && <Clock        size={18} className="text-gray-300" />}
                      {item.status === 'extracting' && <Loader2      size={18} className="text-blue-500 animate-spin" />}
                      {item.status === 'done' && !item.saved && !missingFields && <FileCheck    size={18} className="text-green-500" />}
                      {item.status === 'done' && !item.saved &&  missingFields && <AlertCircle  size={18} className="text-red-400" />}
                      {item.status === 'done' &&  item.saved && <CheckCircle2 size={18} className="text-green-400" />}
                      {item.status === 'error'      && <AlertCircle  size={18} className="text-red-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 truncate">{item.fileName}</p>
                      {item.status === 'extracting' && <p className="text-sm font-semibold text-blue-600">Claude is reading…</p>}
                      {item.status === 'waiting'    && <p className="text-sm text-gray-400">Waiting…</p>}
                      {item.status === 'done' && item.data && (
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5">
                          <p className="text-sm font-semibold text-gray-900">
                            {item.data.customer_name}
                            {item.data.invoice_number && <span className="ml-2 text-xs font-mono text-gray-400">#{item.data.invoice_number}</span>}
                            <span className="ml-2 text-[#1B5E20] font-bold">{fmt(item.data.total_payable)}</span>
                          </p>
                          {item.data.event_date && <span className="text-xs text-gray-400">Event: {fmtDate(item.data.event_date)}</span>}
                          {item.data.issuing_location
                            ? <span className="text-xs text-indigo-500">· {item.data.issuing_location}</span>
                            : !item.saved && <span className="text-xs font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">No Location</span>
                          }
                          {item.data.shift_type
                            ? <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${item.data.shift_type === 'lunch' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                                {item.data.shift_type === 'lunch' ? '☀️ Lunch' : '🌙 Dinner'}
                              </span>
                            : !item.saved && <span className="text-xs font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">No Shift Type</span>
                          }
                          {item.saved && <span className="text-xs text-green-500">✓ Saved</span>}
                        </div>
                      )}
                      {item.status === 'error' && <p className="text-sm text-red-500">{item.error}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {item.status === 'done' && !item.saved && (
                        <button
                          onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                          className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 border rounded-lg transition-colors ${
                            missingFields
                              ? 'text-red-600 border-red-300 bg-red-50 hover:bg-red-100'
                              : 'text-gray-500 border-gray-200 hover:text-gray-700'
                          }`}
                        >
                          {expandedId === item.id ? 'Hide' : missingFields ? `⚠ Fill ${missingList}` : 'Review'}
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

                      {/* ── REQUIRED FIELDS (top, prominent) ── */}
                      <div className={`rounded-lg border-2 p-3 space-y-3 ${
                        !item.data.issuing_location || !item.data.shift_type
                          ? 'border-red-300 bg-red-50'
                          : 'border-green-300 bg-green-50'
                      }`}>
                        <p className={`text-xs font-bold uppercase tracking-wide ${
                          !item.data.issuing_location || !item.data.shift_type ? 'text-red-600' : 'text-green-700'
                        }`}>
                          {!item.data.issuing_location || !item.data.shift_type
                            ? '⚠ Required — fill in before saving'
                            : '✓ Required fields complete'}
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          {/* Location */}
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">
                              Issuing Location <span className="text-red-500">*</span>
                            </label>
                            <div className="relative">
                              <select value={item.data.issuing_location ?? ''}
                                onChange={(e) => updateField(item.id, 'issuing_location', e.target.value || null)}
                                className={`w-full border rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 appearance-none pr-6 ${
                                  !item.data.issuing_location
                                    ? 'border-red-300 focus:ring-red-300'
                                    : 'border-gray-200 focus:ring-[#1B5E20]/30'
                                }`}>
                                <option value="">— Select location —</option>
                                {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
                              </select>
                              <ChevronDown size={12} className="absolute right-2 top-2 text-gray-400 pointer-events-none" />
                            </div>
                          </div>
                          {/* Shift Type */}
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">
                              Shift Type <span className="text-red-500">*</span>
                            </label>
                            <div className="flex gap-2">
                              {(['lunch', 'dinner'] as const).map((s) => (
                                <button key={s}
                                  onClick={() => updateField(item.id, 'shift_type', item.data!.shift_type === s ? null : s)}
                                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                    item.data!.shift_type === s
                                      ? s === 'lunch'
                                        ? 'bg-amber-500 text-white border-amber-500'
                                        : 'bg-blue-600 text-white border-blue-600'
                                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                                  }`}>
                                  {s === 'lunch' ? '☀️ Lunch' : '🌙 Dinner'}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* ── Standard fields ── */}
                      <div className="grid grid-cols-4 gap-3">
                        {([
                          { label: 'Customer',       field: 'customer_name'  as keyof Extracted, type: 'text' },
                          { label: 'Invoice Number', field: 'invoice_number' as keyof Extracted, type: 'text' },
                          { label: 'Invoice Date',   field: 'invoice_date'   as keyof Extracted, type: 'date' },
                          { label: 'Event Date',     field: 'event_date'     as keyof Extracted, type: 'date' },
                        ]).map(({ label, field, type }) => (
                          <div key={field}>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                            <input type={type} value={(item.data as any)[field] ?? ''}
                              onChange={(e) => updateField(item.id, field, e.target.value || null)}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        {([
                          { label: 'Net Food (€)',    field: 'net_food'    as keyof Extracted },
                          { label: 'Net Drinks (€)',  field: 'net_drinks'  as keyof Extracted },
                          { label: 'Net Total (€)',   field: 'net_total'   as keyof Extracted },
                          { label: 'VAT 7% (€)',      field: 'vat_7'       as keyof Extracted },
                        ]).map(({ label, field }) => (
                          <div key={field}>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                            <input type="number" step="0.01" value={(item.data as any)[field] ?? ''}
                              onChange={(e) => updateField(item.id, field, parseFloat(e.target.value) || 0)}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        {([
                          { label: 'VAT 19% (€)',      field: 'vat_19'       as keyof Extracted },
                          { label: 'Gross Total (€)',   field: 'gross_total'  as keyof Extracted },
                          { label: 'Tips (€)',          field: 'tips'         as keyof Extracted },
                          { label: 'Total Payable (€)', field: 'total_payable'as keyof Extracted },
                        ]).map(({ label, field }) => (
                          <div key={field}>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                            <input type="number" step="0.01" value={(item.data as any)[field] ?? ''}
                              onChange={(e) => updateField(item.id, field, parseFloat(e.target.value) || 0)}
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-4 gap-3 pt-2 border-t border-gray-200">
                        <div className="col-span-4">
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Customer Address</label>
                          <input type="text" value={item.data.customer_address ?? ''}
                            onChange={(e) => updateField(item.id, 'customer_address', e.target.value || null)}
                            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
              })}

              <div className="flex justify-end pt-1">
                <button onClick={() => setQueue([])} className="text-xs text-gray-400 hover:text-red-500 transition-colors underline underline-offset-2">
                  Clear all
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ CREATE BILL TAB ═══════ */}
      {tab === 'create' && (
        <div className="max-w-3xl space-y-5">

          {/* Bill type */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className={labelCls}>Bill Type</p>
            <div className="flex gap-3">
              {(['dinner', 'monthly'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => handleBillTypeChange(t)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                    billType === t
                      ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20]'
                  }`}
                >
                  {t === 'dinner' ? 'Dinner / Event' : 'Monthly Orders'}
                </button>
              ))}
            </div>
          </div>

          {/* Invoice details */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-sm font-bold text-gray-800 mb-4 pb-3 border-b border-gray-100">Invoice Details</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Invoice Number</label>
                <input className={inputCls} placeholder="e.g. 75-26"
                  value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Invoice Date (DD.MM.YYYY)</label>
                <input className={inputCls} placeholder={today()}
                  value={billDate} onChange={(e) => setBillDate(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Event Date (DD.MM.YYYY)</label>
                <input className={inputCls} placeholder="e.g. 27.01.2026"
                  value={billEventDate} onChange={(e) => setBillEventDate(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Event Location</label>
                <div className="relative">
                  <select
                    className={`${inputCls} appearance-none pr-8`}
                    value={billIssuingLoc}
                    onChange={(e) => setBillIssuingLoc(e.target.value)}
                  >
                    <option value="">— Select location —</option>
                    {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          {/* Recipient */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-sm font-bold text-gray-800 mb-4 pb-3 border-b border-gray-100">Recipient</p>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Company Name *</label>
                <input className={inputCls} placeholder="e.g. KIA Europe GmbH"
                  value={company} onChange={(e) => setCompany(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Extra line (e.g. branch name — optional)</label>
                <input className={inputCls} placeholder="e.g. Zweigniederlassung Deutschland"
                  value={extra} onChange={(e) => setExtra(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Contact Name (optional)</label>
                <input className={inputCls} placeholder="e.g. Bimal Sahoo"
                  value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Street Address *</label>
                <input className={inputCls} placeholder="e.g. Theodor-Heuss-Allee 11"
                  value={street} onChange={(e) => setStreet(e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Postcode *</label>
                  <input className={inputCls} placeholder="60486"
                    value={postcode} onChange={(e) => setPostcode(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>City *</label>
                  <input className={inputCls} placeholder="Frankfurt am Main"
                    value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>PO Number (optional)</label>
                  <input className={inputCls} placeholder="e.g. 2700061132"
                    value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Att: (optional)</label>
                  <input className={inputCls} placeholder="e.g. Zara Hajiali"
                    value={att} onChange={(e) => setAtt(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          {/* Intro text */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <label className={labelCls}>Intro Text</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={3}
              value={introText}
              onChange={(e) => setIntroText(e.target.value)}
            />
          </div>

          {/* Monthly: line items */}
          {billType === 'monthly' && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold text-gray-700">Line Items</p>
                <button onClick={addLineItem}
                  className="flex items-center gap-1.5 text-sm text-[#1B5E20] font-medium hover:underline">
                  <Plus size={14} /> Add row
                </button>
              </div>
              <div className="grid grid-cols-[50px_1fr_120px_90px_32px] gap-2 mb-2">
                {['Qty','Item','Unit Price €','Total',''].map((h) => (
                  <p key={h} className="text-xs font-semibold text-gray-400 uppercase">{h}</p>
                ))}
              </div>
              {lineItems.map((row, i) => (
                <div key={i} className="grid grid-cols-[50px_1fr_120px_90px_32px] gap-2 mb-2 items-center">
                  <input type="number" min="1" className={inputCls} value={row.qty}
                    onChange={(e) => updateLineItem(i, 'qty', e.target.value)} />
                  <input type="text" className={inputCls} placeholder="e.g. Chicken Burrito"
                    value={row.item} onChange={(e) => updateLineItem(i, 'item', e.target.value)} />
                  <input type="number" step="0.01" className={inputCls} placeholder="12.62"
                    value={row.unitPrice || ''} onChange={(e) => updateLineItem(i, 'unitPrice', e.target.value)} />
                  <div className={`${inputCls} bg-gray-50 text-right text-gray-700`}>
                    {fmtEur(row.qty * row.unitPrice)}
                  </div>
                  <button onClick={() => removeLineItem(i)} className="text-gray-300 hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Dinner: amounts */}
          {billType === 'dinner' && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <p className="text-sm font-bold text-gray-800 mb-4 pb-3 border-b border-gray-100">Amounts</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Essen Netto (€)</label>
                  <input type="number" step="0.01" className={inputCls} placeholder="0.00"
                    value={essenNetto} onChange={(e) => setEssenNetto(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Getränke Netto (€)</label>
                  <input type="number" step="0.01" className={inputCls} placeholder="0.00"
                    value={getraenkeNetto} onChange={(e) => setGetraenkeNetto(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Trinkgeld (€) — optional</label>
                  <input type="number" step="0.01" className={inputCls} placeholder="0.00"
                    value={trinkgeld} onChange={(e) => setTrinkgeld(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* Live totals */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-sm font-bold text-gray-800 mb-3 pb-3 border-b border-gray-100">Totals Preview</p>
            <div className="space-y-1 text-sm max-w-xs ml-auto">
              {billType === 'dinner' && (
                <>
                  <div className="flex justify-between text-gray-600">
                    <span>Gesamt Essen netto</span><span>{fmtEur(essenN)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Gesamt Getränke netto</span><span>{fmtEur(getraenkeN)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-gray-600">
                <span>Gesamt Netto</span><span>{fmtEur(netto)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Mwst (7%)</span><span>{fmtEur(mwst7)}</span>
              </div>
              {billType === 'dinner' && (
                <div className="flex justify-between text-gray-600">
                  <span>Mwst (19%)</span><span>{fmtEur(mwst19)}</span>
                </div>
              )}
              <div className="border-t border-gray-100 my-1" />
              <div className="flex justify-between text-gray-600">
                <span>Gesamt Brutto</span><span>{fmtEur(brutto)}</span>
              </div>
              {billType === 'dinner' && trinkgeldN > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Trinkgeld</span><span>{fmtEur(trinkgeldN)}</span>
                </div>
              )}
              <div className="border-t border-gray-200 my-1" />
              <div className="flex justify-between font-bold text-gray-900">
                <span>Gesamtbetrag</span><span>{fmtEur(billTotal)}</span>
              </div>
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full flex items-center justify-center gap-2 bg-[#1B5E20] text-white py-3 rounded-lg text-sm font-bold hover:bg-[#2E7D32] transition-colors disabled:opacity-50"
          >
            <FileDown size={16} />
            {generating ? 'Generating PDF…' : 'Generate & Download PDF'}
          </button>

        </div>
      )}

      {/* ═══════ BILLS TAB ═══════ */}
      {tab === 'bills' && (
        <div>
          {/* Summary cards */}
          {bills.length > 0 && (
            <div className="grid grid-cols-4 gap-4 mb-5">
              {[
                { label: 'Net Total',     value: fmt(totals.net),   color: 'text-blue-700' },
                { label: 'Gross Total',   value: fmt(totals.gross), color: 'text-gray-900' },
                { label: 'Tips Total',    value: fmt(totals.tips),  color: 'text-amber-700' },
                { label: 'Total Payable', value: fmt(totals.total), color: 'text-[#1B5E20]' },
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
              <option value="paid">Paid</option>
            </select>
            <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30">
              <option value="all">All locations</option>
              {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
            </select>
            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30">
              <option value="all">All dates</option>
              {uniqueMonths.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
            <span className="text-xs text-gray-400 ml-auto">{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 size={24} className="text-gray-300 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 border border-dashed border-gray-200 rounded-xl gap-3">
              <Banknote size={36} className="text-gray-200" />
              <p className="text-sm text-gray-400">No outgoing invoices yet</p>
              <div className="flex gap-2">
                <button onClick={() => setTab('create')}
                  className="px-4 py-2 bg-white text-[#1B5E20] border border-[#1B5E20] text-xs font-bold rounded-lg hover:bg-green-50 transition-colors">
                  Create Bill
                </button>
                <button onClick={() => setTab('upload')}
                  className="px-4 py-2 bg-[#1B5E20] text-white text-xs font-bold rounded-lg hover:bg-[#2E7D32] transition-colors">
                  Upload Invoice
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoice #</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Event Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Shift</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Net</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Gross</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Tips</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Payable</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((bill) => (
                    <React.Fragment key={bill.id}>
                      <tr className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-semibold text-gray-900">{bill.customer_name}</td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{bill.invoice_number ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">{fmtDate(bill.event_date)}</td>
                        <td className="px-4 py-3">
                          {bill.issuing_location
                            ? <span className="inline-flex items-center px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-full">{bill.issuing_location}</span>
                            : <span className="text-xs text-red-400">—</span>
                          }
                        </td>
                        <td className="px-4 py-3">
                          {bill.shift_type
                            ? <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full font-semibold ${bill.shift_type === 'lunch' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                                {bill.shift_type === 'lunch' ? '☀️ Lunch' : '🌙 Dinner'}
                              </span>
                            : <span className="text-xs text-red-400">—</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmt(bill.net_total)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-900">{fmt(bill.gross_total)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-amber-700">{bill.tips > 0 ? fmt(bill.tips) : '—'}</td>
                        <td className="px-4 py-3 text-right font-bold text-[#1B5E20] tabular-nums">{fmt(bill.total_payable)}</td>
                        <td className="px-4 py-3">
                          <select value={bill.status} onChange={(e) => updateStatus(bill.id, e.target.value)}
                            className={`text-xs font-semibold px-2 py-1 rounded-full border cursor-pointer focus:outline-none ${STATUS_STYLES[bill.status]}`}>
                            <option value="pending">Pending</option>
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
                              onClick={() => editingId === bill.id ? setEditingId(null) : startEdit(bill)}
                              className={`transition-colors ${editingId === bill.id ? 'text-indigo-500' : 'text-gray-300 hover:text-indigo-500'}`}
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
                      {editingId === bill.id && editDraft && (
                        <tr className="bg-indigo-50/60">
                          <td colSpan={11} className="px-4 py-4">
                            <div className="grid grid-cols-4 gap-3 mb-3">
                              {([
                                { label: 'Customer',       field: 'customer_name'  as keyof OutgoingBill, type: 'text' },
                                { label: 'Invoice Number', field: 'invoice_number' as keyof OutgoingBill, type: 'text' },
                                { label: 'Invoice Date',   field: 'invoice_date'   as keyof OutgoingBill, type: 'date' },
                                { label: 'Event Date',     field: 'event_date'     as keyof OutgoingBill, type: 'date' },
                              ]).map(({ label, field, type }) => (
                                <div key={field}>
                                  <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                                  <input type={type} value={(editDraft as any)[field] ?? ''}
                                    onChange={(e) => setEditDraft((d) => d ? { ...d, [field]: e.target.value || null } : d)}
                                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                                </div>
                              ))}
                            </div>
                            <div className="grid grid-cols-4 gap-3 mb-3">
                              {([
                                { label: 'Net Food (€)',    field: 'net_food'    as keyof OutgoingBill },
                                { label: 'Net Drinks (€)',  field: 'net_drinks'  as keyof OutgoingBill },
                                { label: 'Net Total (€)',   field: 'net_total'   as keyof OutgoingBill },
                                { label: 'Gross Total (€)', field: 'gross_total' as keyof OutgoingBill },
                              ]).map(({ label, field }) => (
                                <div key={field}>
                                  <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                                  <input type="number" step="0.01" value={(editDraft as any)[field] ?? 0}
                                    onChange={(e) => setEditDraft((d) => d ? { ...d, [field]: parseFloat(e.target.value) || 0 } : d)}
                                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                                </div>
                              ))}
                            </div>
                            <div className="grid grid-cols-4 gap-3 mb-3">
                              {([
                                { label: 'VAT 7% (€)',        field: 'vat_7'         as keyof OutgoingBill },
                                { label: 'VAT 19% (€)',       field: 'vat_19'        as keyof OutgoingBill },
                                { label: 'Tips (€)',          field: 'tips'          as keyof OutgoingBill },
                                { label: 'Total Payable (€)', field: 'total_payable' as keyof OutgoingBill },
                              ]).map(({ label, field }) => (
                                <div key={field}>
                                  <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                                  <input type="number" step="0.01" value={(editDraft as any)[field] ?? 0}
                                    onChange={(e) => setEditDraft((d) => d ? { ...d, [field]: parseFloat(e.target.value) || 0 } : d)}
                                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                                </div>
                              ))}
                            </div>
                            <div className="grid grid-cols-4 gap-3 mb-3">
                              <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">Issuing Location</label>
                                <div className="relative">
                                  <select value={editDraft.issuing_location ?? ''}
                                    onChange={(e) => setEditDraft((d) => d ? { ...d, issuing_location: e.target.value || null } : d)}
                                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 appearance-none pr-6">
                                    <option value="">— Select —</option>
                                    {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
                                  </select>
                                  <ChevronDown size={12} className="absolute right-2 top-2 text-gray-400 pointer-events-none" />
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">Shift Type</label>
                                <div className="flex gap-2">
                                  {(['lunch', 'dinner'] as const).map((s) => (
                                    <button key={s}
                                      onClick={() => setEditDraft((d) => d ? { ...d, shift_type: d.shift_type === s ? null : s } : d)}
                                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                        editDraft.shift_type === s
                                          ? s === 'lunch' ? 'bg-amber-500 text-white border-amber-500' : 'bg-blue-600 text-white border-blue-600'
                                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                                      }`}>
                                      {s === 'lunch' ? '☀️ Lunch' : '🌙 Dinner'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={saveEdit} disabled={savingEdit}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                                {savingEdit ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                {savingEdit ? 'Saving…' : 'Save Changes'}
                              </button>
                              <button onClick={() => { setEditingId(null); setEditDraft(null); }}
                                className="px-3 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg bg-white transition-colors">
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200">
                    <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-gray-500">{filtered.length} invoices</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-700 tabular-nums">{fmt(totals.net)}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900 tabular-nums">{fmt(totals.gross)}</td>
                    <td className="px-4 py-3 text-right font-bold text-amber-700 tabular-nums">{fmt(totals.tips)}</td>
                    <td className="px-4 py-3 text-right font-bold text-[#1B5E20] tabular-nums">{fmt(totals.total)}</td>
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
