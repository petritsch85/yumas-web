'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload, Loader2, TrendingUp, TrendingDown, Minus,
  Link2, Link2Off, X, Search, CheckCircle2, Check, XCircle,
  Download, ChevronDown, ChevronUp, FileText, Info, Wand2,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────────── */
type CfUpload = {
  id: string;
  filename: string;
  period_label: string;
  uploaded_at: string;
  transaction_count: number;
  file_path: string | null;
};

type BillRef = {
  id: string;
  supplier_name: string;
  invoice_number: string | null;
  gross_amount: number;
  file_path: string | null;
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
  bill_id: string | null;
  bill: BillRef | null;
  confirmed: boolean;
  counterparty_id: string | null;
  accounting_period: string | null; // "type|start[|end]"
};

type Counterparty = {
  id: string;
  name: string;
  category: string | null;
  default_vat_rate: number | null;
  keywords: string[];
};

type TxPage = { data: CfTx[]; count: number; page: number; pageSize: number };

type BillSearchResult = {
  id: string;
  supplier_name: string;
  invoice_number: string | null;
  invoice_date: string | null;
  gross_amount: number;
  net_amount: number;
  category: string | null;
  location_label: string | null;
  status: string;
  _score?: number;
};

/* ── Constants ──────────────────────────────────────────────────────── */
const C_CATEGORIES = [
  'C - Personnel','C - Suppliers','C - Rent','C - OpenTable','C - Orderbird',
  'C - Tax Advisor','C - Insurance','C - Energy','C - Marketing',
  'C - Financing','C - Amazon','C - Other',
];
const S_CATEGORIES = ['S - In House','S - Delivery','S - Catering','S - Other'];
const ALL_CATEGORIES = [...C_CATEGORIES, ...S_CATEGORIES];

const OUT_LOCATIONS = ['Westend','Eschborn','Taunus','ZK','HQ/Admin','Other'];
const IN_LOCATIONS  = ['Westend','Eschborn','Taunus','Catering','Other'];

/* ── Category colours (chips + option bg) ───────────────────────────── */
const C_CHIP = 'bg-red-100 text-gray-900';
const S_CHIP = 'bg-green-100 text-gray-900';

function defaultVatRate(cat: string | null): number {
  if (!cat) return 0;
  if (cat === 'C - Personnel') return 0;
  if (cat === 'C - Financing') return 0;
  if (cat.startsWith('C - ')) return 19;
  if (cat.startsWith('S - ')) return 10;
  return 0;
}

function catChip(cat: string): string {
  if (cat.startsWith('C - ')) return C_CHIP;
  if (cat.startsWith('S - ')) return S_CHIP;
  return 'bg-gray-100 text-gray-700';
}

// Inline style for <option> background (native select)
function optionBg(cat: string): string {
  if (cat.startsWith('C - ')) return '#fee2e2'; // red-100
  if (cat.startsWith('S - ')) return '#dcfce7'; // green-100
  return '';
}

/* ── Period helpers ─────────────────────────────────────────────────── */
type Period = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'H1' | 'H2' | 'Jan' | 'Feb' | 'Mar' | 'Apr' | 'May' | 'Jun' | 'Jul' | 'Aug' | 'Sep' | 'Oct' | 'Nov' | 'Dec';

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

/* ── Helpers ────────────────────────────────────────────────────────── */
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
function matchCounterparty(rawName: string | null, counterparties: Counterparty[]): Counterparty | null {
  if (!rawName || counterparties.length === 0) return null;
  const lower = rawName.toLowerCase();
  return counterparties.find(cp => {
    // Use explicit keywords if defined, otherwise fall back to the counterparty name itself
    const terms = cp.keywords.length > 0 ? cp.keywords : [cp.name];
    return terms.some(kw => kw && lower.includes(kw.toLowerCase()));
  }) ?? null;
}

// Compute VAT breakdown for a set of aggRows using the per-category defaultVatRate.
// All amounts in cents; brutto/mwst/netto are absolute (unsigned).
function bucketVat(rows: { category: string | null; total_cents: number }[]) {
  let bruttoAbs = 0, mwstAbs = 0;
  for (const row of rows) {
    const rate = defaultVatRate(row.category);
    const m = rate === 0 ? 0 : Math.round(row.total_cents * rate / (100 + rate));
    bruttoAbs += row.total_cents;
    mwstAbs   += m;
  }
  const nettoAbs    = bruttoAbs - mwstAbs;
  // German convention: MwSt % = VAT / netto (not / brutto), so 10% VAT on 100€ net → 10%, not 9.09%
  const blendedPct  = nettoAbs > 0 ? (mwstAbs / nettoAbs * 100) : 0;
  return { bruttoAbs, mwstAbs, nettoAbs, blendedPct };
}

