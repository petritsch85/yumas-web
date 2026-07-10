'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Upload, FileCheck, AlertCircle, Loader2,
  CheckCircle2, Clock, Banknote, Trash2,
  ChevronDown, Eye, X, Save, Pencil, Download, BookOpen, Send,
  FilePlus, Plus, FileDown, Camera, FileUp,
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
  id:          string;
  fileName:    string;
  storagePath: string;
  status:      'uploading' | 'waiting' | 'extracting' | 'done' | 'error';
  data?:       Extracted;
  error?:      string;
  saved?:      boolean;
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
  status:           'pending' | 'paid' | 'cancelled';
  file_path:        string | null;
};

type Customer = {
  id:           string;
  company_name: string;
  extra_line:   string | null;
  contact_name: string | null;
  street:       string | null;
  postcode:     string | null;
  city:         string | null;
  po_number:    string | null;
  att:          string | null;
  updated_at:   string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const LOCATIONS = ['Westend', 'Eschborn', 'Taunus', 'Other'];

const isItemReady = (item: { status: string; saved?: boolean; data?: Extracted }) =>
  item.status === 'done' && !item.saved &&
  !!item.data?.issuing_location && !!item.data?.shift_type;

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  paid:      'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
};

const DEFAULT_INTRO_MONTHLY = 'Wir bedanken uns für Ihren Auftrag und stellen Ihnen für die Bestellungen wie folgt eine Rechnung:';
const makeStornoIntro = (originalRef: string, originalDate: string) =>
  `hiermit stornieren wir die Rechnung mit der Nummer ${originalRef} vom ${originalDate} mit folgenden Positionen:`;
