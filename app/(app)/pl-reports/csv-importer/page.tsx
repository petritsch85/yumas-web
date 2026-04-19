'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Upload, FileCheck, AlertCircle, DatabaseZap,
  History, MapPin, Trash2, ChevronLeft, ChevronRight,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────
type Location = { id: string; name: string };

type ParsedRow = {
  sale_date:      string | null;
  sale_time:      string | null;
  item_name:      string;
  category:       string | null;
  quantity:       number;
  unit_price:     number;
  total_price:    number;
  payment_method: string | null;
  receipt_number: string | null;
};

type ImportRecord = {
  id:            string;
  created_at:    string;
  file_name:     string;
  week_start:    string | null;
  week_end:      string | null;
  row_count:     number;
  total_revenue: number;
  location_name: string;
};

// ── CSV helpers ───────────────────────────────────────────────────────────────
function parseNum(s: string): number {
  if (!s) return 0;
  const c = s.trim().replace(/[€$\s]/g, '');
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

const COL_MAP: Record<string, string[]> = {
  date:        ['datum', 'date', 'verkaufsdatum', 'sale date', 'belegdatum'],
  time:        ['uhrzeit', 'time', 'verkaufszeit', 'belegzeit'],
  item:        ['artikel', 'artikelname', 'bezeichnung', 'item', 'product', 'produktname', 'name'],
  category:    ['kategorie', 'category', 'warengruppe', 'gruppe'],
  quantity:    ['menge', 'anzahl', 'quantity', 'qty', 'stück', 'stk'],
  unit_price:  ['einzelpreis', 'einzelbetrag', 'preis', 'unit price', 'price', 'vk-preis'],
  total_price: ['gesamtpreis', 'gesamtbetrag', 'betrag', 'total', 'umsatz', 'brutto', 'summe', 'revenue'],
  payment:     ['zahlungsart', 'payment', 'bezahlart'],
  receipt:     ['bonnummer', 'bon-nr', 'receipt', 'belegnummer'],
};

function findCol(headers: string[], field: string): number {
  for (const v of COL_MAP[field] ?? []) {
    const idx = headers.findIndex((h) => h.includes(v));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseCSV(raw: string): { rows: ParsedRow[]; error?: string } {
  const content = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines   = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return { rows: [], error: 'File appears to be empty.' };

  const delimiter = lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  const split     = (line: string) => line.split(delimiter).map((v) => v.replace(/^"|"$/g, '').trim());

  const headers = split(lines[0]).map((h) => h.toLowerCase());

  const colDate  = findCol(headers, 'date');
  const colTime  = findCol(headers, 'time');
  const colItem  = findCol(headers, 'item');
  const colCat   = findCol(headers, 'category');
  const colQty   = findCol(headers, 'quantity');
  const colUnit  = findCol(headers, 'unit_price');
  const colTotal = findCol(headers, 'total_price');
  const colPay   = findCol(headers, 'payment');
  const colRec   = findCol(headers, 'receipt');

  if (colItem === -1 && colTotal === -1)
    return { rows: [], error: 'Could not detect item or revenue columns. Please check the CSV format.' };

  const rows: ParsedRow[] = lines.slice(1).map((line) => {
    const v = split(line);
    return {
      sale_date:      colDate  !== -1 ? parseDate(v[colDate] ?? '')  : null,
      sale_time:      colTime  !== -1 ? (v[colTime] ?? null)         : null,
      item_name:      colItem  !== -1 ? (v[colItem] ?? 'Unknown')    : 'Unknown',
      category:       colCat   !== -1 ? (v[colCat] ?? null)          : null,
      quantity:       colQty   !== -1 ? parseNum(v[colQty] ?? '1')   : 1,
      unit_price:     colUnit  !== -1 ? parseNum(v[colUnit] ?? '0')  : 0,
      total_price:    colTotal !== -1 ? parseNum(v[colTotal] ?? '0') : 0,
      payment_method: colPay   !== -1 ? (v[colPay] ?? null)          : null,
      receipt_number: colRec   !== -1 ? (v[colRec] ?? null)          : null,
    };
  }).filter((r) => r.item_name !== 'Unknown' || r.total_price > 0);

  return { rows };
}

const fmt = (n: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const PAGE_SIZE = 25;

// ── Page component ────────────────────────────────────────────────────────────
export default function CSVImporterPage() {
  const queryClient = useQueryClient();
  const [tab, setTab]             = useState<'upload' | 'history'>('upload');
  const [location, setLocation]   = useState<Location | null>(null);
  const [fileName, setFileName]   = useState<string | null>(null);
  const [parsed, setParsed]       = useState<ParsedRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [page, setPage]           = useState(0);
  const fileInputRef              = useRef<HTMLInputElement>(null);

  // ── Queries ──
  const { data: locations = [] } = useQuery({
    queryKey: ['locations-active'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').eq('is_active', true).order('name');
      return (data ?? []) as Location[];
    },
  });

  const { data: history = [], isLoading: histLoading, refetch: refetchHistory } = useQuery({
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

  // ── Stats ──
  const stats = useMemo(() => {
    if (!parsed || parsed.length === 0) return null;
    const totalRevenue = parsed.reduce((s, r) => s + r.total_price, 0);
    const dates = [...new Set(parsed.map((r) => r.sale_date).filter(Boolean) as string[])].sort();
    const categories = parsed.reduce<Record<string, number>>((acc, r) => {
      const k = r.category ?? 'Other'; acc[k] = (acc[k] ?? 0) + r.total_price; return acc;
    }, {});
    const topItems = Object.entries(
      parsed.reduce<Record<string, number>>((acc, r) => {
        acc[r.item_name] = (acc[r.item_name] ?? 0) + r.total_price; return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const byDay = dates.reduce<Record<string, number>>((acc, d) => {
      acc[d] = parsed.filter((r) => r.sale_date === d).reduce((s, r) => s + r.total_price, 0); return acc;
    }, {});
    return { totalRevenue, weekStart: dates[0] ?? null, weekEnd: dates[dates.length - 1] ?? null, categories, topItems, byDay, rowCount: parsed.length };
  }, [parsed]);

  // ── File handling ──
  const processFile = useCallback((file: File) => {
    setFileName(file.name);
    setParsed(null);
    setParseError(null);
    setPage(0);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const { rows, error } = parseCSV(content ?? '');
      if (error) { setParseError(error); return; }
      setParsed(rows);
    };
    reader.readAsText(file, 'UTF-8');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  // ── Import ──
  const handleImport = useCallback(async () => {
    if (!location || !parsed || !stats) return;
    setImporting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: imp, error: impErr } = await supabase
        .from('sales_imports')
        .insert({
          location_id:   location.id,
          file_name:     fileName ?? 'unknown.csv',
          week_start:    stats.weekStart,
          week_end:      stats.weekEnd,
          row_count:     parsed.length,
          total_revenue: stats.totalRevenue,
          imported_by:   user?.id ?? null,
        })
        .select('id').single();
      if (impErr) throw impErr;

      for (let i = 0; i < parsed.length; i += 200) {
        const chunk = parsed.slice(i, i + 200).map((r) => ({ import_id: imp.id, ...r }));
        const { error } = await supabase.from('sales_import_lines').insert(chunk);
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ['sales-imports'] });
      setParsed(null); setFileName(null); setPage(0);
      setTab('history');
      alert(`✅ Imported ${parsed.length} rows for ${location.name} — ${fmt(stats.totalRevenue)}`);
    } catch (e: any) {
      alert(`Import failed: ${e.message}`);
    } finally {
      setImporting(false);
    }
  }, [location, parsed, fileName, stats, queryClient]);

  // ── Delete ──
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
          <p className="text-sm text-gray-500 mt-0.5">Upload weekly Orderbird sales exports</p>
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

          {/* Left panel */}
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
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Orderbird CSV File</label>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                  isDragging
                    ? 'border-[#1B5E20] bg-green-50'
                    : fileName
                    ? 'border-green-400 bg-green-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                {fileName
                  ? <FileCheck className="mx-auto mb-2 text-green-600" size={32} />
                  : <Upload className="mx-auto mb-2 text-gray-400" size={32} />
                }
                <p className={`text-sm font-semibold mb-1 ${fileName ? 'text-green-700' : 'text-gray-600'}`}>
                  {fileName ?? 'Drop CSV here'}
                </p>
                <p className="text-xs text-gray-400 mb-3">
                  {parsed ? `${parsed.length} rows ready to import` : 'or click to browse'}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  {fileName ? 'Replace file' : 'Browse files'}
                </button>
              </div>

              {parseError && (
                <div className="mt-2 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{parseError}</p>
                </div>
              )}
            </div>

            {/* Stats */}
            {stats && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Rows',    value: stats.rowCount.toLocaleString() },
                    { label: 'Revenue', value: fmt(stats.totalRevenue) },
                    { label: 'Days',    value: Object.keys(stats.byDay).length.toString() },
                  ].map((s) => (
                    <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-3 text-center shadow-sm">
                      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">{s.label}</p>
                      <p className="text-base font-bold text-gray-900 leading-tight">{s.value}</p>
                    </div>
                  ))}
                </div>

                <div className="text-xs text-gray-500 text-center">
                  {fmtDate(stats.weekStart)} → {fmtDate(stats.weekEnd)}
                </div>

                {/* By category */}
                <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Revenue by Category</p>
                  {Object.entries(stats.categories).sort((a, b) => b[1] - a[1]).map(([cat, rev]) => {
                    const pct = stats.totalRevenue > 0 ? (rev / stats.totalRevenue) * 100 : 0;
                    return (
                      <div key={cat} className="mb-2 last:mb-0">
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

                {/* Top items */}
                <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Top 10 Items</p>
                  {stats.topItems.map(([name, rev], i) => (
                    <div key={name} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
                      <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                      <span className="text-xs text-gray-700 flex-1 truncate">{name}</span>
                      <span className="text-xs font-semibold text-gray-900">{fmt(rev)}</span>
                    </div>
                  ))}
                </div>

                {/* Daily breakdown */}
                {Object.keys(stats.byDay).length > 1 && (
                  <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Daily Breakdown</p>
                    {Object.entries(stats.byDay).sort().map(([date, rev]) => (
                      <div key={date} className="flex justify-between py-1.5 border-b border-gray-50 last:border-0">
                        <span className="text-xs text-gray-600">{fmtDate(date)}</span>
                        <span className="text-xs font-semibold text-gray-900">{fmt(rev)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Import button */}
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
              {parsed ? `Import ${parsed.length} rows${location ? ` · ${location.name}` : ''}` : 'Select location & file'}
            </button>

            <p className="text-xs text-gray-400 text-center leading-relaxed">
              Export from MY orderbird → Reports → Cashbook → Export CSV.<br />
              Upload one file per location per week.
            </p>
          </div>

          {/* Right panel — data table */}
          {parsed && parsed.length > 0 && (
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Data Preview</p>
                <p className="text-xs text-gray-400">{parsed.length} rows · page {page + 1} of {totalPages}</p>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Date</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Qty</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Unit €</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Total €</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide">Payment</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Receipt #</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pageRows.map((r, i) => (
                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.sale_date ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-900 font-medium max-w-[200px] truncate">{r.item_name}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{r.quantity}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{r.unit_price > 0 ? fmt(r.unit_price) : '—'}</td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-900">{fmt(r.total_price)}</td>
                          <td className="px-3 py-2 text-gray-500 max-w-[100px] truncate">{r.category ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-500">{r.payment_method ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-400">{r.receipt_number ?? '—'}</td>
                        </tr>
                      ))}
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
                    Rows {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, parsed.length)} of {parsed.length}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page === totalPages - 1}
                    className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next <ChevronRight size={14} />
                  </button>
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
          <div>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">File</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Week start</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Week end</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Rows</th>
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
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(h.week_start)}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(h.week_end)}</td>
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
                    <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-gray-500">{history.length} imports total</td>
                    <td className="px-4 py-3 text-right font-bold text-[#1B5E20]">
                      {fmt(history.reduce((s, h) => s + h.total_revenue, 0))}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