/* ── Bill Match Modal ───────────────────────────────────────────────── */
function BillMatchModal({ tx, onLink, onUnlink, onClose }: {
  tx: CfTx;
  onLink: (id: string) => void;
  onUnlink: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const { data: results = [], isFetching } = useQuery<BillSearchResult[]>({
    queryKey: ['bill-search', q, tx.amount_cents],
    queryFn: () => {
      const p = new URLSearchParams({ amountCents: String(tx.amount_cents) });
      if (q) p.set('q', q);
      return fetch(`/api/cashflow/bills-search?${p}`).then(r => r.json());
    },
    staleTime: 30_000,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">Link to Bill</h3>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{tx.counterparty || '—'} · {eur(tx.amount_cents)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {tx.bill && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-green-50 border border-green-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-green-600 flex-shrink-0" />
              <div>
                <div className="text-xs font-semibold text-green-800">{tx.bill.supplier_name}</div>
                <div className="text-xs text-green-700">{tx.bill.invoice_number ?? 'No invoice #'} · {eurAmt(tx.bill.gross_amount)}</div>
              </div>
            </div>
            <button onClick={onUnlink} className="text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1">
              <Link2Off size={12} /> Remove
            </button>
          </div>
        )}

        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 focus-within:border-[#1B5E20]">
            <Search size={14} className="text-gray-400 flex-shrink-0" />
            <input ref={ref} value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search by supplier or invoice number…"
              className="flex-1 text-sm outline-none bg-transparent" />
            {isFetching && <Loader2 size={12} className="animate-spin text-gray-400" />}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">Bills sorted by closest amount match first</p>
        </div>

        <div className="overflow-y-auto flex-1 px-4 pb-4 space-y-1.5">
          {results.length === 0 && !isFetching && (
            <div className="py-8 text-center text-gray-400 text-sm">No bills found</div>
          )}
          {results.map(bill => {
            const isLinked = tx.bill_id === bill.id;
            const amountMatch = tx.amount_cents > 0 &&
              Math.abs(Math.round(bill.gross_amount * 100) - tx.amount_cents) / tx.amount_cents < 0.02;
            return (
              <button key={bill.id} onClick={() => onLink(bill.id)}
                className={`w-full text-left rounded-xl border p-3 transition-colors hover:border-[#1B5E20] hover:bg-green-50/50 ${isLinked ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 text-sm truncate">{bill.supplier_name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {bill.invoice_number ?? 'No invoice #'}
                      {bill.invoice_date ? ` · ${fmtDate(bill.invoice_date)}` : ''}
                      {bill.location_label ? ` · ${bill.location_label}` : ''}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-sm font-semibold ${amountMatch ? 'text-green-700' : 'text-gray-900'}`}>{eurAmt(bill.gross_amount)}</div>
                    {amountMatch && <div className="text-xs text-green-600 font-medium">≈ match</div>}
                  </div>
                </div>
                {bill.category && (
                  <div className="mt-1.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      bill.status === 'approved' ? 'bg-green-100 text-green-800'
                      : bill.status === 'paid' ? 'bg-blue-100 text-blue-800'
                      : 'bg-amber-100 text-amber-800'
                    }`}>{bill.status}</span>
                    {' '}<span className="text-xs text-gray-400">{bill.category}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Period Picker ──────────────────────────────────────────────────── */
type PeriodType = 'one-off' | 'monthly' | 'annual' | 'custom';

function parsePeriod(raw: string | null): { type: PeriodType; start: string; end: string } | null {
  if (!raw) return null;
  const parts = raw.split('|');
  if (parts.length < 2) return null;
  return { type: parts[0] as PeriodType, start: parts[1], end: parts[2] ?? '' };
}

function periodLabel(raw: string | null): string {
  if (!raw) return '';
  const p = parsePeriod(raw);
  if (!p) return raw;
  const fmtYM = (ym: string) => {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  };
  const fmtD = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  switch (p.type) {
    case 'one-off': return fmtD(p.start);
    case 'monthly':  return fmtYM(p.start);
    case 'annual':   return `${fmtYM(p.start)} – ${fmtYM(p.end)}`;
    case 'custom':   return `${fmtD(p.start)} – ${fmtD(p.end)}`;
    default: return raw;
  }
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function MonthSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [y, m] = value ? value.split('-') : ['', ''];
  const selCls = 'border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1B5E20] bg-white';
  const curYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => curYear - 7 + i);
  const set = (ny: string, nm: string) => { if (ny && nm) onChange(`${ny}-${nm}`); };
  return (
    <div className="flex gap-2">
      <select value={m ?? ''} onChange={e => set(y, e.target.value)} className={`${selCls} flex-1`}>
        <option value="">Month</option>
        {MONTHS.map((mn, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{mn}</option>)}
      </select>
      <select value={y ?? ''} onChange={e => set(e.target.value, m)} className={`${selCls} w-24`}>
        <option value="">Year</option>
        {years.map(yr => <option key={yr} value={String(yr)}>{yr}</option>)}
      </select>
    </div>
  );
}

function PeriodPicker({ value, onChange, locked }: {
  value: string | null;
  onChange: (v: string | null) => void;
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, flipUp: false });
  const [type, setType] = useState<PeriodType>('monthly');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const openPicker = () => {
    if (locked) return;
    const p = parsePeriod(value);
    setType(p?.type ?? 'monthly');
    setStart(p?.start ?? '');
    setEnd(p?.end ?? '');
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      const popWidth = 288; // w-72
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
    let encoded: string | null = null;
    if (type === 'one-off' && start) encoded = `one-off|${start}`;
    else if (type === 'monthly' && start) encoded = `monthly|${start}`;
    else if (type === 'annual' && start && end) encoded = `annual|${start}|${end}`;
    else if (type === 'custom' && start && end) encoded = `custom|${start}|${end}`;
    onChange(encoded);
    setOpen(false);
  };

  const label = periodLabel(value);
  const TYPES: { key: PeriodType; label: string }[] = [
    { key: 'one-off', label: 'One-off' },
    { key: 'monthly', label: 'Monthly' },
    { key: 'annual',  label: 'Annual' },
    { key: 'custom',  label: 'Other period' },
  ];
  const inputCls = 'w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1B5E20]';

  return (
    <div className="relative inline-block">
      <button ref={btnRef} onClick={openPicker} disabled={locked}
        className={`text-xs rounded px-1.5 py-0.5 border whitespace-nowrap transition-colors ${
          label
            ? 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100'
            : locked
            ? 'bg-white border-gray-200 text-gray-400 cursor-default'
            : 'bg-white border-dashed border-gray-300 text-gray-400 hover:border-gray-500 hover:text-gray-600'
        }`}>
        {label || (locked ? '—' : '+ Set period')}
      </button>

      {open && (
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            top: pos.flipUp ? undefined : pos.top,
            bottom: pos.flipUp ? (window.innerHeight - pos.top) : undefined,
            left: pos.left,
            zIndex: 9999,
          }}
          className="bg-white border border-gray-200 rounded-xl shadow-2xl p-4 w-72"
        >
          <div className="grid grid-cols-2 gap-1.5 mb-4">
            {TYPES.map(t => (
              <button key={t.key} onClick={() => setType(t.key)}
                className={`py-1.5 px-2 text-xs rounded-lg font-medium border transition-colors ${
                  type === t.key
                    ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="space-y-2 mb-4">
            {type === 'one-off' && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">Date</label>
                <input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} />
              </div>
            )}
            {type === 'monthly' && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">Month</label>
                <MonthSelect value={start} onChange={setStart} />
              </div>
            )}
            {type === 'annual' && (
              <>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Start month</label>
                  <MonthSelect value={start} onChange={setStart} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">End month</label>
                  <MonthSelect value={end} onChange={setEnd} />
                </div>
              </>
            )}
            {type === 'custom' && (
              <>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Start date</label>
                  <input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">End date</label>
                  <input type="date" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} />
                </div>
              </>
            )}
          </div>

          <div className="flex gap-2 items-center">
            {value && (
              <button onClick={() => { onChange(null); setOpen(false); }}
                className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg border border-red-200">
                Clear
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <button onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 rounded-lg border border-gray-200">
                Cancel
              </button>
              <button onClick={apply}
                className="px-3 py-1.5 text-xs font-medium bg-[#1B5E20] text-white rounded-lg hover:bg-[#2E7D32]">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Row component ──────────────────────────────────────────────────── */
function TxRow({ tx, onSave, counterparties }: {
  tx: CfTx;
  onSave: (id: string, patch: Record<string, string | boolean | null>) => void;
  counterparties: Counterparty[];
}) {
  const isIn = tx.direction === 'in';
  const locations = isIn ? IN_LOCATIONS : OUT_LOCATIONS;
  const locked = tx.confirmed;

  const [notes, setNotes] = useState(tx.notes ?? '');
  const [showModal, setShowModal] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { setNotes(tx.notes ?? ''); }, [tx.notes]);

  const patch = useCallback((field: string, value: string | boolean | null) => {
    onSave(tx.id, { [field]: value });
  }, [tx.id, onSave]);

  const onNotesChange = (v: string) => {
    if (locked) return;
    setNotes(v);
    clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => patch('notes', v), 800);
  };

  const handleLink    = useCallback((id: string) => { patch('bill_id', id);   setShowModal(false); }, [patch]);
  const handleUnlink  = useCallback(() =>            { patch('bill_id', null); setShowModal(false); }, [patch]);

  const rowBg = locked
    ? 'bg-green-50/70 border-l-2 border-l-green-500'
    : isIn ? 'border-l-2 border-l-green-400' : 'border-l-2 border-l-red-400';

  const chipClass = catChip(tx.category);

  return (
    <>
      {showModal && !locked && (
        <BillMatchModal tx={tx} onLink={handleLink} onUnlink={handleUnlink} onClose={() => setShowModal(false)} />
      )}
      <tr className={`border-b border-gray-100 text-sm transition-colors ${rowBg} ${locked ? '' : 'hover:bg-gray-50/50'}`}>

        {/* Date */}
        <td className="py-2 px-2 text-gray-500 whitespace-nowrap font-mono text-xs">{fmtDate(tx.date)}</td>

        {/* Counterparty — shows matched short name with green tick, falls back to raw bank name */}
        {(() => {
          const pinned    = tx.counterparty_id ? counterparties.find(cp => cp.id === tx.counterparty_id) ?? null : null;
          const autoMatch = pinned ? null : matchCounterparty(tx.counterparty, counterparties);
          const resolved  = pinned ?? autoMatch;
          return (
            <td className="py-2 px-2 max-w-[160px]">
              {resolved ? (
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-gray-900 truncate">{resolved.name}</span>
                  <span title="Matched counterparty"><CheckCircle2 size={11} className="text-green-500 flex-shrink-0" /></span>
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={() => setShowRaw(v => !v)}
                      title="Show raw bank details"
                      className="text-gray-300 hover:text-gray-500 transition-colors">
                      <Info size={11} />
                    </button>
                    {showRaw && (
                      <div className="absolute left-0 top-5 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2.5 min-w-[200px] max-w-[300px]"
                        onClick={e => e.stopPropagation()}>
                        <p className="text-xs font-semibold text-gray-500 mb-1">Raw bank name</p>
                        <p className="text-xs text-gray-800 break-all">{tx.counterparty || '—'}</p>
                        {tx.description && (
                          <>
                            <p className="text-xs font-semibold text-gray-500 mt-2 mb-1">Description</p>
                            <p className="text-xs text-gray-800 break-all">{tx.description}</p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {pinned && !locked && (
                    <button title="Remove assignment" onClick={() => onSave(tx.id, { counterparty_id: null })}
                      className="text-gray-300 hover:text-red-400 flex-shrink-0">
                      <X size={10} />
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="truncate text-gray-900">{tx.counterparty || '—'}</div>
                  {!locked && (
                    <select value="" onChange={e => e.target.value && onSave(tx.id, { counterparty_id: e.target.value })}
                      className="text-xs text-gray-400 border-0 outline-none cursor-pointer bg-transparent hover:text-gray-700 mt-0.5">
                      <option value="">Assign…</option>
                      {counterparties.map(cp => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
                    </select>
                  )}
                </>
              )}
            </td>
          );
        })()}

        {/* Bill */}
        <td className="py-2 px-2 whitespace-nowrap">
          {tx.bill ? (
            <div className="flex items-center gap-1">
              <button
                title={`${tx.bill.supplier_name}${tx.bill.invoice_number ? ' · ' + tx.bill.invoice_number : ''}`}
                onClick={() => tx.bill?.file_path
                  ? window.open(`/api/bills/${tx.bill.id}/pdf`, '_blank')
                  : setShowModal(true)}
                className="flex items-center justify-center w-6 h-6 rounded-full bg-green-50 border border-green-200 text-green-600 hover:bg-green-100 transition-colors cursor-pointer">
                <CheckCircle2 size={13} />
              </button>
              {!locked && (
                <button title="Unlink bill" onClick={() => {
                  if (window.confirm('Remove bill link from this transaction?')) patch('bill_id', null);
                }}
                  className="text-gray-300 hover:text-red-400 transition-colors">
                  <X size={10} />
                </button>
              )}
            </div>
          ) : (
            <button onClick={() => !locked && setShowModal(true)}
              className={`flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 transition-colors ${locked ? 'cursor-default opacity-50' : 'hover:bg-amber-100 cursor-pointer'}`}>
              <Link2Off size={10} /> No Bill
            </button>
          )}
        </td>

        {/* Brutto */}
        <td className={`py-2 px-2 text-right whitespace-nowrap font-semibold tabular-nums ${isIn ? 'text-green-700' : 'text-red-700'}`}>
          {isIn ? '+' : '−'} {eur(tx.amount_cents)}
        </td>

        {/* VAT %, VAT €, Netto */}
        {(() => {
          const rate     = defaultVatRate(tx.category);
          const vatCents = rate === 0 ? 0 : Math.round(tx.amount_cents * rate / (100 + rate));
          const nettoCents = tx.amount_cents - vatCents;
          return (
            <>
              <td className="py-2 px-2 text-right whitespace-nowrap text-xs text-gray-500 tabular-nums">
                {rate}%
              </td>
              <td className="py-2 px-2 text-right whitespace-nowrap text-xs text-gray-500 tabular-nums">
                {rate === 0 ? '—' : eur(vatCents)}
              </td>
              <td className={`py-2 px-2 text-right whitespace-nowrap text-xs tabular-nums font-medium ${isIn ? 'text-green-700' : 'text-red-700'}`}>
                {isIn ? '+' : '−'} {eur(nettoCents)}
              </td>
            </>
          );
        })()}

        {/* Category — unified for both in and out */}
        <td className="py-2 px-2">
          {locked ? (
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${chipClass}`}>{tx.category}</span>
          ) : (
            <select
              value={tx.category}
              onChange={e => patch('category', e.target.value)}
              className={`text-xs font-medium px-1.5 py-0.5 rounded-full border-0 outline-none cursor-pointer ${chipClass}`}
            >
              <optgroup label="── Cost (C) ──">
                {C_CATEGORIES.map(c => (
                  <option key={c} value={c} style={{ backgroundColor: '#fee2e2', color: '#111' }}>{c}</option>
                ))}
              </optgroup>
              <optgroup label="── Sales (S) ──">
                {S_CATEGORIES.map(c => (
                  <option key={c} value={c} style={{ backgroundColor: '#dcfce7', color: '#111' }}>{c}</option>
                ))}
              </optgroup>
            </select>
          )}
        </td>

        {/* Location */}
        <td className="py-2 px-2">
          {locked ? (
            <span className="text-xs text-gray-600 bg-white border border-gray-200 rounded px-1.5 py-0.5">{tx.location}</span>
          ) : (
            <select value={tx.location} onChange={e => patch('location', e.target.value)}
              className="text-xs bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-700 outline-none cursor-pointer hover:border-gray-400">
              {locations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
        </td>

        {/* Accounting Period */}
        <td className="py-2 px-2 whitespace-nowrap">
          <PeriodPicker
            value={tx.accounting_period}
            onChange={v => patch('accounting_period', v)}
            locked={locked}
          />
        </td>

        {/* Notes */}
        <td className="py-2 px-2 w-full">
          {locked ? (
            <span className="text-xs text-gray-500">{tx.notes || '—'}</span>
          ) : (
            <input type="text" value={notes} onChange={e => onNotesChange(e.target.value)}
              placeholder="Add note…"
              className="w-full text-xs bg-transparent border-b border-dashed border-gray-200 focus:border-gray-400 outline-none py-0.5 text-gray-700 placeholder-gray-300" />
          )}
        </td>

        {/* Confirm */}
        <td className="py-2 px-2">
          <button onClick={() => patch('confirmed', !locked)}
            title={locked ? 'Click to unconfirm and unlock row' : 'Confirm this row'}
            className={`flex items-center justify-center w-7 h-7 rounded-full border-2 transition-all ${
              locked
                ? 'bg-green-600 border-green-600 text-white hover:bg-red-500 hover:border-red-500'
                : 'bg-white border-gray-300 text-gray-300 hover:border-green-500 hover:text-green-500'
            }`}>
            <Check size={13} strokeWidth={3} />
          </button>
        </td>
      </tr>
    </>
  );
}

/* ── Main page ──────────────────────────────────────────────────────── */
export default function CashFlowPage() {
  const qc = useQueryClient();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [periodLabel, setPeriodLabel] = useState('');
  const [uploading, setUploading]     = useState(false);
  const [uploadMsg, setUploadMsg]     = useState('');
  const [showUploadLog, setShowUploadLog]   = useState(false);
  const [downloadingId, setDownloadingId]   = useState<string | null>(null);
  const [showFormatInfo, setShowFormatInfo] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [selectedYear, setSelectedYear]     = useState(2026);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('Q1');
  const availableYears = [2026];
  const quarters: Period[]   = ['Q1','Q2','Q3','Q4'];
  const allMonths: Period[]  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const [dirFilter, setDirFilter]   = useState<'all'|'in'|'out'>('all');
  const [catFilter, setCatFilter]   = useState('All');
  const [locFilter, setLocFilter]   = useState('All');
  const [txPage,    setTxPage]      = useState(1);

  type AutoMatchRow = {
    txId: string; txDate: string; txCounterparty: string; txAmountCents: number;
    billId: string; billSupplier: string; billInvoiceNo: string | null;
    billInvoiceDate: string | null; billGross: number; daysDiff: number;
  };
  const [autoMatching, setAutoMatching]     = useState(false);
  const [autoMatchRows, setAutoMatchRows]   = useState<AutoMatchRow[] | null>(null);
  const [applyingMatch, setApplyingMatch]   = useState(false);

  const handleAutoMatch = async () => {
    setAutoMatching(true);
    try {
      const res  = await fetch('/api/cashflow/auto-match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: false }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Auto-match failed');
      setAutoMatchRows(json.matches);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setAutoMatching(false);
    }
  };

  const handleApplyAutoMatch = async () => {
    if (!autoMatchRows?.length) return;
    setApplyingMatch(true);
    try {
      const res  = await fetch('/api/cashflow/auto-match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Apply failed');
      setAutoMatchRows(null);
      qc.invalidateQueries({ queryKey: ['cashflow-tx'] });
    } catch (err: any) {
      alert(err.message);
    } finally {
      setApplyingMatch(false);
    }
  };

  const { dateFrom, dateTo } = periodDateRange(selectedYear, selectedPeriod);

  const { data: uploads = [] } = useQuery<CfUpload[]>({
    queryKey: ['cashflow-uploads'],
    queryFn: () => fetch('/api/cashflow/uploads').then(r => r.json()),
  });

  const params = new URLSearchParams({ dateFrom, dateTo, page: String(txPage) });
  if (dirFilter !== 'all') params.set('direction', dirFilter);
  if (catFilter !== 'All') params.set('category', catFilter);
  if (locFilter !== 'All') params.set('location', locFilter);

  const { data: txData, isFetching } = useQuery<TxPage>({
    queryKey: ['cashflow-tx', dateFrom, dateTo, dirFilter, catFilter, locFilter, txPage],
    queryFn: () => fetch(`/api/cashflow/transactions?${params}`).then(r => r.json()),
    placeholderData: prev => prev,
  });

  const txs        = txData?.data ?? [];
  const totalCount = txData?.count ?? 0;
  const totalPages = txData ? Math.ceil(txData.count / txData.pageSize) : 1;

  const { data: counterparties = [] } = useQuery<Counterparty[]>({
    queryKey: ['counterparties'],
    queryFn: () => fetch('/api/counterparties').then(r => r.json()),
    staleTime: 60_000,
  });

  const handleSort = (col: string) => {
    setSortCol(prev => {
      if (prev === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return col; }
      setSortDir('desc');
      return col;
    });
  };

  const sortedTxs = useMemo(() => {
    if (!sortCol) return txs;
    return [...txs].sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (sortCol) {
        case 'date':         av = a.date;          bv = b.date;          break;
        case 'counterparty': av = a.counterparty ?? ''; bv = b.counterparty ?? ''; break;
        case 'brutto':       av = a.direction === 'in' ?  a.amount_cents : -a.amount_cents;
                             bv = b.direction === 'in' ?  b.amount_cents : -b.amount_cents; break;
        case 'vatpct':       av = defaultVatRate(a.category); bv = defaultVatRate(b.category); break;
        case 'vateur': {
          const ra = defaultVatRate(a.category), rb = defaultVatRate(b.category);
          av = ra === 0 ? 0 : Math.round(a.amount_cents * ra / (100 + ra));
          bv = rb === 0 ? 0 : Math.round(b.amount_cents * rb / (100 + rb));
          break;
        }
        case 'netto': {
          const ra = defaultVatRate(a.category), rb = defaultVatRate(b.category);
          const va = ra === 0 ? 0 : Math.round(a.amount_cents * ra / (100 + ra));
          const vb = rb === 0 ? 0 : Math.round(b.amount_cents * rb / (100 + rb));
          av = (a.direction === 'in' ? 1 : -1) * (a.amount_cents - va);
          bv = (b.direction === 'in' ? 1 : -1) * (b.amount_cents - vb);
          break;
        }
        case 'category':          av = a.category          ?? ''; bv = b.category          ?? ''; break;
        case 'location':          av = a.location           ?? ''; bv = b.location           ?? ''; break;
        case 'accounting_period': av = a.accounting_period  ?? ''; bv = b.accounting_period  ?? ''; break;
        default:         av = 0; bv = 0;
      }
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [txs, sortCol, sortDir]);

  type AggRow = { category: string | null; direction: 'in' | 'out'; total_cents: number };
  const { data: aggRows = [] } = useQuery<AggRow[]>({
    queryKey: ['cashflow-agg', dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/cashflow/aggregate?dateFrom=${dateFrom}&dateTo=${dateTo}`);
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    },
  });
  const totalIn  = aggRows.filter(t => t.direction === 'in').reduce((s,t) => s + t.total_cents, 0);
  const totalOut = aggRows.filter(t => t.direction === 'out').reduce((s,t) => s + t.total_cents, 0);
  const net      = totalIn - totalOut;

  // P&L buckets — signed: incoming = +, outgoing = −
  const signed = (t: AggRow) => t.direction === 'in' ? t.total_cents : -t.total_cents;
  const catNetSum = (cat: string) =>
    aggRows.filter(t => t.category === cat).reduce((s: number, t: AggRow) => s + signed(t), 0);
  const plSales     = aggRows.filter(t => (t.category ?? '').startsWith('S - ')).reduce((s: number, t: AggRow) => s + signed(t), 0);
  const plCogs      = catNetSum('C - Suppliers');
  const plStaff     = catNetSum('C - Personnel');
  const plRent      = catNetSum('C - Rent');
  const plFinancing = catNetSum('C - Financing');
  const plOther     = aggRows.filter(t =>
    (t.category ?? '').startsWith('C - ') &&
    !['C - Suppliers', 'C - Personnel', 'C - Rent', 'C - Financing'].includes(t.category ?? '')
  ).reduce((s: number, t: AggRow) => s + signed(t), 0);
  const plFcf          = plSales + plCogs + plStaff + plRent + plOther;
  const plChangeInCash = plFcf + plFinancing;
  const checkOk = Math.abs(plChangeInCash - net) < 1;

  // VAT breakdowns — summed from individual category rows, not applied as a flat rate to the bucket total
  const salesVatRows  = aggRows.filter(t => (t.category ?? '').startsWith('S - '));
  const cogsVatRows   = aggRows.filter(t => t.category === 'C - Suppliers');
  const staffVatRows  = aggRows.filter(t => t.category === 'C - Personnel');
  const rentVatRows   = aggRows.filter(t => t.category === 'C - Rent');
  const otherVatRows  = aggRows.filter(t =>
    (t.category ?? '').startsWith('C - ') &&
    !['C - Suppliers', 'C - Personnel', 'C - Rent', 'C - Financing'].includes(t.category ?? ''),
  );
  const salesVat  = bucketVat(salesVatRows);
  const cogsVat   = bucketVat(cogsVatRows);
  const staffVat  = bucketVat(staffVatRows);
  const rentVat   = bucketVat(rentVatRows);
  const otherVat  = bucketVat(otherVatRows);

  const patchMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, string | boolean | null> }) =>
      fetch(`/api/cashflow/transactions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: (_data, { id, patch }) => {
      // Update the row in-place across all cached transaction pages — no refetch, no reshuffling
      qc.setQueriesData<TxPage>(
        { queryKey: ['cashflow-tx'] },
        old => old ? { ...old, data: old.data.map(tx => tx.id === id ? { ...tx, ...patch } as CfTx : tx) } : old,
      );
      // Recalculate P&L totals since category/direction may have changed
      qc.invalidateQueries({ queryKey: ['cashflow-agg'] });
    },
  });

  const handleSave = useCallback((id: string, patch: Record<string, string | boolean | null>) => {
    patchMut.mutate({ id, patch });
  }, [patchMut]);

  const handleUpload = async (file: File) => {
    if (!periodLabel.trim()) { alert('Please enter a period label first (e.g. Q1-2026).'); return; }
    setUploading(true); setUploadMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('periodLabel', periodLabel.trim());
      const res  = await fetch('/api/cashflow/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Upload failed');
      setUploadMsg(`✓ ${json.count} transactions imported`);
      qc.invalidateQueries({ queryKey: ['cashflow-uploads'] });
      qc.invalidateQueries({ queryKey: ['cashflow-tx'] });
      qc.invalidateQueries({ queryKey: ['cashflow-agg'] });
    } catch (err: unknown) {
      setUploadMsg(`Error: ${err instanceof Error ? err.message : 'Upload error'}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const resetFilters = () => { setDirFilter('all'); setCatFilter('All'); setLocFilter('All'); setTxPage(1); };

  const handleDownload = async (upload: CfUpload) => {
    if (!upload.file_path) { alert('Original file was not saved for this upload.'); return; }
    setDownloadingId(upload.id);
    try {
      const res  = await fetch(`/api/cashflow/uploads/${upload.id}/file`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Download failed');
      const a = document.createElement('a');
      a.href = json.url;
      a.download = json.filename ?? upload.filename;
      a.click();
    } catch (err) {
      alert(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDownloadingId(null);
    }
  };

  const activeQuarterMonths: Period[] = selectedPeriod in QUARTER_PERIODS
    ? QUARTER_PERIODS[selectedPeriod]
    : (Object.entries(QUARTER_PERIODS).find(([, ms]) => ms.includes(selectedPeriod as Period))?.[1] ?? []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cash Flow</h1>
          <p className="text-sm text-gray-500 mt-0.5">Bank account transactions — classify and allocate</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="text" value={periodLabel} onChange={e => setPeriodLabel(e.target.value)}
            placeholder="Period label (e.g. Q1-2026)"
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 w-48 outline-none focus:border-[#1B5E20]" />
          <div className="relative">
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white text-sm font-semibold rounded-lg hover:bg-[#2E7D32] disabled:opacity-60 transition-colors">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? 'Importing…' : 'Upload CSV'}
            </button>
          </div>
          <button onClick={() => setShowFormatInfo(v => !v)}
            className={`p-2 rounded-lg border transition-colors ${showFormatInfo ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-gray-200 text-gray-400 hover:text-gray-600'}`}
            title="Required CSV format">
            <Info size={15} />
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
          {uploadMsg && (
            <span className={`text-sm font-medium ${uploadMsg.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>{uploadMsg}</span>
          )}
        </div>
      </div>

      {/* CSV format info panel */}
      {showFormatInfo && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-5 py-4 text-sm">
          <p className="font-semibold text-indigo-900 mb-2">Required CSV format</p>
          <p className="text-indigo-700 mb-3">The file must have exactly these 5 columns (semicolon-separated, as exported by German banks):</p>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-full max-w-2xl">
              <thead>
                <tr className="bg-indigo-100">
                  <th className="border border-indigo-200 px-3 py-1.5 text-left font-semibold text-indigo-800">#</th>
                  <th className="border border-indigo-200 px-3 py-1.5 text-left font-semibold text-indigo-800">Column name</th>
                  <th className="border border-indigo-200 px-3 py-1.5 text-left font-semibold text-indigo-800">Format</th>
                  <th className="border border-indigo-200 px-3 py-1.5 text-left font-semibold text-indigo-800">Example</th>
                </tr>
              </thead>
              <tbody className="text-indigo-700">
                {[
                  ['1', 'Buchungstag', 'DD/MM/YYYY or DD.MM.YYYY', '30/06/2026'],
                  ['2', 'Verwendungszweck', 'Free text (purpose)', 'Abschlag fuer 06/2026'],
                  ['3', 'Kundenreferenz (End-to-End)', 'Reference number or blank', '165196'],
                  ['4', 'Beguenstigter/Zahlungspflichtiger', 'Counterparty name', 'Pham, Giang Houng'],
                  ['5', 'Betrag', 'Integer cents (e.g. -80000) or German decimal euros (e.g. -800,00)', '-80000'],
                ].map(([n, col, fmt, ex]) => (
                  <tr key={n} className="even:bg-indigo-50/50">
                    <td className="border border-indigo-200 px-3 py-1.5 font-mono text-indigo-500">{n}</td>
                    <td className="border border-indigo-200 px-3 py-1.5 font-semibold">{col}</td>
                    <td className="border border-indigo-200 px-3 py-1.5">{fmt}</td>
                    <td className="border border-indigo-200 px-3 py-1.5 font-mono">{ex}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-indigo-600 text-xs mt-3">Delimiter is auto-detected (semicolon or comma). Rows with unparseable dates or amounts are skipped silently — if 0 rows import, check the Upload Log for the count.</p>
        </div>
      )}

      {/* Year + Period navigation */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide w-12">Year</span>
          <div className="flex gap-2">
            {availableYears.map(y => (
              <button key={y} onClick={() => { setSelectedYear(y); resetFilters(); }}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
                  selectedYear === y ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                }`}>{y}</button>
            ))}
          </div>
        </div>
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide w-12 pt-1.5">Period</span>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 flex-wrap">
              {quarters.map(q => (
                <button key={q} onClick={() => { setSelectedPeriod(q); resetFilters(); }}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                    selectedPeriod === q ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                  }`}>{q}</button>
              ))}
              <div className="w-px bg-gray-200 self-stretch mx-1" />
              {(['H1','H2'] as Period[]).map(h => (
                <button key={h} onClick={() => { setSelectedPeriod(h); resetFilters(); }}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                    selectedPeriod === h ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                  }`}>{h}</button>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {allMonths.map(m => {
                const isSel = selectedPeriod === m;
                const inQ   = activeQuarterMonths.includes(m);
                return (
                  <button key={m} onClick={() => { setSelectedPeriod(m); resetFilters(); }}
                    className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      isSel ? 'bg-[#2E7D32] text-white border-[#2E7D32]'
                      : inQ  ? 'bg-green-50 text-green-800 border-green-200 hover:border-green-400'
                             : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                    }`}>{m}</button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Auto-match preview modal */}
      {autoMatchRows !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Auto-match Preview</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {autoMatchRows.length === 0
                    ? 'No matches found — all transactions already linked or no amount/date match in bills.'
                    : `${autoMatchRows.length} bill${autoMatchRows.length !== 1 ? 's' : ''} matched by amount + supplier + date (≤45 days). Review then apply.`}
                </p>
              </div>
              <button onClick={() => setAutoMatchRows(null)} className="text-gray-400 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>
            {autoMatchRows.length > 0 && (
              <div className="overflow-y-auto flex-1">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide">Tx Date</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide">Counterparty</th>
                      <th className="text-right px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide">→ Bill Supplier</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide">Invoice #</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide">Invoice Date</th>
                      <th className="text-right px-4 py-2.5 font-semibold text-gray-500 uppercase tracking-wide">Δ Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {autoMatchRows.map(r => (
                      <tr key={r.txId} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-600">{r.txDate}</td>
                        <td className="px-4 py-2 text-gray-700 font-medium max-w-[160px] truncate">{r.txCounterparty}</td>
                        <td className="px-4 py-2 text-right font-semibold text-red-600 tabular-nums">
                          {(Math.abs(r.txAmountCents) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
                        </td>
                        <td className="px-4 py-2 text-gray-700 font-medium">{r.billSupplier}</td>
                        <td className="px-4 py-2 text-gray-500">{r.billInvoiceNo ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-500">{r.billInvoiceDate ?? '—'}</td>
                        <td className={`px-4 py-2 text-right tabular-nums font-medium ${r.daysDiff <= 7 ? 'text-green-600' : r.daysDiff <= 20 ? 'text-amber-600' : 'text-orange-600'}`}>
                          {r.daysDiff}d
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setAutoMatchRows(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              {autoMatchRows.length > 0 && (
                <button onClick={handleApplyAutoMatch} disabled={applyingMatch}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-bold bg-[#1B5E20] text-white rounded-lg hover:bg-[#2E7D32] transition-colors disabled:opacity-50">
                  {applyingMatch ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {applyingMatch ? 'Applying…' : `Apply ${autoMatchRows.length} match${autoMatchRows.length !== 1 ? 'es' : ''}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload Log */}
      {uploads.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <button
            onClick={() => setShowUploadLog(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-2">
              <FileText size={15} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">Upload Log</span>
              <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{uploads.length}</span>
            </div>
            {showUploadLog ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
          </button>

          {showUploadLog && (
            <div className="border-t border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Period</th>
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Filename</th>
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Uploaded</th>
                    <th className="text-right px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Rows</th>
                    <th className="px-5 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.map(u => (
                    <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors last:border-0">
                      <td className="px-5 py-2.5">
                        <span className="font-mono text-xs bg-green-50 text-green-800 px-2 py-0.5 rounded-full border border-green-200">{u.period_label}</span>
                      </td>
                      <td className="px-5 py-2.5 text-gray-600 text-xs truncate max-w-48">{u.filename}</td>
                      <td className="px-5 py-2.5 text-gray-500 text-xs">
                        {new Date(u.uploaded_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-sm font-semibold text-gray-800">
                        {u.transaction_count.toLocaleString('de-DE')}
                        {u.transaction_count === 0 && <span className="ml-2 text-xs text-amber-600 font-normal">(parse error?)</span>}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {u.file_path ? (
                          <button
                            onClick={() => handleDownload(u)}
                            disabled={downloadingId === u.id}
                            className="flex items-center gap-1.5 ml-auto text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50 transition-colors">
                            {downloadingId === u.id
                              ? <Loader2 size={12} className="animate-spin" />
                              : <Download size={12} />}
                            Download
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {uploads.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <Upload size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No data yet</p>
          <p className="text-gray-400 text-sm mt-1">Enter a period label and upload your bank CSV file to get started.</p>
        </div>
      )}

      {uploads.length > 0 && (
        <>
          {/* P&L summary table */}
          {(() => {
            const salesAbs = Math.abs(plSales);
            const pctSales = (v: number) =>
              salesAbs > 0
                ? (Math.abs(v) / salesAbs * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + '%'
                : '—';
            const fmtPct = (p: number, hasData: boolean) =>
              !hasData ? '—' : p.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + '%';

            const valCell = (v: number, bold = false, large = false) => (
              <td className={`px-5 py-3 text-right tabular-nums ${bold ? 'font-bold' : 'font-semibold'} ${large ? 'text-base' : ''} ${v >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {v < 0 ? '– ' : ''}{eur(Math.abs(v))}
              </td>
            );
            const euroCell = (cents: number) => (
              <td className="px-4 py-3 text-right tabular-nums text-gray-600 text-xs">{eur(cents)}</td>
            );
            const dashCell = () => (
              <td className="px-4 py-3 text-right text-gray-300 text-xs">—</td>
            );
            const pctRow = (label: string, val: number) => (
              <tr className="bg-gray-50/60 border-b border-gray-100">
                <td className="px-5 py-1.5 text-xs text-gray-400 italic pl-9">{label}</td>
                {dashCell()}{dashCell()}{dashCell()}{dashCell()}
                <td className="px-5 py-1.5 text-right text-xs tabular-nums text-gray-500 font-medium">{pctSales(val)}</td>
              </tr>
            );

            return (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">Row</th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Brutto Sales (€)</th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">MwSt (€)</th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">MwSt (%)</th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Netto Sales (€)</th>
                        <th className="text-right px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Value (€)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Sales */}
                      <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-gray-700">Sales</td>
                        {euroCell(salesVat.bruttoAbs)}
                        {euroCell(salesVat.mwstAbs)}
                        <td className="px-4 py-3 text-right tabular-nums text-gray-500 text-xs">{fmtPct(salesVat.blendedPct, salesVat.bruttoAbs > 0)}</td>
                        {euroCell(salesVat.nettoAbs)}
                        {valCell(plSales)}
                      </tr>

                      {/* COGS */}
                      <tr className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-gray-700">COGS</td>
                        {euroCell(cogsVat.bruttoAbs)}
                        {euroCell(cogsVat.mwstAbs)}
                        <td className="px-4 py-3 text-right tabular-nums text-gray-500 text-xs">{fmtPct(cogsVat.blendedPct, cogsVat.bruttoAbs > 0)}</td>
                        {euroCell(cogsVat.nettoAbs)}
                        {valCell(plCogs)}
                      </tr>
                      {pctRow('as % of sales', plCogs)}

                      {/* Staff */}
                      <tr className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-gray-700">Staff</td>
                        {euroCell(staffVat.bruttoAbs)}
                        {euroCell(staffVat.mwstAbs)}
                        <td className="px-4 py-3 text-right tabular-nums text-gray-500 text-xs">{fmtPct(staffVat.blendedPct, staffVat.bruttoAbs > 0)}</td>
                        {euroCell(staffVat.nettoAbs)}
                        {valCell(plStaff)}
                      </tr>
                      {pctRow('as % of sales', plStaff)}

                      {/* Rent */}
                      <tr className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-gray-700">Rent</td>
                        {euroCell(rentVat.bruttoAbs)}
                        {euroCell(rentVat.mwstAbs)}
                        <td className="px-4 py-3 text-right tabular-nums text-gray-500 text-xs">{fmtPct(rentVat.blendedPct, rentVat.bruttoAbs > 0)}</td>
                        {euroCell(rentVat.nettoAbs)}
                        {valCell(plRent)}
                      </tr>
                      {pctRow('as % of sales', plRent)}

                      {/* Other */}
                      <tr className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-gray-700">Other</td>
                        {euroCell(otherVat.bruttoAbs)}
                        {euroCell(otherVat.mwstAbs)}
                        <td className="px-4 py-3 text-right tabular-nums text-gray-500 text-xs">{fmtPct(otherVat.blendedPct, otherVat.bruttoAbs > 0)}</td>
                        {euroCell(otherVat.nettoAbs)}
                        {valCell(plOther)}
                      </tr>
                      {pctRow('as % of sales', plOther)}

                      {/* FCF */}
                      <tr className="bg-gray-50 border-t-2 border-gray-200">
                        <td className="px-5 py-3.5 font-bold text-gray-900">FCF</td>
                        {dashCell()}{dashCell()}{dashCell()}{dashCell()}
                        {valCell(plFcf, true, true)}
                      </tr>
                      {pctRow('as % of sales', plFcf)}

                      {/* Financing */}
                      <tr className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-gray-700">Financing</td>
                        {dashCell()}{dashCell()}{dashCell()}{dashCell()}
                        {valCell(plFinancing)}
                      </tr>

                      {/* Change in Cash */}
                      <tr className="bg-gray-50 border-t-2 border-gray-200">
                        <td className="px-5 py-3.5 font-bold text-gray-900">
                          <span className="flex items-center gap-2">
                            Change in Cash
                            {checkOk
                              ? <CheckCircle2 size={15} className="text-green-600 flex-shrink-0" />
                              : <XCircle size={15} className="text-red-500 flex-shrink-0" />}
                          </span>
                        </td>
                        {dashCell()}{dashCell()}{dashCell()}{dashCell()}
                        {valCell(plChangeInCash, true, true)}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* Filter bar */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              {(['all','in','out'] as const).map(d => (
                <button key={d} onClick={() => { setDirFilter(d); setTxPage(1); }}
                  className={`px-3 py-1.5 font-medium capitalize transition-colors ${dirFilter === d ? 'bg-[#1B5E20] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {d === 'all' ? 'All' : d === 'in' ? 'Incoming' : 'Outgoing'}
                </button>
              ))}
            </div>

            <select value={catFilter} onChange={e => { setCatFilter(e.target.value); setTxPage(1); }}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-gray-400">
              <option value="All">All categories</option>
              <optgroup label="── Cost (C) ──">
                {C_CATEGORIES.map(c => <option key={c} value={c} style={{ backgroundColor: '#fee2e2' }}>{c}</option>)}
              </optgroup>
              <optgroup label="── Sales (S) ──">
                {S_CATEGORIES.map(c => <option key={c} value={c} style={{ backgroundColor: '#dcfce7' }}>{c}</option>)}
              </optgroup>
            </select>

            <select value={locFilter} onChange={e => { setLocFilter(e.target.value); setTxPage(1); }}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-gray-400">
              <option value="All">All locations</option>
              {[...new Set([...OUT_LOCATIONS, ...IN_LOCATIONS])].map(l => <option key={l} value={l}>{l}</option>)}
            </select>

            <span className="ml-auto text-xs text-gray-400">{totalCount} transactions</span>

            <button
              onClick={handleAutoMatch}
              disabled={autoMatching}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 rounded-lg bg-indigo-50 hover:bg-indigo-100 transition-colors disabled:opacity-50"
            >
              {autoMatching ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
              {autoMatching ? 'Scanning…' : 'Auto-match bills'}
            </button>
          </div>

          {/* Pagination — top */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-white rounded-xl border border-gray-100 shadow-sm">
              <span className="text-xs text-gray-500">Page {txPage} of {totalPages} · {totalCount.toLocaleString('de-DE')} transactions</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setTxPage(p => Math.max(1, p - 1))} disabled={txPage === 1 || isFetching}
                  className="flex items-center gap-1 px-3 py-1 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">
                  <ChevronUp size={12} className="rotate-[-90deg]" /> Previous
                </button>
                <div className="flex gap-1">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    const p = totalPages <= 7 ? i + 1 : txPage <= 4 ? i + 1 : txPage >= totalPages - 3 ? totalPages - 6 + i : txPage - 3 + i;
                    return <button key={p} onClick={() => setTxPage(p)} className={`w-7 h-7 text-xs rounded-lg font-medium transition-colors ${p === txPage ? 'bg-[#1B5E20] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{p}</button>;
                  })}
                </div>
                <button onClick={() => setTxPage(p => Math.min(totalPages, p + 1))} disabled={txPage === totalPages || isFetching}
                  className="flex items-center gap-1 px-3 py-1 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">
                  Next <ChevronDown size={12} className="rotate-[-90deg]" />
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {isFetching && (
              <div className="flex items-center justify-center py-8 text-gray-400 gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading…
              </div>
            )}
            {!isFetching && txs.length === 0 && (
              <div className="py-12 text-center text-gray-400 text-sm">No transactions for this period.</div>
            )}
            {txs.length > 0 && (
              <div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {([
                        { col: 'date',        label: 'Date',        align: 'left'  },
                        { col: 'counterparty',label: 'Counterparty',align: 'left'  },
                      ] as { col: string; label: string; align: 'left' | 'right' }[]).map(({ col, label, align }) => {
                        const active = sortCol === col;
                        return (
                          <th key={col}
                            onClick={() => handleSort(col)}
                            className={`py-2.5 px-2 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors whitespace-nowrap
                              ${align === 'right' ? 'text-right' : 'text-left'}
                              ${active ? 'text-[#1B5E20]' : 'text-gray-500 hover:text-gray-800'}`}>
                            <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
                              {label}
                              <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-25'}`}>
                                {active && sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                              </span>
                            </span>
                          </th>
                        );
                      })}
                      <th className="py-2.5 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">Bill</th>
                      {([
                        { col: 'brutto',   label: 'Brutto',   align: 'right' },
                        { col: 'vatpct',   label: 'VAT %',    align: 'right' },
                        { col: 'vateur',   label: 'VAT €',    align: 'right' },
                        { col: 'netto',    label: 'Netto',    align: 'right' },
                        { col: 'category',          label: 'Category', align: 'left'  },
                        { col: 'location',          label: 'Location', align: 'left'  },
                        { col: 'accounting_period', label: 'Period',   align: 'left'  },
                      ] as { col: string; label: string; align: 'left' | 'right' }[]).map(({ col, label, align }) => {
                        const active = sortCol === col;
                        return (
                          <th key={col}
                            onClick={() => handleSort(col)}
                            className={`py-2.5 px-2 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors whitespace-nowrap
                              ${align === 'right' ? 'text-right' : 'text-left'}
                              ${active ? 'text-[#1B5E20]' : 'text-gray-500 hover:text-gray-800'}`}>
                            <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
                              {label}
                              <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-25'}`}>
                                {active && sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                              </span>
                            </span>
                          </th>
                        );
                      })}
                      <th className="py-2.5 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">Notes</th>
                      <th className="py-2.5 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">Confirm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTxs.map(tx => <TxRow key={tx.id} tx={tx} onSave={handleSave} counterparties={counterparties} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-gray-100 shadow-sm">
              <span className="text-xs text-gray-500">
                Page {txPage} of {totalPages} · {totalCount.toLocaleString('de-DE')} transactions
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTxPage(p => Math.max(1, p - 1))}
                  disabled={txPage === 1 || isFetching}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
                >
                  <ChevronUp size={12} className="rotate-[-90deg]" /> Previous
                </button>
                <div className="flex gap-1">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    const p = totalPages <= 7 ? i + 1
                      : txPage <= 4 ? i + 1
                      : txPage >= totalPages - 3 ? totalPages - 6 + i
                      : txPage - 3 + i;
                    return (
                      <button key={p} onClick={() => setTxPage(p)}
                        className={`w-7 h-7 text-xs rounded-lg font-medium transition-colors ${p === txPage ? 'bg-[#1B5E20] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                        {p}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setTxPage(p => Math.min(totalPages, p + 1))}
                  disabled={txPage === totalPages || isFetching}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
                >
                  Next <ChevronDown size={12} className="rotate-[-90deg]" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