const makeIntroDinner = (eventDate: string, location?: string) => {
  const locPart = location ? ` im Yumas ${location}` : '';
  return eventDate
    ? `Wir bedanken uns für Ihren Auftrag und stellen Ihnen für Ihren Besuch am ${eventDate}${locPart} wie folgt eine Rechnung:`
    : `Wir bedanken uns für Ihren Auftrag und stellen Ihnen für Ihren Besuch${locPart} wie folgt eine Rechnung:`;
};

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
  const queryClient      = useQueryClient();
  const fileInputRef       = useRef<HTMLInputElement>(null);
  const receiptInputRef    = useRef<HTMLInputElement>(null);
  const orderbirdInputRef  = useRef<HTMLInputElement>(null);
  const { t } = useT();

  // ── Permission check ─────────────────────────────────────────────────────
  const { data: myProfile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('profiles').select('role, permissions').eq('id', user.id).single();
      return data as { role: string; permissions: Record<string, boolean> } | null;
    },
  });
  const isAdmin       = myProfile?.role === 'admin';
  const canViewAll    = isAdmin || !!myProfile?.permissions?.bills;
  const canCreate     = isAdmin || !!myProfile?.permissions?.bills || !!myProfile?.permissions?.bills_create;

  const [focusedField, setFocusedField] = useState<string | null>(null);
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

  const [billType,          setBillType]          = useState<'monthly' | 'dinner' | 'storno'>('dinner');
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
  const [inputMode,         setInputMode]         = useState<'brutto' | 'netto' | 'pauschale'>('brutto');
  const [pauschaleTotal,    setPauschaleTotal]    = useState('');
  const [pauschaleIsNetto,  setPauschaleIsNetto]  = useState(false);
  const [essenBrutto,       setEssenBrutto]       = useState('');
  const [getraenkeBrutto,   setGetraenkeBrutto]   = useState('');
  const [essenNettoInput,   setEssenNettoInput]   = useState('');
  const [getraenkeNettoInput, setGetraenkeNettoInput] = useState('');
  const [mwstEssen,         setMwstEssen]         = useState('7');
  const [mwstGetraenke,     setMwstGetraenke]     = useState('19');
  const [trinkgeld,         setTrinkgeld]         = useState('');
  const [lineItems,             setLineItems]             = useState<LineItem[]>([{ qty: 1, item: '', unitPrice: 0 }]);
  const [generating,            setGenerating]            = useState(false);
  const [invoiceNumberLocked,   setInvoiceNumberLocked]   = useState(true);
  // Send modal
  const [sendModal,        setSendModal]        = useState(false);
  const [pendingBlob,      setPendingBlob]      = useState<Blob | null>(null);
  const [pendingPdfUrl,    setPendingPdfUrl]    = useState<string | null>(null);
  const [sendEmail,        setSendEmail]        = useState('');
  const [sending,          setSending]          = useState(false);
  const [approving,        setApproving]        = useState(false);
  const [sendError,        setSendError]        = useState<string | null>(null);
  const [extractingReceipt,     setExtractingReceipt]     = useState(false);
  const [extractingOrderbird,   setExtractingOrderbird]   = useState(false);
  const [receiptSuccess,        setReceiptSuccess]        = useState(false);
  const [receiptDataUrl,        setReceiptDataUrl]        = useState<string | null>(null);
  const [includeReceipt,        setIncludeReceipt]        = useState(false);
  const [receiptLineItems,      setReceiptLineItems]      = useState<{ name: string; qty: number; total: number; taxCode: 'A' | 'B' }[]>([]);
  const [valueDetailsOpen,      setValueDetailsOpen]      = useState(false);

  // Storno (cancellation) invoice state
  const [stornoModal,      setStornoModal]      = useState(false);
  const [stornoSearch,     setStornoSearch]     = useState('');
  const [stornoSourceBill, setStornoSourceBill] = useState<OutgoingBill | null>(null);

  const moveReceiptItem = useCallback((idx: number, to: 'A' | 'B') => {
    setReceiptLineItems((prev) => {
      const next = prev.map((item, i) => i === idx ? { ...item, taxCode: to } : item);
      const essen     = next.reduce((s, i) => i.taxCode === 'B' ? s + i.total : s, 0);
      const getraenke = next.reduce((s, i) => i.taxCode === 'A' ? s + i.total : s, 0);
      setEssenBrutto(String(essen));
      setGetraenkeBrutto(String(getraenke));
      return next;
    });
  }, []);

  // Customer CRM search
  const [customerQuery,       setCustomerQuery]       = useState('');
  const [customerSuggestions, setCustomerSuggestions] = useState<Customer[]>([]);
  const [showSuggestions,     setShowSuggestions]     = useState(false);
  const crmRef = useRef<HTMLDivElement>(null);

  // Anzahlung (deposit) picker
  const [anzahlungBillId,       setAnzahlungBillId]       = useState<string | null>(null);
  const [anzahlungSearch,       setAnzahlungSearch]       = useState('');
  const [showAnzahlungPicker,   setShowAnzahlungPicker]   = useState(false);
  const anzahlungPickerRef = useRef<HTMLDivElement>(null);

  // Ermässigung (discount)
  const [ermaessigung,          setErmaessigung]          = useState('');
  const [focusedErmaessigung,   setFocusedErmaessigung]   = useState(false);

  // Client Registry modal
  const [registryOpen,      setRegistryOpen]      = useState(false);
  const [registryCustomers, setRegistryCustomers] = useState<Customer[]>([]);
  const [registrySearch,    setRegistrySearch]    = useState('');
  const [registryLoading,   setRegistryLoading]   = useState(false);

  const openRegistry = async () => {
    setRegistryOpen(true);
    setRegistryLoading(true);
    try {
      const res = await fetch('/api/customers/all');
      if (res.ok) setRegistryCustomers(await res.json());
    } finally {
      setRegistryLoading(false);
    }
  };

  const deleteCustomer = async (id: string) => {
    await fetch(`/api/customers/${id}`, { method: 'DELETE' });
    setRegistryCustomers(prev => prev.filter(c => c.id !== id));
  };

  const filteredRegistry = registrySearch.trim().length > 0
    ? registryCustomers.filter(c => c.company_name.toLowerCase().includes(registrySearch.toLowerCase()))
    : registryCustomers;

  // Force create-only users to the Create Bill tab
  useEffect(() => {
    if (myProfile && !canViewAll && tab !== 'create') setTab('create');
  }, [myProfile, canViewAll, tab]);

  // Auto-update intro text when event date, location or bill type changes
  useEffect(() => {
    if (billType === 'dinner') {
      setIntroText(makeIntroDinner(billEventDate, billIssuingLoc || undefined));
    } else if (billType === 'monthly') {
      setIntroText(DEFAULT_INTRO_MONTHLY);
    }
    // storno: introText is set by applyStornoBill, not overridden here
  }, [billType, billEventDate, billIssuingLoc]);

  // Debounced CRM search
  useEffect(() => {
    if (customerQuery.length < 2) { setCustomerSuggestions([]); return; }
    const timer = setTimeout(async () => {
      const res  = await fetch(`/api/customers?q=${encodeURIComponent(customerQuery)}`);
      const data = await res.json();
      setCustomerSuggestions(Array.isArray(data) ? data : []);
      setShowSuggestions(true);
    }, 250);
    return () => clearTimeout(timer);
  }, [customerQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (crmRef.current && !crmRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close Anzahlung picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (anzahlungPickerRef.current && !anzahlungPickerRef.current.contains(e.target as Node)) {
        setShowAnzahlungPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const applyCustomer = (c: Customer) => {
    setCompany(c.company_name);
    setExtra(c.extra_line ?? '');
    setContactName(c.contact_name ?? '');
    setStreet(c.street ?? '');
    setPostcode(c.postcode ?? '');
    setCity(c.city ?? '');
    setPoNumber(c.po_number ?? '');
    setAtt(c.att ?? '');
    setCustomerQuery('');
    setShowSuggestions(false);
  };

  const saveCustomerSilently = async () => {
    if (!company.trim()) return;
    try {
      await fetch('/api/customers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: company,
          extra_line:   extra       || null,
          contact_name: contactName || null,
          street:       street      || null,
          postcode:     postcode    || null,
          city:         city        || null,
          po_number:    poNumber    || null,
          att:          att         || null,
        }),
      });
    } catch { /* silent */ }
  };

  const handleBillTypeChange = (t: 'monthly' | 'dinner' | 'storno') => {
    if (t !== 'storno') setStornoSourceBill(null);
    setBillType(t);
  };

  const applyStornoBill = (source: OutgoingBill) => {
    setCompany(source.customer_name);
    const addrParts = (source.customer_address ?? '').split(', ');
    if (addrParts.length >= 3) {
      setStreet(addrParts[0]);
      setPostcode(addrParts[1]);
      setCity(addrParts.slice(2).join(', '));
    } else if (addrParts.length === 2) {
      setStreet(addrParts[0]);
      const sp = addrParts[1].split(' ');
      setPostcode(sp[0] ?? '');
      setCity(sp.slice(1).join(' '));
    } else {
      setStreet(source.customer_address ?? '');
    }
    setBillIssuingLoc(source.issuing_location ?? '');
    setBillEventDate(source.event_date ? source.event_date.split('-').reverse().join('.') : '');
    setInputMode('brutto');
    setEssenBrutto(String(source.net_food + source.vat_7));
    setGetraenkeBrutto(String(source.net_drinks + source.vat_19));
    setTrinkgeld(source.tips > 0 ? String(source.tips) : '');
    const origDate = source.invoice_date ? source.invoice_date.split('-').reverse().join('.') : '';
    setIntroText(makeStornoIntro(source.invoice_number ?? '', origDate));
    setStornoSourceBill(source);
    setStornoModal(false);
    setBillType('storno');
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

  // Live totals (dinner: driven by brutto or netto inputs + mwst rates)
  const mwstEssenRate     = (parseFloat(mwstEssen)    || 7)  / 100;
  const mwstGetraenkeRate = (parseFloat(mwstGetraenke) || 19) / 100;

  // Pauschale: single total, 70% food @ 7% VAT / 30% drinks @ 19% VAT
  const pauschaleN = parseFloat(pauschaleTotal) || 0;
  const essenBruttoN =
    inputMode === 'brutto'   ? (parseFloat(essenBrutto) || 0) :
    inputMode === 'netto'    ? (parseFloat(essenNettoInput) || 0) * (1 + mwstEssenRate) :
    pauschaleIsNetto         ? pauschaleN * 0.70 * (1 + mwstEssenRate) :
                               pauschaleN * 0.70;
  const getraenkeBruttoN =
    inputMode === 'brutto'   ? (parseFloat(getraenkeBrutto) || 0) :
    inputMode === 'netto'    ? (parseFloat(getraenkeNettoInput) || 0) * (1 + mwstGetraenkeRate) :
    pauschaleIsNetto         ? pauschaleN * 0.30 * (1 + mwstGetraenkeRate) :
                               pauschaleN * 0.30;
  const essenN =
    inputMode === 'brutto'   ? essenBruttoN / (1 + mwstEssenRate) :
    inputMode === 'netto'    ? (parseFloat(essenNettoInput) || 0) :
    pauschaleIsNetto         ? pauschaleN * 0.70 :
                               essenBruttoN / (1 + mwstEssenRate);
  const getraenkeN =
    inputMode === 'brutto'   ? getraenkeBruttoN / (1 + mwstGetraenkeRate) :
    inputMode === 'netto'    ? (parseFloat(getraenkeNettoInput) || 0) :
    pauschaleIsNetto         ? pauschaleN * 0.30 :
                               getraenkeBruttoN / (1 + mwstGetraenkeRate);
  const bruttoGesamt    = essenBruttoN + getraenkeBruttoN;
  const mwstVatEssen    = essenBruttoN    - essenN;
  const mwstVatGetraenke = getraenkeBruttoN - getraenkeN;
  const mwstGesamtPct   = bruttoGesamt > 0 ? ((mwstVatEssen + mwstVatGetraenke) / bruttoGesamt) * 100 : 0;
  const trinkgeldN = parseFloat(trinkgeld) || 0;
  const linesTotal = lineItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const netto      = billType === 'monthly' ? linesTotal : essenN + getraenkeN;
  const mwst7      = billType === 'monthly' ? netto * 0.07 : mwstVatEssen;
  const mwst19     = billType !== 'monthly' ? mwstVatGetraenke : 0;
  const brutto     = billType === 'monthly' ? netto + mwst7 : bruttoGesamt;
  const billTotal  = brutto + (billType !== 'monthly' ? trinkgeldN : 0);
  const ermaessigungN = parseFloat(ermaessigung) || 0;

  const fmtEur = (n: number) =>
    n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

  const compressImage = (file: File, maxPx = 1600, quality = 0.82): Promise<{ base64: string; dataUrl: string }> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error('Failed to decode image'));
        img.onload = () => {
          const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width  = Math.round(img.width  * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve({ base64: dataUrl.split(',')[1], dataUrl });
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });

  const handleReceiptImage = async (file: File) => {
    setExtractingReceipt(true);
    setReceiptSuccess(false);
    try {
      const { base64, dataUrl: fullDataUrl } = await compressImage(file);
      setReceiptDataUrl(fullDataUrl);

      const res  = await fetch('/api/extract-receipt-image', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageBase64: base64, mediaType: 'image/jpeg' }),
      });
      const text = await res.text();
      let json: { data?: unknown; error?: string };
      try { json = JSON.parse(text); } catch { throw new Error(text.slice(0, 120)); }
      if (!res.ok) throw new Error(json.error ?? 'Extraction failed');

      const d = json.data as unknown as {
        essenBrutto:      number;
        getraenkeBrutto:  number;
        trinkgeld:        number;
        eventDate:        string | null;
        issuingLocation:  string | null;
        lineItems?:       { name: string; qty: number; total: number; taxCode: 'A' | 'B' }[];
      };

      if (d.lineItems?.length) setReceiptLineItems(d.lineItems);

      // Derive food/drink totals from line items (more reliable than AI aggregates)
      const computedEssen     = d.lineItems?.reduce((s, i) => i.taxCode === 'B' ? s + i.total : s, 0) ?? 0;
      const computedGetraenke = d.lineItems?.reduce((s, i) => i.taxCode === 'A' ? s + i.total : s, 0) ?? 0;
      const essenVal     = computedEssen     > 0 ? computedEssen     : d.essenBrutto;
      const getraenkeVal = computedGetraenke > 0 ? computedGetraenke : d.getraenkeBrutto;

      // Populate form fields
      setInputMode('brutto');
      if (essenVal     > 0) setEssenBrutto(String(essenVal));
      if (getraenkeVal > 0) setGetraenkeBrutto(String(getraenkeVal));
      if (d.trinkgeld       > 0) setTrinkgeld(String(d.trinkgeld));
      if (d.issuingLocation)     setBillIssuingLoc(d.issuingLocation);
      if (d.eventDate) {
        // Convert YYYY-MM-DD → DD.MM.YYYY for the form field
        const [y, m, day] = d.eventDate.split('-');
        setBillEventDate(`${day}.${m}.${y}`);
      }
      setReceiptSuccess(true);
      setTimeout(() => setReceiptSuccess(false), 4000);
    } catch (err: any) {
      const msg = typeof err === 'string' ? err
        : err?.message ? String(err.message)
        : err?.error   ? String(err.error)
        : 'Unknown error';
      alert(`Could not read receipt: ${msg}`);
    } finally {
      setExtractingReceipt(false);
    }
  };

  const handleOrderbirdPdf = async (file: File) => {
    setExtractingOrderbird(true);
    setReceiptSuccess(false);
    try {
      const pdfBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });

      const res  = await fetch('/api/extract-orderbird-pdf', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pdfBase64 }),
      });
      const text = await res.text();
      let json: { data?: unknown; error?: string };
      try { json = JSON.parse(text); } catch { throw new Error(text.slice(0, 120)); }
      if (!res.ok) throw new Error(json.error ?? 'Extraction failed');

      const d = json.data as unknown as {
        essenBrutto:       number;
        getraenkeBrutto:   number;
        trinkgeld:         number;
        eventDate:         string | null;
        issuingLocation:   string | null;
        recipientCompany:  string | null;
        recipientExtra:    string | null;
        recipientStreet:   string | null;
        recipientPostcode: string | null;
        recipientCity:     string | null;
        lineItems?:        { name: string; qty: number; total: number; taxCode: 'A' | 'B' }[];
      };

      if (d.lineItems?.length) setReceiptLineItems(d.lineItems);

      const computedEssen     = d.lineItems?.reduce((s, i) => i.taxCode === 'B' ? s + i.total : s, 0) ?? 0;
      const computedGetraenke = d.lineItems?.reduce((s, i) => i.taxCode === 'A' ? s + i.total : s, 0) ?? 0;
      const essenVal     = computedEssen     > 0 ? computedEssen     : d.essenBrutto;
      const getraenkeVal = computedGetraenke > 0 ? computedGetraenke : d.getraenkeBrutto;

      setInputMode('brutto');
      if (essenVal     > 0) setEssenBrutto(String(essenVal));
      if (getraenkeVal > 0) setGetraenkeBrutto(String(getraenkeVal));
      if (d.trinkgeld       > 0) setTrinkgeld(String(d.trinkgeld));
      if (d.issuingLocation)     setBillIssuingLoc(d.issuingLocation);
      if (d.eventDate) {
        const [y, m, day] = d.eventDate.split('-');
        setBillEventDate(`${day}.${m}.${y}`);
      }
      if (d.recipientCompany)  setCompany(d.recipientCompany);
      if (d.recipientExtra)    setExtra(d.recipientExtra);
      if (d.recipientStreet)   setStreet(d.recipientStreet);
      if (d.recipientPostcode) setPostcode(d.recipientPostcode);
      if (d.recipientCity)     setCity(d.recipientCity);
      setReceiptSuccess(true);
      setTimeout(() => setReceiptSuccess(false), 4000);
    } catch (err: any) {
      const msg = typeof err === 'string' ? err
        : err?.message ? String(err.message)
        : err?.error   ? String(err.error)
        : 'Unknown error';
      alert(`Could not read Orderbird PDF: ${msg}`);
    } finally {
      setExtractingOrderbird(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const [{ pdf }, { BillDocument: BillDoc }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/bills/BillDocument'),
      ]);
      const data = buildBillData();
      const blob = await pdf(<BillDoc data={data} />).toBlob();
      // Revoke any previous URL
      if (pendingPdfUrl) URL.revokeObjectURL(pendingPdfUrl);
      const url = URL.createObjectURL(blob);
      setPendingBlob(blob);
      setPendingPdfUrl(url);
      setSendEmail('');
      setSendError(null);
      setSendModal(true);
    } catch (err: any) {
      console.error('PDF generation failed:', err);
      alert(`Could not generate PDF: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setGenerating(false);
    }
  };

  // Helper: DD.MM.YYYY → YYYY-MM-DD (or null)
  const toIsoDate = (ddmmyyyy: string): string | null => {
    const p = ddmmyyyy.trim().split('.');
    return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : null;
  };

  // Shared: upload PDF to storage + save to DB
  const uploadAndSave = async () => {
    if (!pendingBlob) throw new Error('No PDF to save');
    const { data: { user } } = await supabase.auth.getUser();
    const safeInv = invoiceNumber.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `outgoing-bills/${Date.now()}_${safeInv}.pdf`;
    const { error: upErr } = await supabase.storage.from('bills').upload(storagePath, pendingBlob, { contentType: 'application/pdf' });
    if (upErr) throw new Error(`PDF storage failed: ${upErr.message}`);
    const { error: dbErr } = await supabase.from('outgoing_bills').insert({
      invoice_number:   invoiceNumber || null,
      invoice_date:     toIsoDate(billDate),
      event_date:       billEventDate ? toIsoDate(billEventDate) : null,
      customer_name:    company,
      customer_address: [street, postcode, city].filter(Boolean).join(', ') || null,
      issuing_location: billIssuingLoc || null,
      shift_type:       (billType !== 'monthly' ? (stornoSourceBill?.shift_type ?? 'dinner') : null) as 'dinner' | 'lunch' | null,
      net_food:         billType !== 'monthly' ? essenN         : 0,
      net_drinks:       billType !== 'monthly' ? getraenkeN     : 0,
      net_total:        netto,
      vat_7:            mwst7,
      vat_19:           mwst19,
      gross_total:      brutto,
      tips:             trinkgeldN,
      total_payable:    finalTotal,
      status:           'pending',
      file_path:        storagePath,
      uploaded_by:      user?.id ?? null,
    });
    if (dbErr) throw dbErr;
    return storagePath;
  };

  const closeModal = () => {
    setSendModal(false);
    setPendingBlob(null);
    if (pendingPdfUrl) { URL.revokeObjectURL(pendingPdfUrl); setPendingPdfUrl(null); }
    queryClient.invalidateQueries({ queryKey: ['outgoing-bills'] });
    saveCustomerSilently();
  };

  // Approve only — save to DB, no email
  const handleApprove = async () => {
    if (!pendingBlob) return;
    setApproving(true);
    setSendError(null);
    try {
      await uploadAndSave();
      if (billType === 'storno' && stornoSourceBill) {
        await supabase.from('outgoing_bills').update({ status: 'cancelled' }).eq('id', stornoSourceBill.id);
      }
      closeModal();
    } catch (err: any) {
      setSendError(err.message ?? 'Unexpected error');
    } finally {
      setApproving(false);
    }
  };

  // Send — email + save to DB
  const handleSend = async () => {
    if (!pendingBlob || !sendEmail.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      // Convert blob to base64 (chunked to avoid call stack overflow on large PDFs)
      const arrayBuffer = await pendingBlob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8.length; i += 8192) {
        binary += String.fromCharCode(...uint8.subarray(i, i + 8192));
      }
      const pdfBase64 = btoa(binary);

      // Send email via Resend
      const emailRes = await fetch('/api/send-bill-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: sendEmail.trim(), invoiceNumber, companyName: company, pdfBase64 }),
      });
      const emailJson = await emailRes.json();
      if (!emailRes.ok) throw new Error(emailJson.error ?? 'Email sending failed');

      // Upload + save to DB
      await uploadAndSave();
      if (billType === 'storno' && stornoSourceBill) {
        await supabase.from('outgoing_bills').update({ status: 'cancelled' }).eq('id', stornoSourceBill.id);
      }
      closeModal();
    } catch (err: any) {
      setSendError(err.message ?? 'Unexpected error');
    } finally {
      setSending(false);
    }
  };

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

  // Anzahlung / Ermässigung derived values (needs bills)
  const anzahlungBill    = bills.find((b) => b.id === anzahlungBillId) ?? null;
  const anzahlungBruttoN = anzahlungBill?.total_payable ?? 0;
  const anzahlungNettoN  = anzahlungBill?.net_total     ?? 0;
  const hasDeductions    = anzahlungBruttoN > 0 || ermaessigungN > 0;
  const finalTotal       = billTotal - anzahlungBruttoN - ermaessigungN;

  const anzahlungFilteredBills = bills.filter((b) =>
    b.id !== anzahlungBillId &&
    (anzahlungSearch.trim().length === 0 ||
      (b.invoice_number ?? '').toLowerCase().includes(anzahlungSearch.toLowerCase()) ||
      b.customer_name.toLowerCase().includes(anzahlungSearch.toLowerCase()))
  );

  const buildBillData = useCallback((): BillData => {
    const isDinnerLike = billType === 'dinner' || billType === 'storno';
    const stornoOrigDate = stornoSourceBill?.invoice_date
      ? stornoSourceBill.invoice_date.split('-').reverse().join('.')
      : '';
    return {
      invoiceNumber,
      date:             billDate,
      eventDate:        billEventDate || undefined,
      issuingLocation:  billIssuingLoc || undefined,
      type:             billType === 'monthly' ? 'monthly' : 'dinner',
      recipient: { company, extra, contact: contactName, street, postcode, city, poNumber, att },
      introText,
      lineItems:        billType === 'monthly' ? lineItems        : undefined,
      essenBrutto:      isDinnerLike  ? essenBruttoN     : undefined,
      getraenkeBrutto:  isDinnerLike  ? getraenkeBruttoN : undefined,
      mwstEssenPct:     isDinnerLike  ? (parseFloat(mwstEssen)    || 7)  : undefined,
      mwstGetraenkePct: isDinnerLike  ? (parseFloat(mwstGetraenke) || 19) : undefined,
      essenNetto:       isDinnerLike  ? essenN           : undefined,
      getraenkeNetto:   isDinnerLike  ? getraenkeN       : undefined,
      trinkgeld:        isDinnerLike  ? trinkgeldN       : undefined,
      anzahlungBrutto:  anzahlungBruttoN > 0          ? anzahlungBruttoN              : undefined,
      anzahlungNetto:   anzahlungNettoN  > 0          ? anzahlungNettoN               : undefined,
      anzahlungVat7:    (anzahlungBill?.vat_7  ?? 0) > 0 ? anzahlungBill!.vat_7      : undefined,
      anzahlungVat19:   (anzahlungBill?.vat_19 ?? 0) > 0 ? anzahlungBill!.vat_19     : undefined,
      anzahlungRef:     anzahlungBill?.invoice_number ?? undefined,
      ermaessigung:     ermaessigungN > 0 ? ermaessigungN : undefined,
      receiptImageDataUrl: includeReceipt && receiptDataUrl ? receiptDataUrl : undefined,
      storno: billType === 'storno' && stornoSourceBill ? {
        originalRef:  stornoSourceBill.invoice_number ?? '',
        originalDate: stornoOrigDate,
      } : undefined,
    };
  }, [invoiceNumber, billDate, billEventDate, billIssuingLoc, billType, company, extra,
       contactName, street, postcode, city, poNumber, att, introText, lineItems,
       essenBruttoN, getraenkeBruttoN, essenN, getraenkeN, mwstEssen, mwstGetraenke, trinkgeldN,
       anzahlungBruttoN, anzahlungNettoN, anzahlungBill, ermaessigungN,
       includeReceipt, receiptDataUrl, stornoSourceBill]);

  // Auto-populate next invoice number when bills load
  useEffect(() => {
    if (bills.length === 0 && !isLoading) {
      // No bills yet — start at 1-YY
      const yy = String(new Date().getFullYear()).slice(-2);
      setInvoiceNumber(`1-${yy}`);
      return;
    }
    const yy = String(new Date().getFullYear()).slice(-2);
    const pattern = new RegExp(`^(\\d+)-${yy}$`);
    let max = 0;
    for (const b of bills) {
      if (!b.invoice_number) continue;
      const m = b.invoice_number.match(pattern);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    setInvoiceNumber(`${max + 1}-${yy}`);
  }, [bills, isLoading]);

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

  // Sort by invoice number descending: parse {seq}-{yy} → sort by year then seq, both desc
  const sortedBills = [...filtered].sort((a, b) => {
    const parse = (inv: string | null) => {
      const m = inv?.match(/^(\d+)-(\d+)$/);
      return m ? parseInt(m[2], 10) * 100000 + parseInt(m[1], 10) : -1;
    };
    return parse(b.invoice_number) - parse(a.invoice_number);
  });

  const totals = {
    gross:   filtered.reduce((s, b) => s + b.gross_total,   0),
    net:     filtered.reduce((s, b) => s + b.net_total,     0),
    tips:    filtered.reduce((s, b) => s + b.tips,          0),
    total:   filtered.reduce((s, b) => s + b.total_payable, 0),
    pending: bills.reduce((s, b) => b.status === 'pending' ? s + b.total_payable : s, 0),
  };

  // ── Extract via Claude ────────────────────────────────────────────────────

  const extractItem = useCallback(async (item: QueueItem) => {
    setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'extracting' } : i));
    try {
      const res = await fetch('/api/extract-outgoing-bill', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ storagePath: item.storagePath, fileName: item.fileName }),
      });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch {
        throw new Error(`Unexpected server response (HTTP ${res.status}) — try again.`);
      }
      if (!res.ok) throw new Error(json.error ?? 'Extraction failed');
      setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'done', data: json.data } : i));
    } catch (err: any) {
      setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: 'error', error: err.message } : i));
    }
  }, []);

  const processFiles = useCallback(async (files: File[]) => {
    const pdfs = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) return;
    // Create placeholder items immediately so the user sees them
    const placeholders: QueueItem[] = pdfs.map((file) => ({
      id: uid(), fileName: file.name, storagePath: '', status: 'uploading',
    }));
    setQueue((q) => [...q, ...placeholders]);
    setTab('upload');
    // Upload each PDF directly to Supabase Storage (no Vercel size limit)
    for (let i = 0; i < pdfs.length; i++) {
      const file = pdfs[i];
      const placeholder = placeholders[i];
      const safeFileName = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `outgoing-bills/${Date.now()}_${safeFileName}`;
      const { error: upErr } = await supabase.storage.from('bills').upload(storagePath, file);
      if (upErr) {
        setQueue((q) => q.map((qi) => qi.id === placeholder.id
          ? { ...qi, status: 'error', error: `Upload failed: ${upErr.message}` } : qi));
        continue;
      }
      const readyItem: QueueItem = { ...placeholder, storagePath, status: 'waiting' };
      setQueue((q) => q.map((qi) => qi.id === placeholder.id ? readyItem : qi));
      await extractItem(readyItem);
    }
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
        // PDF already uploaded to storage during extraction step
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
          file_path:        item.storagePath,
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

  const handleExport = () => {
    import('xlsx').then((XLSX) => {
      const rows = sortedBills.map((b) => ({
        Customer:        b.customer_name,
        'Invoice #':     b.invoice_number ?? '',
        'Issue Date':    b.invoice_date ? new Date(b.invoice_date + 'T00:00:00').toLocaleDateString('en-GB') : '',
        'Event Date':    b.event_date    ? new Date(b.event_date    + 'T00:00:00').toLocaleDateString('en-GB') : '',
        Location:        b.issuing_location ?? '',
        Shift:           b.shift_type ? b.shift_type.charAt(0).toUpperCase() + b.shift_type.slice(1) : '',
        'Net (€)':       b.net_total,
        'Gross (€)':     b.gross_total,
        'Tips (€)':      b.tips || 0,
        'Total Payable (€)': b.total_payable,
        Status:          b.status.charAt(0).toUpperCase() + b.status.slice(1),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const colWidths = [40, 12, 14, 14, 12, 10, 14, 14, 12, 18, 12];
      ws['!cols'] = colWidths.map(w => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Outgoing Bills');
      const label = filterMonth !== 'all' ? `_${filterMonth}` : '';
      XLSX.writeFile(wb, `Outgoing_Bills${label}.xlsx`);
    });
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('bills.outgoingTitle')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('bills.outgoingSubtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {canViewAll && sortedBills.length > 0 && (
            <button
              onClick={handleExport}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-white text-gray-600 border border-gray-300 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors"
            >
              <FileDown size={15} />
              Export
            </button>
          )}
          <button
            onClick={() => setTab('create')}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-white text-[#1B5E20] border border-[#1B5E20] text-sm font-semibold rounded-xl hover:bg-green-50 transition-colors"
          >
            <FilePlus size={15} />
            Create Bill
          </button>
          {canViewAll && (
            <button
              onClick={() => { setTab('upload'); setTimeout(() => fileInputRef.current?.click(), 100); }}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-semibold rounded-xl hover:bg-[#2E7D32] transition-colors"
            >
              <Upload size={15} />
              Upload Invoice
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {canViewAll && (
            <button onClick={() => setTab('bills')}
              className={`flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 transition-colors ${
                tab === 'bills' ? 'border-[#1B5E20] text-[#1B5E20]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Banknote size={14} />
              All Invoices
              {bills.length > 0 && (
                <span className="bg-gray-100 text-gray-600 text-xs font-bold px-1.5 py-0.5 rounded-full">{bills.length}</span>
              )}
            </button>
          )}
          {(tab === 'upload' || tab === 'create') && (
            <button onClick={() => setTab(tab)}
              className="flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 border-[#1B5E20] text-[#1B5E20]"
            >
              {tab === 'upload' ? <><Upload size={14} /> Upload{activeCount > 0 && <span className="bg-[#1B5E20] text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{activeCount}</span>}</> : <><FilePlus size={14} /> Create Bill</>}
            </button>
          )}
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
                      {item.status === 'uploading'  && <Loader2      size={18} className="text-gray-400 animate-spin" />}
                      {item.status === 'waiting'    && <Clock        size={18} className="text-gray-300" />}
                      {item.status === 'extracting' && <Loader2      size={18} className="text-blue-500 animate-spin" />}
                      {item.status === 'done' && !item.saved && !missingFields && <FileCheck    size={18} className="text-green-500" />}
                      {item.status === 'done' && !item.saved &&  missingFields && <AlertCircle  size={18} className="text-red-400" />}
                      {item.status === 'done' &&  item.saved && <CheckCircle2 size={18} className="text-green-400" />}
                      {item.status === 'error'      && <AlertCircle  size={18} className="text-red-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 truncate">{item.fileName}</p>
                      {item.status === 'uploading'  && <p className="text-sm text-gray-400">Uploading…</p>}
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

          {/* Receipt import banner */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-800">Import from receipt photo</p>
              <p className="text-xs text-gray-400 mt-0.5">Take a photo of the POS Kassenbon — amounts, VAT split and date are filled in automatically</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {receiptDataUrl && (
                <button
                  type="button"
                  onClick={() => setIncludeReceipt(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                    includeReceipt
                      ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <FileCheck size={13} />
                  {includeReceipt ? 'Receipt on bill ✓' : 'Include receipt on bill'}
                </button>
              )}
              {receiptSuccess && (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
                  <CheckCircle2 size={14} /> Filled in!
                </span>
              )}
              <button
                type="button"
                onClick={() => receiptInputRef.current?.click()}
                disabled={extractingReceipt || extractingOrderbird}
                className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-semibold rounded-lg hover:bg-[#2E7D32] disabled:opacity-60 transition-colors"
              >
                {extractingReceipt
                  ? <><Loader2 size={14} className="animate-spin" /> Reading…</>
                  : <><Camera size={14} /> Import Receipt</>
                }
              </button>
              <input
                ref={receiptInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleReceiptImage(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => orderbirdInputRef.current?.click()}
                disabled={extractingReceipt || extractingOrderbird}
                className="flex items-center gap-2 px-4 py-2 bg-white text-[#1B5E20] text-sm font-semibold rounded-lg border-2 border-[#1B5E20] hover:bg-green-50 disabled:opacity-60 transition-colors"
              >
                {extractingOrderbird
                  ? <><Loader2 size={14} className="animate-spin" /> Reading…</>
                  : <><FileUp size={14} /> Import Orderbird</>
                }
              </button>
              <input
                ref={orderbirdInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleOrderbirdPdf(file);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

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
              <button
                onClick={() => setStornoModal(true)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  billType === 'storno'
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-red-400'
                }`}
              >
                Stornorechnung
              </button>
            </div>
            {billType === 'storno' && stornoSourceBill && (
              <div className="mt-3 flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs font-semibold text-red-700">Cancelling invoice #{stornoSourceBill.invoice_number}</p>
                  <p className="text-xs text-red-500">{stornoSourceBill.customer_name} · {fmtDate(stornoSourceBill.invoice_date)}</p>
                </div>
                <button onClick={() => setStornoModal(true)} className="text-xs text-red-600 hover:underline ml-3 flex-shrink-0">
                  Change
                </button>
              </div>
            )}
          </div>

          {/* Invoice details */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-sm font-bold text-gray-800 mb-4 pb-3 border-b border-gray-100">Invoice Details</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Invoice Number</label>
                <div className="flex items-center gap-2">
                  <input
                    className={invoiceNumberLocked
                      ? `${inputCls} !bg-gray-200 !border-gray-300 !shadow-none text-gray-600 cursor-not-allowed select-none flex-1`
                      : `${inputCls} flex-1`}
                    readOnly={invoiceNumberLocked}
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setInvoiceNumberLocked((l) => !l)}
                    className={`flex-shrink-0 px-3 py-2.5 text-xs font-semibold rounded-lg border transition-colors ${
                      invoiceNumberLocked
                        ? 'border-gray-300 text-gray-500 bg-white hover:bg-gray-50 hover:text-gray-700'
                        : 'border-[#1B5E20] text-[#1B5E20] bg-green-50 hover:bg-green-100'
                    }`}
                  >
                    {invoiceNumberLocked ? 'Edit' : 'Lock'}
                  </button>
                </div>
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

              {/* CRM customer search */}
              <div ref={crmRef} className="relative">
                <div className="flex items-center justify-between mb-1">
                  <label className={labelCls} style={{marginBottom:0}}>Search Saved Customers</label>
                  <button type="button" onClick={openRegistry}
                    className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
                    <BookOpen size={13} />
                    Client Registry
                  </button>
                </div>
                <div className="relative">
                  <input
                    className={`${inputCls} pl-8`}
                    placeholder="Type company name to search…"
                    value={customerQuery}
                    onChange={(e) => { setCustomerQuery(e.target.value); setShowSuggestions(true); }}
                    onFocus={() => { if (customerSuggestions.length) setShowSuggestions(true); }}
                  />
                  <svg className="absolute left-2.5 top-3 text-gray-400 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                </div>
                {showSuggestions && customerSuggestions.length > 0 && (
                  <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                    {customerSuggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={() => applyCustomer(c)}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-0 transition-colors"
                      >
                        <p className="text-sm font-semibold text-gray-800">{c.company_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {[c.street, c.postcode, c.city].filter(Boolean).join(', ')}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
                {showSuggestions && customerQuery.length >= 2 && customerSuggestions.length === 0 && (
                  <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-xs text-gray-400">
                    No saved customers match — fill in details below to save on generate.
                  </div>
                )}
              </div>

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

          {/* Dinner / Storno: amounts */}
          {(billType === 'dinner' || billType === 'storno') && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              {/* Header + mode toggle */}
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <p className="text-sm font-bold text-gray-800">Amounts</p>
                  {receiptLineItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setValueDetailsOpen(true)}
                      className="text-xs font-semibold text-[#1B5E20] border border-[#1B5E20] px-2.5 py-1 rounded-lg hover:bg-green-50 transition-colors"
                    >
                      Value Details
                    </button>
                  )}
                </div>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setInputMode('brutto')}
                    className={`px-3 py-1.5 transition-colors ${inputMode === 'brutto' ? 'bg-[#1B5E20] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                  >
                    Brutto → Netto
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('netto')}
                    className={`px-3 py-1.5 transition-colors border-l border-gray-200 ${inputMode === 'netto' ? 'bg-[#1B5E20] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                  >
                    Netto → Brutto
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('pauschale')}
                    className={`px-3 py-1.5 transition-colors border-l border-gray-200 ${inputMode === 'pauschale' ? 'bg-[#1B5E20] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                  >
                    Pauschale
                  </button>
                </div>
              </div>

              {/* Pauschale: single total input with brutto/netto sub-toggle */}
              {inputMode === 'pauschale' && (
                <div className="mb-4 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className={labelCls}>Gesamtbetrag {pauschaleIsNetto ? 'Netto' : 'Brutto'} (€)</label>
                      <input
                        type={focusedField === 'pauschaleTotal' ? 'number' : 'text'}
                        step="0.01" min="0" className={inputCls} placeholder="0,00 €"
                        value={focusedField === 'pauschaleTotal' ? pauschaleTotal : (pauschaleN > 0 ? fmtEur(pauschaleN) : '')}
                        onFocus={() => setFocusedField('pauschaleTotal')}
                        onBlur={() => setFocusedField(null)}
                        onChange={(e) => setPauschaleTotal(e.target.value)}
                      />
                    </div>
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold mb-px">
                      <button type="button" onClick={() => setPauschaleIsNetto(false)}
                        className={`px-3 py-1.5 transition-colors ${!pauschaleIsNetto ? 'bg-[#1B5E20] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                        Brutto
                      </button>
                      <button type="button" onClick={() => setPauschaleIsNetto(true)}
                        className={`px-3 py-1.5 transition-colors border-l border-gray-200 ${pauschaleIsNetto ? 'bg-[#1B5E20] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                        Netto
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-emerald-700 mt-1.5">70% Essen (7% MwSt) · 30% Getränke (19% MwSt) — alle Felder werden automatisch berechnet</p>
                </div>
              )}

              {/* Row 1: Brutto */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <label className={labelCls}>Essen Brutto (€)</label>
                  {inputMode === 'brutto' ? (
                    <input
                      type={focusedField === 'essenBrutto' ? 'number' : 'text'}
                      step="0.01" min="0" className={inputCls} placeholder="0,00 €"
                      value={focusedField === 'essenBrutto' ? essenBrutto : (essenBruttoN > 0 ? fmtEur(essenBruttoN) : '')}
                      onFocus={() => setFocusedField('essenBrutto')}
                      onBlur={() => setFocusedField(null)}
                      onChange={(e) => setEssenBrutto(e.target.value)} />
                  ) : (
                    <div className={`${inputCls} !bg-gray-200 !border-gray-300 !shadow-none text-gray-500 cursor-not-allowed select-none`}>
                      {essenBruttoN > 0 ? fmtEur(essenBruttoN) : '0,00 €'}
                    </div>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Getränke Brutto (€)</label>
                  {inputMode === 'brutto' ? (
                    <input
                      type={focusedField === 'getraenkeBrutto' ? 'number' : 'text'}
                      step="0.01" min="0" className={inputCls} placeholder="0,00 €"
                      value={focusedField === 'getraenkeBrutto' ? getraenkeBrutto : (getraenkeBruttoN > 0 ? fmtEur(getraenkeBruttoN) : '')}
                      onFocus={() => setFocusedField('getraenkeBrutto')}
                      onBlur={() => setFocusedField(null)}
                      onChange={(e) => setGetraenkeBrutto(e.target.value)} />
                  ) : (
                    <div className={`${inputCls} !bg-gray-200 !border-gray-300 !shadow-none text-gray-500 cursor-not-allowed select-none`}>
                      {getraenkeBruttoN > 0 ? fmtEur(getraenkeBruttoN) : '0,00 €'}
                    </div>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Brutto Gesamt (€)</label>
                  <div className={`${inputCls} !bg-gray-200 !border-gray-300 !shadow-none text-gray-500 cursor-not-allowed select-none`}>
                    {fmtEur(bruttoGesamt)}
                  </div>
                </div>
              </div>

              {/* Row 2: MwSt rate inputs */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <label className={labelCls}>MwSt Essen (%)</label>
                  {inputMode === 'pauschale' ? (
                    <div className={`${inputCls} !bg-gray-200 !border-gray-300 !shadow-none text-gray-500 cursor-not-allowed select-none`}>7 %</div>
                  ) : (
                    <input type="number" step="0.1" min="0" max="100" className={inputCls}
                      value={mwstEssen} onChange={(e) => setMwstEssen(e.target.value)} />
                  )}
                </div>
                <div>
                  <label className={labelCls}>MwSt Getränke (%)</label>
                  {inputMode === 'pauschale' ? (
                    <div className={`${inputCls} !bg-gray-200 !border-gray-300 !shadow-none text-gray-500 cursor-not-allowed select-none`}>19 %</div>
                  ) : (
                    <input type="number" step="0.1" min="0" max="100" className={inputCls}
                      value={mwstGetraenke} onChange={(e) => setMwstGetraenke(e.target.value)} />
                  )}
                </div>
                <div>
                  <label className={labelCls}>MwSt Gesamt (%)</label>
                  <div className={`${inputCls} !bg-gray-200 !border-gray-300 !shadow-none text-gray-500 cursor-not-allowed select-none`}>
                    {mwstGesamtPct > 0 ? mwstGesamtPct.toFixed(2) + ' %' : '—'}
                  </div>
                </div>
              </div>

              {/* Row 3: Netto (editable in netto mode, calculated in brutto mode) + Trinkgeld */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Essen Netto (€)</label>
                  {inputMode === 'netto' ? (
                    <input
                      type={focusedField === 'essenNetto' ? 'number' : 'text'}
                      step="0.01" min="0" className={inputCls} placeholder="0,00 €"
                      value={focusedField === 'essenNetto' ? essenNettoInput : (essenN > 0 ? fmtEur(essenN) : '')}
                      onFocus={() => setFocusedField('essenNetto')}
                      onBlur={() => setFocusedField(null)}
                      onChange={(e) => setEssenNettoInput(e.target.value)} />
                  ) : (
                    <div className={`${inputCls} !bg-gray-200 !border-gray-300 !shadow-none text-gray-500 cursor-not-allowed select-none`}>
                      {fmtEur(essenN)}
                    </div>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Getränke Netto (€)</label>
                  {inputMode === 'netto' ? (
                    <input
                      type={focusedField === 'getraenkeNetto' ? 'number' : 'text'}
                      step="0.01" min="0" className={inputCls} placeholder="0,00 €"
                      value={focusedField === 'getraenkeNetto' ? getraenkeNettoInput : (getraenkeN > 0 ? fmtEur(getraenkeN) : '')}
                      onFocus={() => setFocusedField('getraenkeNetto')}
                      onBlur={() => setFocusedField(null)}
                      onChange={(e) => setGetraenkeNettoInput(e.target.value)} />
                  ) : (
                    <div className={`${inputCls} !bg-gray-200 !border-gray-300 !shadow-none text-gray-500 cursor-not-allowed select-none`}>
                      {fmtEur(getraenkeN)}
                    </div>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Trinkgeld (€) — optional</label>
                  <input
                    type={focusedField === 'trinkgeld' ? 'number' : 'text'}
                    step="0.01" min="0"
                    className={inputCls}
                    placeholder="0,00 €"
                    value={focusedField === 'trinkgeld'
                      ? trinkgeld
                      : (trinkgeldN > 0 ? fmtEur(trinkgeldN) : '')}
                    onFocus={() => setFocusedField('trinkgeld')}
                    onBlur={() => setFocusedField(null)}
                    onChange={(e) => setTrinkgeld(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* Abzüge: Anzahlung + Ermässigung */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-sm font-bold text-gray-800 mb-4 pb-3 border-b border-gray-100">Abzüge (optional)</p>
            <div className="space-y-4">

              {/* Anzahlung */}
              <div>
                <label className={labelCls}>Anzahlung (Deposit) — select a previous bill</label>
                {anzahlungBill ? (
                  <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">
                        {anzahlungBill.invoice_number ? `#${anzahlungBill.invoice_number} — ` : ''}{anzahlungBill.customer_name}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Brutto (abziehen): <span className="font-semibold text-gray-800">{fmtEur(anzahlungBill.total_payable)}</span>
                        &nbsp;·&nbsp;Netto (MwSt-Ref): <span className="font-semibold text-gray-800">{fmtEur(anzahlungBill.net_total)}</span>
                      </p>
                    </div>
                    <button type="button" onClick={() => { setAnzahlungBillId(null); setAnzahlungSearch(''); }}
                      className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <div ref={anzahlungPickerRef} className="relative">
                    <input
                      className={inputCls}
                      placeholder="Search by invoice # or customer name…"
                      value={anzahlungSearch}
                      onChange={(e) => { setAnzahlungSearch(e.target.value); setShowAnzahlungPicker(true); }}
                      onFocus={() => setShowAnzahlungPicker(true)}
                    />
                    {showAnzahlungPicker && (
                      <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto">
                        {anzahlungFilteredBills.length === 0 ? (
                          <p className="px-4 py-3 text-xs text-gray-400">No matching bills found</p>
                        ) : (
                          anzahlungFilteredBills.slice(0, 20).map((b) => (
                            <button key={b.id} type="button"
                              onMouseDown={() => { setAnzahlungBillId(b.id); setAnzahlungSearch(''); setShowAnzahlungPicker(false); }}
                              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-0 transition-colors">
                              <p className="text-sm font-semibold text-gray-800">
                                {b.invoice_number ? `#${b.invoice_number} — ` : ''}{b.customer_name}
                              </p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {fmtDate(b.event_date ?? b.invoice_date)} · {fmtEur(b.total_payable)}
                              </p>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Ermässigung */}
              <div>
                <label className={labelCls}>Ermässigung (Discount) (€)</label>
                <input
                  type={focusedErmaessigung ? 'number' : 'text'}
                  step="0.01" min="0"
                  className={inputCls}
                  placeholder="0,00 €"
                  value={focusedErmaessigung ? ermaessigung : (ermaessigungN > 0 ? fmtEur(ermaessigungN) : '')}
                  onFocus={() => setFocusedErmaessigung(true)}
                  onBlur={() => setFocusedErmaessigung(false)}
                  onChange={(e) => setErmaessigung(e.target.value)}
                />
              </div>

            </div>
          </div>

          {/* Live totals */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-sm font-bold text-gray-800 mb-4 pb-3 border-b border-gray-100">Totals Preview</p>
            <table className="w-full text-sm border-collapse">
              <tbody>
                {/* ── Brutto block ── */}
                {(billType === 'dinner' || billType === 'storno') && (<>
                  <tr className="border-b border-gray-100">
                    <td className="py-2 px-3 text-gray-600 bg-gray-50 border border-gray-200 rounded-tl">Essen Brutto (€)</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-800 bg-gray-50 border border-gray-200 rounded-tr">{fmtEur(essenBruttoN)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="py-2 px-3 text-gray-600 border border-gray-200 border-t-0">Getränke Brutto (€)</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-800 border border-gray-200 border-t-0">{fmtEur(getraenkeBruttoN)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border border-gray-200 border-t-0">Gesamt Brutto (€)</td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold text-gray-900 bg-gray-50 border border-gray-200 border-t-0">{fmtEur(bruttoGesamt)}</td>
                  </tr>

                  {/* ── MwSt block ── */}
                  <tr className="border-t-2 border-gray-300">
                    <td className="py-2 px-3 text-gray-600 bg-gray-50 border border-gray-200">MwSt Essen ({mwstEssen || 7}%)</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-800 bg-gray-50 border border-gray-200">{fmtEur(mwstVatEssen)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 text-gray-600 border border-gray-200 border-t-0">MwSt Getränke ({mwstGetraenke || 19}%)</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-800 border border-gray-200 border-t-0">{fmtEur(mwstVatGetraenke)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border border-gray-200 border-t-0">MwSt Gesamt</td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold text-gray-900 bg-gray-50 border border-gray-200 border-t-0">{fmtEur(mwstVatEssen + mwstVatGetraenke)}</td>
                  </tr>

                  {/* ── Netto block ── */}
                  <tr className="border-t-2 border-gray-300">
                    <td className="py-2 px-3 text-gray-600 bg-gray-50 border border-gray-200">Essen Netto (€)</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-800 bg-gray-50 border border-gray-200">{fmtEur(essenN)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 text-gray-600 border border-gray-200 border-t-0">Getränke Netto (€)</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-800 border border-gray-200 border-t-0">{fmtEur(getraenkeN)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border border-gray-200 border-t-0">Gesamt Netto (€)</td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold text-gray-900 bg-gray-50 border border-gray-200 border-t-0">{fmtEur(netto)}</td>
                  </tr>

                  {/* ── Trinkgeld ── */}
                  <tr className="border-t-2 border-gray-300">
                    <td className="py-2 px-3 text-gray-600 border border-gray-200">Trinkgeld (€)</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-800 border border-gray-200">{trinkgeldN > 0 ? fmtEur(trinkgeldN) : <span className="text-gray-300">—</span>}</td>
                  </tr>
                </>)}

                {billType === 'monthly' && (<>
                  <tr>
                    <td className="py-2 px-3 text-gray-600 bg-gray-50 border border-gray-200 rounded-t">Gesamt Netto (€)</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-800 bg-gray-50 border border-gray-200">{fmtEur(netto)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 text-gray-600 border border-gray-200 border-t-0">MwSt (7%)</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-800 border border-gray-200 border-t-0">{fmtEur(mwst7)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border border-gray-200 border-t-0">Gesamt Brutto (€)</td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold text-gray-900 bg-gray-50 border border-gray-200 border-t-0">{fmtEur(brutto)}</td>
                  </tr>
                </>)}

                {/* ── Grand total / deductions ── */}
                {hasDeductions ? (<>
                  <tr className="border-t-2 border-gray-400">
                    <td className="py-2.5 px-3 font-semibold text-gray-700 border border-gray-300 bg-gray-50">Gesamtbetrag (€)</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-gray-700 border border-gray-300 bg-gray-50">{fmtEur(billTotal)}</td>
                  </tr>
                  {anzahlungBruttoN > 0 && (<>
                    <tr>
                      <td className="py-2 px-3 text-gray-600 border border-gray-200 border-t-0" colSpan={2}>
                        <span className="font-semibold">abzgl. Anzahlung</span>
                        {anzahlungBill?.invoice_number && <span className="text-gray-400 ml-1">(Rg.-Nr. {anzahlungBill.invoice_number})</span>}
                      </td>
                    </tr>
                    {anzahlungNettoN > 0 && (
                      <tr>
                        <td className="py-1 px-3 pl-8 text-gray-500 text-xs border border-gray-200 border-t-0">Netto</td>
                        <td className="py-1 px-3 text-right tabular-nums text-xs text-gray-500 border border-gray-200 border-t-0">{fmtEur(anzahlungNettoN)}</td>
                      </tr>
                    )}
                    {(anzahlungBill?.vat_7 ?? 0) > 0 && (
                      <tr>
                        <td className="py-1 px-3 pl-8 text-gray-500 text-xs border border-gray-200 border-t-0">MwSt 7%</td>
                        <td className="py-1 px-3 text-right tabular-nums text-xs text-gray-500 border border-gray-200 border-t-0">{fmtEur(anzahlungBill!.vat_7)}</td>
                      </tr>
                    )}
                    {(anzahlungBill?.vat_19 ?? 0) > 0 && (
                      <tr>
                        <td className="py-1 px-3 pl-8 text-gray-500 text-xs border border-gray-200 border-t-0">MwSt 19%</td>
                        <td className="py-1 px-3 text-right tabular-nums text-xs text-gray-500 border border-gray-200 border-t-0">{fmtEur(anzahlungBill!.vat_19)}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="py-1 px-3 pl-8 text-gray-600 text-xs border border-gray-200 border-t-0">Brutto (abziehen)</td>
                      <td className="py-1 px-3 text-right tabular-nums text-xs text-red-600 border border-gray-200 border-t-0">− {fmtEur(anzahlungBruttoN)}</td>
                    </tr>
                  </>)}
                  {ermaessigungN > 0 && (
                    <tr>
                      <td className="py-2 px-3 text-gray-600 border border-gray-200 border-t-0">abzgl. Ermässigung</td>
                      <td className="py-2 px-3 text-right tabular-nums text-red-600 border border-gray-200 border-t-0">− {fmtEur(ermaessigungN)}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="py-2.5 px-3 font-bold text-gray-900 border border-gray-300 bg-gray-100">Restbetrag (€, zu zahlen)</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-bold text-gray-900 border border-gray-300 bg-gray-100">{fmtEur(finalTotal)}</td>
                  </tr>
                </>) : (
                  <tr className="border-t-2 border-gray-400">
                    <td className="py-2.5 px-3 font-bold text-gray-900 border border-gray-300 bg-gray-100">Gesamtbetrag (€, zu zahlen)</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-bold text-gray-900 border border-gray-300 bg-gray-100">{fmtEur(billTotal)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full flex items-center justify-center gap-2 bg-[#1B5E20] text-white py-3 rounded-lg text-sm font-bold hover:bg-[#2E7D32] transition-colors disabled:opacity-50"
          >
            <FileDown size={16} />
            {generating ? 'Generating PDF…' : 'Generate, Approve and Send PDF'}
          </button>

        </div>
      )}

      {/* ═══════ BILLS TAB ═══════ */}
      {tab === 'bills' && (
        <div>
          {/* Summary cards */}
          {bills.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
              {[
                { label: 'Net Total',      value: fmt(totals.net),     color: 'text-blue-700' },
                { label: 'Gross Total',    value: fmt(totals.gross),   color: 'text-gray-900' },
                { label: 'Tips Total',     value: fmt(totals.tips),    color: 'text-amber-700' },
                { label: 'Total Payable',  value: fmt(totals.total),   color: 'text-[#1B5E20]' },
                { label: 'Total Pending',  value: fmt(totals.pending), color: 'text-orange-600' },
              ].map((s) => (
                <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{s.label}</p>
                  <p className={`text-base sm:text-xl font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              className="flex-1 sm:flex-none border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30">
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}
              className="flex-1 sm:flex-none border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30">
              <option value="all">All locations</option>
              {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
            </select>
            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
              className="w-full sm:w-auto border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30">
              <option value="all">All dates</option>
              {uniqueMonths.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
            <span className="text-xs text-gray-400 sm:ml-auto w-full sm:w-auto">{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}</span>
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
            <>
              {/* ── Mobile card list (< sm) ──────────────────────────────── */}
              <div className="sm:hidden space-y-2">
                {sortedBills.map((bill) => (
                  <div key={bill.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="px-4 py-3">
                      {/* Row 1: customer + invoice # + status */}
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm truncate">{bill.customer_name}</p>
                          {bill.invoice_number && (
                            <p className="text-xs font-mono text-gray-400">#{bill.invoice_number}</p>
                          )}
                        </div>
                        <select value={bill.status} onChange={(e) => updateStatus(bill.id, e.target.value)}
                          className={`flex-shrink-0 text-xs font-semibold px-2 py-1 rounded-full border cursor-pointer focus:outline-none ${STATUS_STYLES[bill.status] ?? ''}`}>
                          <option value="pending">Pending</option>
                          <option value="paid">Paid</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>

                      {/* Row 2: event date + location + shift */}
                      <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-2">
                        {bill.event_date && (
                          <span className="text-xs text-gray-500">{fmtDate(bill.event_date)}</span>
                        )}
                        {bill.issuing_location && (
                          <span className="text-xs px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded-full">{bill.issuing_location}</span>
                        )}
                        {bill.shift_type && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${bill.shift_type === 'lunch' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                            {bill.shift_type === 'lunch' ? '☀️ Lunch' : '🌙 Dinner'}
                          </span>
                        )}
                      </div>

                      {/* Row 3: total + actions */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-base font-bold text-[#1B5E20] tabular-nums">{fmt(bill.total_payable)}</p>
                          {bill.tips > 0 && (
                            <p className="text-xs text-amber-600">incl. {fmt(bill.tips)} tips</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {bill.file_path && (
                            <>
                              <a href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bills/${bill.file_path}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-gray-400 hover:text-blue-500 transition-colors" title="View PDF">
                                <Eye size={16} />
                              </a>
                              <a href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bills/${bill.file_path}`}
                                download
                                className="text-gray-400 hover:text-green-500 transition-colors" title="Download PDF">
                                <Download size={16} />
                              </a>
                            </>
                          )}
                          <button
                            onClick={() => editingId === bill.id ? setEditingId(null) : startEdit(bill)}
                            className={`transition-colors ${editingId === bill.id ? 'text-indigo-500' : 'text-gray-400 hover:text-indigo-500'}`}
                          >
                            <Pencil size={16} />
                          </button>
                          <button onClick={() => deleteBill(bill.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Inline edit (mobile) */}
                    {editingId === bill.id && editDraft && (
                      <div className="border-t border-indigo-100 bg-indigo-50/60 px-4 py-4 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          {([
                            { label: 'Customer',       field: 'customer_name'  as keyof OutgoingBill, type: 'text' },
                            { label: 'Invoice #',      field: 'invoice_number' as keyof OutgoingBill, type: 'text' },
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
                        <div className="grid grid-cols-2 gap-3">
                          {([
                            { label: 'Net Total (€)',   field: 'net_total'     as keyof OutgoingBill },
                            { label: 'Gross Total (€)', field: 'gross_total'   as keyof OutgoingBill },
                            { label: 'Tips (€)',        field: 'tips'          as keyof OutgoingBill },
                            { label: 'Total Payable (€)',field:'total_payable' as keyof OutgoingBill },
                          ]).map(({ label, field }) => (
                            <div key={field}>
                              <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                              <input type="number" step="0.01" value={(editDraft as any)[field] ?? 0}
                                onChange={(e) => setEditDraft((d) => d ? { ...d, [field]: parseFloat(e.target.value) || 0 } : d)}
                                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={saveEdit} disabled={savingEdit}
                            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                            {savingEdit ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                            {savingEdit ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={() => { setEditingId(null); setEditDraft(null); }}
                            className="px-3 py-2 text-xs font-semibold text-gray-500 border border-gray-200 rounded-lg bg-white transition-colors">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Mobile totals bar */}
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-xs text-gray-500 font-semibold">{filtered.length} invoices</span>
                  <span className="text-sm font-bold text-[#1B5E20] tabular-nums">{fmt(totals.total)}</span>
                </div>
              </div>

              {/* ── Desktop table (≥ sm) ─────────────────────────────────── */}
              <div className="hidden sm:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoice #</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Issue Date</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Event Date</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Shift</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Net</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Gross</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Tips</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Payable</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                      <th className="px-2 py-2 w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedBills.map((bill) => (
                      <React.Fragment key={bill.id}>
                        <tr className="hover:bg-gray-50 transition-colors">
                          <td className="px-2 py-2 font-semibold text-gray-900">{bill.customer_name}</td>
                          <td className="px-2 py-2 text-gray-500 font-mono text-xs">{bill.invoice_number ?? '—'}</td>
                          <td className="px-2 py-2 text-gray-600 whitespace-nowrap text-xs">{fmtDate(bill.invoice_date)}</td>
                          <td className="px-2 py-2 text-gray-600 whitespace-nowrap text-xs">{fmtDate(bill.event_date)}</td>
                          <td className="px-2 py-2">
                            {bill.issuing_location
                              ? <span className="inline-flex items-center px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-full">{bill.issuing_location}</span>
                              : <span className="text-xs text-red-400">—</span>
                            }
                          </td>
                          <td className="px-2 py-2">
                            {bill.shift_type
                              ? <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full font-semibold ${bill.shift_type === 'lunch' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                                  {bill.shift_type === 'lunch' ? '☀️ Lunch' : '🌙 Dinner'}
                                </span>
                              : <span className="text-xs text-red-400">—</span>
                            }
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-gray-700">{fmt(bill.net_total)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-gray-900">{fmt(bill.gross_total)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-amber-700">{bill.tips > 0 ? fmt(bill.tips) : '—'}</td>
                          <td className="px-2 py-2 text-right font-bold text-[#1B5E20] tabular-nums">{fmt(bill.total_payable)}</td>
                          <td className="px-2 py-2">
                            <select value={bill.status} onChange={(e) => updateStatus(bill.id, e.target.value)}
                              className={`text-xs font-semibold px-2 py-1 rounded-full border cursor-pointer focus:outline-none ${STATUS_STYLES[bill.status] ?? ''}`}>
                              <option value="pending">Pending</option>
                              <option value="paid">Paid</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              {bill.file_path && (
                                <>
                                  <a href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bills/${bill.file_path}`}
                                    target="_blank" rel="noopener noreferrer"
                                    className="text-gray-300 hover:text-blue-500 transition-colors" title="View PDF">
                                    <Eye size={14} />
                                  </a>
                                  <a href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bills/${bill.file_path}`}
                                    download
                                    className="text-gray-300 hover:text-green-500 transition-colors" title="Download PDF">
                                    <Download size={14} />
                                  </a>
                                </>
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
                            <td colSpan={12} className="px-4 py-4">
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
                      <td colSpan={6} className="px-4 py-3 text-xs font-semibold text-gray-500">{filtered.length} invoices</td>
                      <td className="px-2 py-2 text-right font-bold text-gray-700 tabular-nums">{fmt(totals.net)}</td>
                      <td className="px-2 py-2 text-right font-bold text-gray-900 tabular-nums">{fmt(totals.gross)}</td>
                      <td className="px-2 py-2 text-right font-bold text-amber-700 tabular-nums">{fmt(totals.tips)}</td>
                      <td className="px-2 py-2 text-right font-bold text-[#1B5E20] tabular-nums">{fmt(totals.total)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════ VALUE DETAILS MODAL ═══════ */}
      {valueDetailsOpen && receiptLineItems.length > 0 && (() => {
        const essenItems     = receiptLineItems.map((item, idx) => ({ ...item, idx })).filter((i) => i.taxCode === 'B');
        const getraenkeItems = receiptLineItems.map((item, idx) => ({ ...item, idx })).filter((i) => i.taxCode === 'A');
        const essenSum       = essenItems.reduce((s, i) => s + i.total, 0);
        const getraenkeSum   = getraenkeItems.reduce((s, i) => s + i.total, 0);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
                <h2 className="text-base font-bold text-gray-900">Value Details</h2>
                <button type="button" onClick={() => setValueDetailsOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                  <X size={16} className="text-gray-500" />
                </button>
              </div>
              <div className="px-6 py-5 overflow-y-auto space-y-5 flex-1">

                {/* Essen (B / 7%) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Essen (B · 7% MwSt)</p>
                    <p className="text-sm font-bold text-gray-800">{fmtEur(essenSum)}</p>
                  </div>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left px-2 py-1.5 font-semibold text-gray-500 border border-gray-200">Item</th>
                        <th className="text-center px-2 py-1.5 font-semibold text-gray-500 border border-gray-200 w-12">Qty</th>
                        <th className="text-right px-2 py-1.5 font-semibold text-gray-500 border border-gray-200 w-24">Total</th>
                        <th className="border border-gray-200 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {essenItems.map((item) => (
                        <tr key={item.idx} className="border-b border-gray-100 last:border-0">
                          <td className="px-2 py-1.5 text-gray-700 border border-gray-200">{item.name}</td>
                          <td className="px-2 py-1.5 text-center text-gray-500 border border-gray-200">{item.qty}×</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-800 border border-gray-200">{fmtEur(item.total)}</td>
                          <td className="px-1 py-1.5 text-center border border-gray-200">
                            <button
                              type="button"
                              title="Move to Getränke"
                              onClick={() => moveReceiptItem(item.idx, 'A')}
                              className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded px-1 py-0.5 transition-colors"
                            >↓</button>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-green-50 font-semibold">
                        <td className="px-2 py-1.5 text-gray-700 border border-gray-200" colSpan={2}>Total Essen Brutto</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-[#1B5E20] border border-gray-200">{fmtEur(essenSum)}</td>
                        <td className="border border-gray-200"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Getränke (A / 19%) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Getränke (A · 19% MwSt)</p>
                    <p className="text-sm font-bold text-gray-800">{fmtEur(getraenkeSum)}</p>
                  </div>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left px-2 py-1.5 font-semibold text-gray-500 border border-gray-200">Item</th>
                        <th className="text-center px-2 py-1.5 font-semibold text-gray-500 border border-gray-200 w-12">Qty</th>
                        <th className="text-right px-2 py-1.5 font-semibold text-gray-500 border border-gray-200 w-24">Total</th>
                        <th className="border border-gray-200 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {getraenkeItems.map((item) => (
                        <tr key={item.idx} className="border-b border-gray-100 last:border-0">
                          <td className="px-2 py-1.5 text-gray-700 border border-gray-200">{item.name}</td>
                          <td className="px-2 py-1.5 text-center text-gray-500 border border-gray-200">{item.qty}×</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-800 border border-gray-200">{fmtEur(item.total)}</td>
                          <td className="px-1 py-1.5 text-center border border-gray-200">
                            <button
                              type="button"
                              title="Move to Essen"
                              onClick={() => moveReceiptItem(item.idx, 'B')}
                              className="text-green-600 hover:text-green-800 hover:bg-green-50 rounded px-1 py-0.5 transition-colors"
                            >↑</button>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-blue-50 font-semibold">
                        <td className="px-2 py-1.5 text-gray-700 border border-gray-200" colSpan={2}>Total Getränke Brutto</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-blue-700 border border-gray-200">{fmtEur(getraenkeSum)}</td>
                        <td className="border border-gray-200"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Grand total */}
                <div className="border-t-2 border-gray-200 pt-3 flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-700">Gesamt Brutto</p>
                  <p className="text-base font-bold text-gray-900">{fmtEur(essenSum + getraenkeSum)}</p>
                </div>
              </div>

              <div className="px-6 pb-5">
                <button type="button" onClick={() => setValueDetailsOpen(false)}
                  className="w-full py-2.5 rounded-lg border border-gray-300 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════ STORNO BILL PICKER MODAL ═══════ */}
      {stornoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-bold text-gray-900">Select Invoice to Cancel</h2>
              <button type="button" onClick={() => setStornoModal(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X size={16} className="text-gray-500" />
              </button>
            </div>
            <div className="px-6 py-3 border-b border-gray-100 flex-shrink-0">
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400"
                placeholder="Search by invoice number or customer…"
                value={stornoSearch}
                onChange={(e) => setStornoSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="overflow-y-auto flex-1 px-3 py-2">
              {bills
                .filter((b) => b.status !== 'cancelled' && (
                  stornoSearch.trim().length === 0 ||
                  (b.invoice_number ?? '').toLowerCase().includes(stornoSearch.toLowerCase()) ||
                  b.customer_name.toLowerCase().includes(stornoSearch.toLowerCase())
                ))
                .sort((a, b) => {
                  const parse = (inv: string | null) => {
                    const m = inv?.match(/^(\d+)-(\d+)$/);
                    return m ? parseInt(m[2], 10) * 100000 + parseInt(m[1], 10) : -1;
                  };
                  return parse(b.invoice_number) - parse(a.invoice_number);
                })
                .map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => applyStornoBill(b)}
                    className="w-full text-left px-4 py-3 rounded-xl hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors mb-1"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-800">
                        #{b.invoice_number} — {b.customer_name}
                      </p>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLES[b.status] ?? ''}`}>
                        {b.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {fmtDate(b.invoice_date)} · {b.issuing_location ?? '—'} · {fmt(b.total_payable)}
                    </p>
                  </button>
                ))}
              {bills.filter((b) => b.status !== 'cancelled').length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">No invoices found</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ APPROVE & SEND MODAL ═══════ */}
      {sendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">Invoice Ready</h2>
              <button type="button" onClick={() => setSendModal(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X size={16} className="text-gray-500" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Invoice info */}
              <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-700">
                <span className="font-semibold">{invoiceNumber}</span>
                {company && <> · {company}</>}
                {billTotal > 0 && <> · <span className="font-semibold">{fmtEur(billTotal)}</span></>}
              </div>

              {/* View PDF */}
              <button
                type="button"
                onClick={() => pendingPdfUrl && window.open(pendingPdfUrl, '_blank')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Eye size={15} /> View PDF
              </button>

              {/* Divider */}
              <div className="border-t border-gray-100" />

              {/* Send by email (optional) */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Send by email <span className="normal-case font-normal text-gray-400">(optional)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                    placeholder="customer@company.com"
                    value={sendEmail}
                    onChange={(e) => setSendEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !sending && sendEmail.trim() && handleSend()}
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || approving || !sendEmail.trim()}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>

              {/* Error */}
              {sendError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{sendError}</p>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 pb-5 flex gap-3">
              <button type="button" onClick={() => setSendModal(false)}
                className="flex-1 py-2.5 rounded-lg border border-gray-300 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={approving || sending}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#1B5E20] text-white text-sm font-bold hover:bg-[#2E7D32] disabled:opacity-50 transition-colors"
              >
                {approving ? <><Loader2 size={14} className="animate-spin" /> Approving…</> : <><CheckCircle2 size={14} /> Approve</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Client Registry Modal ─────────────────────────────────────── */}
      {registryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <BookOpen size={18} className="text-indigo-600" />
                <h2 className="text-base font-bold text-gray-900">Client Registry</h2>
                <span className="text-xs text-gray-400 font-normal ml-1">({registryCustomers.length} customers)</span>
              </div>
              <button onClick={() => { setRegistryOpen(false); setRegistrySearch(''); }}
                className="text-gray-400 hover:text-gray-700 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Search */}
            <div className="px-6 py-3 border-b border-gray-100">
              <div className="relative">
                <input
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="Filter by company name…"
                  value={registrySearch}
                  onChange={(e) => setRegistrySearch(e.target.value)}
                  autoFocus
                />
                <svg className="absolute left-2.5 top-2.5 text-gray-400 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-y-auto flex-1">
              {registryLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-400 text-sm gap-2">
                  <Loader2 size={16} className="animate-spin" /> Loading…
                </div>
              ) : filteredRegistry.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-12">No customers found.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      <th className="px-4 py-2 text-left">Company</th>
                      <th className="px-4 py-2 text-left">Address</th>
                      <th className="px-4 py-2 text-left">Contact</th>
                      <th className="px-4 py-2 text-left">PO / Att</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRegistry.map((c) => (
                      <tr key={c.id} className="border-t border-gray-100 hover:bg-indigo-50/40 transition-colors group">
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-gray-900">{c.company_name}</p>
                          {c.extra_line && <p className="text-xs text-gray-400">{c.extra_line}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {[c.street, c.postcode, c.city].filter(Boolean).join(', ') || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {c.contact_name || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 text-xs">
                          {c.po_number && <div>PO: {c.po_number}</div>}
                          {c.att && <div>Att: {c.att}</div>}
                          {!c.po_number && !c.att && <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => { applyCustomer(c); setRegistryOpen(false); setRegistrySearch(''); }}
                              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors whitespace-nowrap"
                              title="Use this customer">
                              Select
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteCustomer(c.id)}
                              className="text-gray-300 hover:text-red-500 transition-colors"
                              title="Delete">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
