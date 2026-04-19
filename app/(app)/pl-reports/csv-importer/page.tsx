'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Upload, FileCheck, AlertCircle, DatabaseZap,
  History, MapPin, Trash2, ChevronLeft, ChevronRight,
  TrendingUp, Receipt, Percent, Euro,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────
type Location = { id: string; name: string };

type ProductRow = {
  item_name:        string;
  category:         string | null;
  quantity:         number;
  unit_price:       number;
  total_price:      number;
  inhouse_revenue:  number;
  takeaway_revenue: number;
};

type Summary = {
  weekStart:       string | null;
  weekEnd:         string | null;
  grossTotal:      number;
  grossFood:       number;
  grossDrinks:     number;
  netTotal:        number;
  taxTotal:        number;
  tips:            number;
  inhouseTotal:    number;
  takeawayTotal:   number;
};

type ParseResult = {
  rows:            ProductRow[];
  summary:         Summary | null;
  categoryRevenue: Record<string, number>;
  error?:          string;
};

type ImportRecord = {
  id:               string;
  created_at:       string;
  file_name:        string;
  week_start:       string | null;
  week_end:         string | null;
  row_count:        number;
  total_revenue:    number;
  location_name:    string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseNum(s: string): number {
  if (!s) return 0;
  const c = s.trim().replace(/[€$\s%]/g, '');
  if (!c) return 0;
  // German format: 1.234,56  →  remove dots, swap comma
  if (c.includes(',') && c.includes('.')) return parseFloat(c.replace(/\./g, '').replace(',', '.')) || 0;
  if (c.includes(',')) return parseFloat(c.replace(',', '.')) || 0;
  return parseFloat(c) || 0;
}

function parseDate(s: string): string | null {
  if (!s) return null;
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (de) return `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return null;
}

// ── Orderbird Z-report parser ─────────────────────────────────────────────────
const SECTION_NAMES = new Set([
  'turnover', 'gross turnover', 'net turnover', 'taxes',
  'types of payment', 'taxes by payment method', 'revenue breakdown',
  'cancellations', 'discounts', 'tables', 'guests',
  'main categories', 'categories', 'products',
]);

function parseCSV(raw: string): ParseResult {
  const content = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines   = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  if (lines.length < 5) return { rows: [], summary: null, categoryRevenue: {}, error: 'File appears to be empty.' };

  const split = (line: string) => line.split(';').map((v) => v.replace(/^"|"$/g, '').trim());

  // Detect date range — row like: "Date:;13.04.2026;19.04.2026;;"
  let weekStart: string | null = null;
  let weekEnd:   string | null = null;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const cols = split(lines[i]);
    if (cols[0].toLowerCase().startsWith('date')) {
      weekStart = parseDate(cols[1] ?? '');
      weekEnd   = parseDate(cols[2] ?? '');
      break;
    }
  }

  // State machine
  let section = '';
  const rows: ProductRow[]              = [];
  const categoryRevenue: Record<string, number> = {};

  let grossFood = 0, grossDrinks = 0, grossTotal = 0;
  let netTotal  = 0, taxTotal    = 0, tips       = 0;
  let inhouseTotal = 0, takeawayTotal = 0;
  let inhouseSet = false;

  for (const line of lines) {
    const cols  = split(line);
    const first = cols[0].toLowerCase();

    // Empty line → end of section
    if (cols.every((c) => c === '')) { section = ''; continue; }

    // Section header detection
    if (SECTION_NAMES.has(first)) { section = first; continue; }

    // Skip meta rows
    if (first === 'date:' || first.startsWith(';') || first === 'z report:') continue;
    if (first === 'total') continue;   // summary totals already captured from named rows

    switch (section) {
      case 'turnover':
        if (first === 'tip') tips = parseNum(cols[3]);
        break;

      case 'gross turnover':
        if (first.startsWith('7.')) { grossFood   = parseNum(cols[3]); }
        else if (first.startsWith('19.')) { grossDrinks = parseNum(cols[3]); }
        else if (first === 'total') { grossTotal  = parseNum(cols[3]); }
        break;

      case 'net turnover':
        if (first === 'total') netTotal = parseNum(cols[3]);
        break;

      case 'taxes':
        if (first === 'total') taxTotal = parseNum(cols[3]);
        break;

      case 'main categories':
        // cols: name;;count;total;%;;inhouse_count;inhouse_total;;takeaway_count;takeaway_total
        if (cols[0] && !inhouseSet) {
          inhouseTotal  += parseNum(cols[7]);
          takeawayTotal += parseNum(cols[10]);
        }
        break;

      case 'categories':
        // Store every non-empty category with revenue > 0
        if (cols[0] && parseNum(cols[3]) > 0) {
          categoryRevenue[cols[0]] = parseNum(cols[3]);
        }
        break;

      case 'products':
        // cols: name;PLU;count;total;%;;inhouse_count;inhouse_total;;takeaway_count;takeaway_total
        if (!cols[0]) break;
        const count    = parseNum(cols[2]);
        const total    = parseNum(cols[3]);
        const inhouse  = parseNum(cols[7]);
        const takeaway = parseNum(cols[10]);
        if (cols[0] && (total > 0 || count > 0)) {
          rows.push({
            item_name:        cols[0],
            category:         null,
            quantity:         count,
            unit_price:       count > 0 ? Math.round((total / count) * 100) / 100 : 0,
            total_price:      total,
            inhouse_revenue:  inhouse,
            takeaway_revenue: takeaway,
          });
        }
        break;
    }
  }

  // If main categories was parsed, mark done to avoid double-counting
  inhouseSet = true;

  if (rows.length === 0 && grossTotal === 0) {
    return {
      rows: [],
      summary: null,
      categoryRevenue: {},
      error: 'Could not parse this file as an Orderbird Z-report. Please export via MY orderbird → Reports → Z-Report → Export CSV.',
    };
  }

  // Fallback: derive inhouse/takeaway from product rows if main categories was empty
  if (inhouseTotal === 0 && takeawayTotal === 0 && rows.length > 0) {
    inhouseTotal  = rows.reduce((s, r) => s + r.inhouse_revenue,  0);
    takeawayTotal = rows.reduce((s, r) => s + r.takeaway_revenue, 0);
  }

  // Fallback for grossTotal if not found
  if (grossTotal === 0) grossTotal = grossFood + grossDrinks;

  const summary: Summary = {
    weekStart, weekEnd,
    grossTotal, grossFood, grossDrinks,
    netTotal, taxTotal, tips,
    inhouseTotal, takeawayTotal,
  };

  return { rows, summary, categoryRevenue };
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);

const fmtDate = (d: string | null) =>
  d
    ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

const PAGE_SIZE = 30;

// ── Page component ────────────────────────────────────────────────────────────
export default function CSVImporterPage() {
  const queryClient = useQueryClient();
  const [tab, setTab]               = useState<'upload' | 'history'>('upload');
  const [location, setLocation]     = useState<Location | null>(null);
  const [fileName, setFileName]     = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting]   = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [page, setPage]             = useState(0);
  const fileInputRef                = useRef<HTMLInputElement>(null);

  const parsed  = parseResult?.rows    ?? null;
  const summary = parseResult?.summary ?? null;
  const catRevenue = parseResult?.categoryRevenue ?? {};

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: locations = [] } = useQuery({
    queryKey: ['locations-active'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').eq('is_active', true).order('name');
      return (data ?? []) as Location[];
    },
  });

  const { data: history = [], isLoading: histLoading } = useQuery({
    queryKey: ['sales-imports'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sales_imports')
        .select('id, created_at, file_name, week_start, week_end, row_count, total_revenue, locations(name)')
        .order('created_at', { ascending: false });
      return (data ?? []).map((r: any) => ({
        id:            r.id,
        created_at:    r.created_at,
        file_name:     r.file_name,
        week_start:    r.week_start,
        week_end:      r.week_end,
        row_count:     r.row_count,
        total_revenue: r.total_revenue,
        location_name: r.locations?.name ?? '—',
      })) as ImportRecord[];
    },
  });

  // ── Top categories (sorted) ───────────────────────────────────────────────
  const topCats = useMemo(() =>
    Object.entries(catRevenue)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12),
    [catRevenue]
  );

  // ── Top products ─────────────────────────────────────────────────────────
  const topProducts = useMemo(() =>
    parsed ? [...parsed].sort((a, b) => b.total_price - a.total_price).slice(0, 10) : [],
    [parsed]
  );

  // ── File handling ─────────────────────────────────────────────────────────
  const processFile = useCallback((file: File) => {
    setFileName(file.name);
    setParseResult(null);
    setParseError(null);
    setPage(0);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const result  = parseCSV(content ?? '');
      if (result.error) { setParseError(result.error); return; }
      setParseResult(result);
    };
    reader.readAsText(file, 'UTF-8');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    if (!location || !parsed || !summary) return;
    setImporting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: imp, error: impErr } = await supabase
        .from('sales_imports')
        .insert({
          location_id:      location.id,
          file_name:        fileName ?? 'unknown.csv',
          week_start:       summary.weekStart,
          week_end:         summary.weekEnd,
          row_count:        parsed.length,
          total_revenue:    summary.grossTotal,
          net_revenue:      summary.netTotal,
          tax_total:        summary.taxTotal,
          tips:             summary.tips,
          gross_food:       summary.grossFood,
          gross_drinks:     summary.grossDrinks,
          inhouse_revenue:  summary.inhouseTotal,
          takeaway_revenue: summary.takeawayTotal,
          imported_by:      user?.id ?? null,
        })
        .select('id').single();
      if (impErr) throw impErr;

      // Insert product lines in batches of 200
      for (let i = 0; i < parsed.length; i += 200) {
        const chunk = parsed.slice(i, i + 200).map((r) => ({
          import_id:        imp.id,
          item_name:        r.item_name,
          category:         r.category,
          quantity:         r.quantity,
          unit_price:       r.unit_price,
          total_price:      r.total_price,
          inhouse_revenue:  r.inhouse_revenue,
          takeaway_revenue: r.takeaway_revenue,
        }));
        const { error } = await supabase.from('sales_import_lines').insert(chunk);
        if (error) throw error;
      }

      queryClient.invalidateQueries({ queryKey: ['sales-imports'] });
      setParseResult(null); setFileName(null); setPage(0);
      setTab('history');
    } catch (e: any) {
      alert(`Import failed: ${e.message}`);
    } finally {
      setImporting(false);
    }
  }, [location, parsed, fileName, summary, queryClient]);

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteImport = useCallback(async (id: string) => {
    if (!confirm('Delete this import and all its lines?')) return;
    await supabase.from('sales_imports').delete().eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['sales-imports'] });
  }, [queryClient]);

  const pageRows   = parsed?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [];
  const totalPages = parsed ? Math.ceil(parsed.length / PAGE_SIZE) : 0;
  const canImport  = !!location && !!parsed && parsed.length > 0 && !importing;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">CSV Importer</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload weekly Orderbird Z-report exports</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {(['upload', 'history'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 transition-colors capitalize ${
                tab === t
                  ? 'border-[#1B5E20] text-[#1B5E20]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'upload' ? <Upload size={15} /> : <History size={15} />}
              {t}
              {t === 'history' && history.length > 0 && (
                <span className="bg-gray-100 text-gray-600 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {history.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ═══════ UPLOAD TAB ═══════ */}
      {tab === 'upload' && (
        <div className="flex gap-6 items-start">

          {/* ── Left panel ── */}
          <div className="w-80 flex-shrink-0 space-y-5">

            {/* Location */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Location</label>
              <div className="flex flex-wrap gap-2">
                {locations.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLocation(l)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      location?.id === l.id
                        ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20] hover:text-[#1B5E20]'
                    }`}
                  >
                    <MapPin size={12} />
                    {l.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Drop zone */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Orderbird Z-Report CSV</label>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                  isDragging
                    ? 'border-[#1B5E20] bg-green-50'
                    : fileName && !parseError
                    ? 'border-green-400 bg-green-50'
                    : parseError
                    ? 'border-red-300 bg-red-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                {fileName && !parseError
                  ? <FileCheck className="mx-auto mb-2 text-green-600" size={32} />
                  : <Upload className="mx-auto mb-2 text-gray-400" size={32} />
                }
                <p className={`text-sm font-semibold mb-1 ${fileName && !parseError ? 'text-green-700' : 'text-gray-600'}`}>
                  {fileName ?? 'Drop CSV here'}
                </p>
                <p className="text-xs text-gray-400 mb-3">
                  {parsed ? `${parsed.length} products parsed` : 'or click to browse'}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="hidden"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }}
                />
                <span className="px-4 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors inline-block">
                  {fileName ? 'Replace file' : 'Browse files'}
                </span>
              </div>

              {parseError && (
                <div className="mt-2 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{parseError}</p>
                </div>
              )}
            </div>

            {/* ── Import button (always visible after file is loaded) ── */}
            <button
              onClick={handleImport}
              disabled={!canImport}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-colors ${
                canImport
                  ? 'bg-[#1B5E20] text-white hover:bg-[#2E7D32]'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {importing ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <DatabaseZap size={16} />
              )}
              {parsed && summary
                ? `Save to database · ${fmt(summary.grossTotal)}${location ? ` · ${location.name}` : ''}`
                : !location
                ? 'Select a location first'
                : 'Drop a CSV file to import'}
            </button>

            {/* ── Financial summary cards ── */}
            {summary && (
              <>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                    {fmtDate(summary.weekStart)} – {fmtDate(summary.weekEnd)}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { icon: Euro,      label: 'Gross Revenue', value: fmt(summary.grossTotal),  color: 'text-[#1B5E20]' },
                      { icon: Receipt,   label: 'Net Revenue',   value: fmt(summary.netTotal),    color: 'text-blue-700'  },
                      { icon: Percent,   label: 'VAT',           value: fmt(summary.taxTotal),    color: 'text-amber-700' },
                      { icon: TrendingUp,label: 'Tips',          value: fmt(summary.tips),        color: 'text-purple-700'},
                    ].map((s) => (
                      <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                        <div className="flex items-center gap-1.5 mb-1">
                          <s.icon size={12} className={s.color} />
                          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">{s.label}</p>
                        </div>
                        <p className={`text-sm font-bold ${s.color} leading-tight`}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* VAT split */}
                <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Gross Revenue Split</p>
                  {[
                    { label: 'Food (7% VAT)',    value: summary.grossFood,   pct: summary.grossTotal > 0 ? summary.grossFood   / summary.grossTotal * 100 : 0, color: '#2E7D32' },
                    { label: 'Drinks (19% VAT)', value: summary.grossDrinks, pct: summary.grossTotal > 0 ? summary.grossDrinks / summary.grossTotal * 100 : 0, color: '#1565C0' },
                  ].map((row) => (
                    <div key={row.label} className="mb-2 last:mb-0">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-700 font-medium">{row.label}</span>
                        <span className="text-gray-500">{fmt(row.value)} · {row.pct.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${row.pct}%`, backgroundColor: row.color }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* In-house vs takeaway */}
                {(summary.inhouseTotal > 0 || summary.takeawayTotal > 0) && (
                  <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">In-house vs Takeaway</p>
                    {[
                      { label: 'In-house',  value: summary.inhouseTotal,  pct: summary.grossTotal > 0 ? summary.inhouseTotal  / summary.grossTotal * 100 : 0, color: '#2E7D32' },
                      { label: 'Takeaway',  value: summary.takeawayTotal, pct: summary.grossTotal > 0 ? summary.takeawayTotal / summary.grossTotal * 100 : 0, color: '#E65100' },
                    ].map((row) => (
                      <div key={row.label} className="mb-2 last:mb-0">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-700 font-medium">{row.label}</span>
                          <span className="text-gray-500">{fmt(row.value)} · {row.pct.toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${row.pct}%`, backgroundColor: row.color }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <p className="text-xs text-gray-400 text-center leading-relaxed">
              Export from MY orderbird → Reports → Z-Report → select week → Export CSV.<br />
              Upload one file per location per week.
            </p>
          </div>

          {/* ── Right panel ── */}
          {summary && parsed && parsed.length > 0 && (
            <div className="flex-1 min-w-0 space-y-5">

              {/* Category breakdown */}
              {topCats.length > 0 && (
                <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Revenue by Category</p>
                  <div className="space-y-2">
                    {topCats.map(([cat, rev]) => {
                      const pct = summary.grossTotal > 0 ? (rev / summary.grossTotal) * 100 : 0;
                      return (
                        <div key={cat}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-700 font-medium">{cat}</span>
                            <span className="text-gray-500">{fmt(rev)} · {pct.toFixed(1)}%</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-[#2E7D32] rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Products table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">All Products</p>
                  <p className="text-xs text-gray-400">{parsed.length} products · page {page + 1} of {totalPages}</p>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">#</th>
                          <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Product</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Qty</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Unit €</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Revenue</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">In-house</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Takeaway</th>
                          <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">% Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {pageRows.map((r, i) => {
                          const rank   = page * PAGE_SIZE + i + 1;
                          const pct    = summary.grossTotal > 0 ? (r.total_price / summary.grossTotal) * 100 : 0;
                          return (
                            <tr key={i} className="hover:bg-gray-50 transition-colors">
                              <td className="px-3 py-2 text-gray-400 tabular-nums">{rank}</td>
                              <td className="px-3 py-2 text-gray-900 font-medium max-w-[220px] truncate">{r.item_name}</td>
                              <td className="px-3 py-2 text-right text-gray-600 tabular-nums">{r.quantity.toLocaleString('de-DE')}</td>
                              <td className="px-3 py-2 text-right text-gray-500 tabular-nums">{r.unit_price > 0 ? fmt(r.unit_price) : '—'}</td>
                              <td className="px-3 py-2 text-right font-semibold text-gray-900 tabular-nums">{fmt(r.total_price)}</td>
                              <td className="px-3 py-2 text-right text-gray-500 tabular-nums">{r.inhouse_revenue > 0 ? fmt(r.inhouse_revenue) : '—'}</td>
                              <td className="px-3 py-2 text-right text-gray-500 tabular-nums">{r.takeaway_revenue > 0 ? fmt(r.takeaway_revenue) : '—'}</td>
                              <td className="px-3 py-2 text-right text-gray-400 tabular-nums">{pct.toFixed(1)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft size={14} /> Prev
                    </button>
                    <span className="text-xs text-gray-400">
                      {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, parsed.length)} of {parsed.length}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page === totalPages - 1 || totalPages === 0}
                      className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Next <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ HISTORY TAB ═══════ */}
      {tab === 'history' && (
        histLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-[#1B5E20] rounded-full animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <History size={40} className="text-gray-200" />
            <p className="text-gray-400 text-sm">No imports yet</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">File</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Week</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Products</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Revenue</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Imported</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-semibold text-gray-900">{h.location_name}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{h.file_name}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {fmtDate(h.week_start)} – {fmtDate(h.week_end)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{h.row_count.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-bold text-[#1B5E20]">{fmt(h.total_revenue)}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {new Date(h.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => deleteImport(h.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200">
                  <td colSpan={4} className="px-4 py-3 text-xs font-semibold text-gray-500">{history.length} imports total</td>
                  <td className="px-4 py-3 text-right font-bold text-[#1B5E20]">
                    {fmt(history.reduce((s, h) => s + h.total_revenue, 0))}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
    </div>
  );
}
