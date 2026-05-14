'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { ShoppingBag, ChevronDown, ChevronUp, ChevronsUpDown, Euro, Utensils, Wine, Users, Plus, X, Check, AlertTriangle } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Location = { id: string; name: string };
type Mode     = 'shift' | 'week' | 'month';

type ProductRow = {
  id:              string;
  shift_report_id: string;
  product_name:    string;
  quantity:        number;
  gross_sales:     number;
  report_date:     string;
  shift_type:      'lunch' | 'dinner' | null;
};

type FinishedGoodLookup = {
  name:             string;
  menu_category:    'Starter' | 'Main' | 'Drinks' | 'Salsas' | 'Dessert' | 'Other' | null;
  guest_multiplier: number;
};

type SortKey = 'product_name' | 'quantity' | 'gross_sales';
type SortDir = 'asc' | 'desc';

type MenuCategory = 'Starter' | 'Main' | 'Drinks' | 'Salsas' | 'Dessert' | 'Other';

type MissingProduct = { product_name: string; quantity: number; gross_sales: number };

type MissingDraft = {
  category:         MenuCategory;
  vat:              '7' | '19';
  occasion:         'L' | 'D' | 'L+D';
  guest_multiplier: string;
  adding:           boolean;
  added:            boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);

const fmtDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function weeksInYear(year: number): number {
  return getISOWeek(new Date(Date.UTC(year, 11, 28)));
}

function getWeekDateRange(year: number, week: number): [string, string] {
  const jan4    = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday  = new Date(jan4.getTime() - (jan4Day - 1) * 86400000 + (week - 1) * 7 * 86400000);
  const sunday  = new Date(monday.getTime() + 6 * 86400000);
  const s = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  return [s(monday), s(sunday)];
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const CATEGORY_OPTIONS: MenuCategory[] = ['Starter', 'Main', 'Drinks', 'Salsas', 'Dessert', 'Other'];

const CATEGORY_STYLES: Record<MenuCategory, string> = {
  Main:    'bg-[#1B5E20]/10 text-[#1B5E20]',
  Starter: 'bg-amber-50 text-amber-700',
  Drinks:  'bg-blue-50 text-blue-700',
  Salsas:  'bg-orange-50 text-orange-700',
  Dessert: 'bg-pink-50 text-pink-700',
  Other:   'bg-gray-100 text-gray-500',
};

function defaultDraft(): MissingDraft {
  return { category: 'Other', vat: '7', occasion: 'L+D', guest_multiplier: '0', adding: false, added: false };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProductDetailsPage() {
  const qc            = useQueryClient();
  const now           = new Date();
  const currentYear   = now.getFullYear();
  const currentMonth  = now.getMonth() + 1;
  const currentWeek   = getISOWeek(now);

  // ── Selectors ──────────────────────────────────────────────────────────────
  const [mode,         setMode]         = useState<Mode>('shift');
  const [locationId,   setLocationId]   = useState<string>('');
  const [shiftDate,    setShiftDate]    = useState(isoToday());
  const [shiftType,    setShiftType]    = useState<'lunch' | 'dinner'>('lunch');
  const [selWeek,      setSelWeek]      = useState(currentWeek);
  const [selMonth,     setSelMonth]     = useState(currentMonth);
  const [sortKey,      setSortKey]      = useState<SortKey>('gross_sales');
  const [sortDir,      setSortDir]      = useState<SortDir>('desc');

  // ── Missing products panel ─────────────────────────────────────────────────
  const [showMissing,  setShowMissing]  = useState(false);
  const [drafts,       setDrafts]       = useState<Record<string, MissingDraft>>({});
  const [addingAll,    setAddingAll]    = useState(false);

  const totalWeeks = weeksInYear(currentYear);

  // ── Derived date range ─────────────────────────────────────────────────────
  const { dateFrom, dateTo, shiftFilter, periodLabel } = useMemo(() => {
    if (mode === 'shift') {
      return {
        dateFrom:    shiftDate,
        dateTo:      shiftDate,
        shiftFilter: shiftType as 'lunch' | 'dinner' | 'all',
        periodLabel: `${fmtDate(shiftDate)} · ${shiftType === 'lunch' ? '🌤 Lunch' : '🌙 Dinner'}`,
      };
    }
    if (mode === 'week') {
      const [from, to] = getWeekDateRange(currentYear, selWeek);
      return {
        dateFrom:    from,
        dateTo:      to,
        shiftFilter: 'all' as const,
        periodLabel: `KW ${selWeek}, ${currentYear}`,
      };
    }
    const from    = `${currentYear}-${String(selMonth).padStart(2,'0')}-01`;
    const lastDay = new Date(currentYear, selMonth, 0).getDate();
    const to      = `${currentYear}-${String(selMonth).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    return {
      dateFrom:    from,
      dateTo:      to,
      shiftFilter: 'all' as const,
      periodLabel: `${MONTH_NAMES[selMonth-1]} ${currentYear}`,
    };
  }, [mode, shiftDate, shiftType, selWeek, selMonth, currentYear]);

  // ── Locations ──────────────────────────────────────────────────────────────
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['locations-active'],
    queryFn: async () => {
      const { data } = await supabase
        .from('locations').select('id, name, type')
        .eq('is_active', true).order('name');
      return ((data ?? []) as any[])
        .filter(l => l.type === 'restaurant')
        .map(({ id, name }) => ({ id, name }));
    },
  });

  // ── Product data ───────────────────────────────────────────────────────────
  const { data: rows = [], isLoading } = useQuery<ProductRow[]>({
    queryKey: ['shift-report-products', locationId, dateFrom, dateTo, shiftFilter],
    enabled:  !!locationId,
    queryFn: async () => {
      let q = supabase
        .from('shift_report_products')
        .select('id, shift_report_id, product_name, quantity, gross_sales, shift_reports!inner(report_date, shift_type, location_id)')
        .eq('shift_reports.location_id', locationId)
        .gte('shift_reports.report_date', dateFrom)
        .lte('shift_reports.report_date', dateTo)
        .order('product_name');
      if (shiftFilter !== 'all') q = q.eq('shift_reports.shift_type', shiftFilter);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as any[]).map(r => ({
        id:              r.id,
        shift_report_id: r.shift_report_id,
        product_name:    r.product_name,
        quantity:        r.quantity,
        gross_sales:     r.gross_sales,
        report_date:     r.shift_reports.report_date,
        shift_type:      r.shift_reports.shift_type,
      }));
    },
  });

  // ── Finished goods lookup ──────────────────────────────────────────────────
  const { data: finishedGoods = [] } = useQuery<FinishedGoodLookup[]>({
    queryKey: ['items-finished-lookup'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items').select('*')
        .eq('product_type', 'finished').eq('is_active', true);
      if (error) console.error('[items-finished-lookup]', error.message);
      return (data ?? []) as FinishedGoodLookup[];
    },
  });

  const itemMap = useMemo(() => {
    const m = new Map<string, FinishedGoodLookup>();
    for (const item of finishedGoods) m.set(item.name.toLowerCase(), item);
    return m;
  }, [finishedGoods]);

  // ── VAT helper — uses category as the source of truth ───────────────────
  const vatForItem = (productName: string): number => {
    const item = itemMap.get(productName.toLowerCase());
    return item?.menu_category === 'Drinks' ? 0.19 : 0.07;
  };

  // ── Aggregation ────────────────────────────────────────────────────────────
  const aggregated = useMemo(() => {
    const map = new Map<string, { quantity: number; gross_sales: number; net_sales: number }>();
    for (const r of rows) {
      const net = r.gross_sales / (1 + vatForItem(r.product_name));
      const ex  = map.get(r.product_name);
      if (ex) { ex.quantity += r.quantity; ex.gross_sales += r.gross_sales; ex.net_sales += net; }
      else map.set(r.product_name, { quantity: r.quantity, gross_sales: r.gross_sales, net_sales: net });
    }
    return Array.from(map.entries()).map(([product_name, v]) => ({ product_name, ...v }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, itemMap]);

  const sorted = useMemo(() => {
    return [...aggregated].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [aggregated, sortKey, sortDir]);

  const totals = useMemo(() => ({
    quantity:    rows.reduce((s, r) => s + r.quantity, 0),
    gross_sales: rows.reduce((s, r) => s + r.gross_sales, 0),
    net_sales:   aggregated.reduce((s, r) => s + r.net_sales, 0),
  }), [rows, aggregated]);

  const summary = useMemo(() => {
    let grossFood = 0, grossDrinks = 0, netFood = 0, netDrinks = 0, guests = 0;
    const unmatchedMap = new Map<string, { quantity: number; gross_sales: number }>();
    for (const r of rows) {
      const item = itemMap.get(r.product_name.toLowerCase());
      const vat  = item?.menu_category === 'Drinks' ? 0.19 : 0.07;
      const net  = r.gross_sales / (1 + vat);
      if (!item) {
        const ex = unmatchedMap.get(r.product_name);
        if (ex) { ex.quantity += r.quantity; ex.gross_sales += r.gross_sales; }
        else unmatchedMap.set(r.product_name, { quantity: r.quantity, gross_sales: r.gross_sales });
        continue;
      }
      if (item.menu_category === 'Drinks') { grossDrinks += r.gross_sales; netDrinks += net; }
      else                                 { grossFood   += r.gross_sales; netFood   += net; }
      guests += r.quantity * (item.guest_multiplier ?? 0);
    }
    const unmatchedProducts: MissingProduct[] = Array.from(unmatchedMap.entries())
      .map(([product_name, v]) => ({ product_name, ...v }))
      .sort((a, b) => b.gross_sales - a.gross_sales);
    return {
      grossFood, grossDrinks, netFood, netDrinks,
      guests: Math.round(guests * 2) / 2,
      unmatched: unmatchedProducts.length,
      unmatchedProducts,
    };
  }, [rows, itemMap]);

  // Initialise / reset drafts when unmatched list changes
  useEffect(() => {
    setDrafts(prev => {
      const next: Record<string, MissingDraft> = {};
      for (const p of summary.unmatchedProducts) {
        next[p.product_name] = prev[p.product_name] ?? defaultDraft();
      }
      return next;
    });
  }, [summary.unmatchedProducts]);

  // ── Add missing helpers ────────────────────────────────────────────────────
  const setDraft = (name: string, patch: Partial<MissingDraft>) =>
    setDrafts(prev => ({ ...prev, [name]: { ...(prev[name] ?? defaultDraft()), ...patch } }));

  const addOne = async (product_name: string) => {
    const d = drafts[product_name] ?? defaultDraft();
    setDraft(product_name, { adding: true });
    const { error } = await supabase.from('items').insert({
      name:             product_name,
      product_type:     'finished',
      vat_rate:         d.vat === '19' ? 0.19 : 0.07,
      menu_category:    d.category,
      occasion:         d.occasion,
      guest_multiplier: parseInt(d.guest_multiplier) || 0,
      is_active:        true,
      is_purchasable:   false,
      is_produced:      false,
    });
    if (!error) {
      setDraft(product_name, { adding: false, added: true });
      qc.invalidateQueries({ queryKey: ['items-finished-lookup'] });
      qc.invalidateQueries({ queryKey: ['finished-goods-guest'] });
      qc.invalidateQueries({ queryKey: ['items', 'finished'] });
    } else {
      setDraft(product_name, { adding: false });
    }
  };

  const addAll = async () => {
    setAddingAll(true);
    const pending = summary.unmatchedProducts.filter(p => !drafts[p.product_name]?.added);
    for (const p of pending) {
      const d = drafts[p.product_name] ?? defaultDraft();
      await supabase.from('items').insert({
        name:             p.product_name,
        product_type:     'finished',
        vat_rate:         d.vat === '19' ? 0.19 : 0.07,
        menu_category:    d.category,
        occasion:         d.occasion,
        guest_multiplier: parseInt(d.guest_multiplier) || 0,
        is_active:        true,
        is_purchasable:   false,
        is_produced:      false,
      });
      setDraft(p.product_name, { added: true });
    }
    qc.invalidateQueries({ queryKey: ['items-finished-lookup'] });
    qc.invalidateQueries({ queryKey: ['finished-goods-guest'] });
    qc.invalidateQueries({ queryKey: ['items', 'finished'] });
    setAddingAll(false);
  };

  // ── Sort handler ───────────────────────────────────────────────────────────
  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k
      ? (sortDir === 'asc' ? <ChevronUp size={12} className="text-white" /> : <ChevronDown size={12} className="text-white" />)
      : <ChevronsUpDown size={12} className="text-white/40" />;

  // ── Reusable button styles ─────────────────────────────────────────────────
  const activeCls   = 'bg-[#1B5E20] text-white border-[#1B5E20]';
  const inactiveCls = 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20] hover:text-[#1B5E20]';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#1B5E20]/10 flex items-center justify-center flex-shrink-0">
          <ShoppingBag size={20} className="text-[#1B5E20]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Details</h1>
          <p className="text-sm text-gray-500 mt-0.5">Products sold per shift — aggregated by shift, week or month</p>
        </div>
      </div>

      {/* ── Selector panel ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">

        {/* Row 1: Mode */}
        <div className="flex items-center gap-0 border-b border-gray-200">
          {(['shift', 'week', 'month'] as Mode[]).map((m, i) => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 py-3 text-sm font-semibold transition-colors
                ${mode === m ? 'bg-[#1B5E20] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}
                ${i > 0 ? 'border-l border-gray-200' : ''}`}>
              {m === 'shift' ? 'By Shift' : m === 'week' ? 'By Week' : 'By Month'}
            </button>
          ))}
        </div>

        {/* Row 2: Location */}
        <div className="flex items-center gap-0 border-b border-gray-200">
          {locations.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-400">Loading locations…</div>
          ) : (
            locations.map((loc, i) => (
              <button key={loc.id} onClick={() => setLocationId(loc.id)}
                className={`flex-1 py-3 text-sm font-semibold transition-colors
                  ${locationId === loc.id ? 'bg-[#1B5E20]/10 text-[#1B5E20]' : 'bg-white text-gray-500 hover:bg-gray-50'}
                  ${i > 0 ? 'border-l border-gray-200' : ''}`}>
                {loc.name}
              </button>
            ))
          )}
        </div>

        {/* Row 3: Period selector */}
        <div className="px-4 py-4">

          {/* ── By Shift ── */}
          {mode === 'shift' && (
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Date</label>
                <input
                  type="date" value={shiftDate}
                  onChange={e => setShiftDate(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Shift</label>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-semibold">
                  {(['lunch', 'dinner'] as const).map((s, i) => (
                    <button key={s} onClick={() => setShiftType(s)}
                      className={`px-5 py-2 transition-colors
                        ${shiftType === s ? 'bg-[#1B5E20] text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}
                        ${i > 0 ? 'border-l border-gray-200' : ''}`}>
                      {s === 'lunch' ? '🌤 Lunch' : '🌙 Dinner'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── By Week ── */}
          {mode === 'week' && (
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Calendar Week — {currentYear}
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(w => (
                  <button key={w} onClick={() => setSelWeek(w)}
                    className={`w-12 py-1.5 rounded-lg border text-xs font-semibold transition-colors
                      ${selWeek === w ? activeCls : inactiveCls}
                      ${w === currentWeek ? 'ring-2 ring-offset-1 ring-[#1B5E20]/40' : ''}`}>
                    KW{w}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── By Month ── */}
          {mode === 'month' && (
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Month — {currentYear}
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {MONTH_NAMES.map((name, idx) => {
                  const m = idx + 1;
                  return (
                    <button key={m} onClick={() => setSelMonth(m)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors
                        ${selMonth === m ? activeCls : inactiveCls}
                        ${m === currentMonth ? 'ring-2 ring-offset-1 ring-[#1B5E20]/40' : ''}`}>
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── No location selected ── */}
      {!locationId ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center text-gray-400">
          <ShoppingBag size={32} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm font-medium">Select a location above to view product details</p>
        </div>
      ) : isLoading ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center text-gray-400 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center text-gray-400">
          <p className="text-sm font-medium">No data for <span className="font-semibold text-gray-600">{periodLabel}</span></p>
          <p className="text-xs mt-1 text-gray-400">Import shift reports via Sales Reports → Upload to populate this page</p>
        </div>
      ) : (
        <>
          {/* ── Period Summary ── */}
          <div className="bg-white rounded-xl border border-gray-300 shadow-sm mb-5 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-300 bg-gray-50">
              <h2 className="text-xs font-bold text-gray-600 uppercase tracking-wide">
                Period Summary
                <span className="ml-2 font-normal text-gray-400 normal-case tracking-normal">— {periodLabel}</span>
              </h2>
            </div>

            {/* Row 1: Sales figures */}
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-300 border-b border-gray-300">
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-lg bg-[#1B5E20]/10 flex items-center justify-center flex-shrink-0">
                    <Euro size={12} className="text-[#1B5E20]" />
                  </div>
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Gross Sales</span>
                </div>
                <p className="text-xl font-bold text-gray-900 tabular-nums">{fmt(totals.gross_sales)}</p>
              </div>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                    <Utensils size={12} className="text-amber-600" />
                  </div>
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Gross Food Sales</span>
                </div>
                <p className="text-xl font-bold text-gray-900 tabular-nums">{fmt(summary.grossFood)}</p>
                {totals.gross_sales > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">{((summary.grossFood / totals.gross_sales) * 100).toFixed(1)} % of total</p>
                )}
              </div>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <Wine size={12} className="text-blue-600" />
                  </div>
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Gross Drinks Sales</span>
                </div>
                <p className="text-xl font-bold text-gray-900 tabular-nums">{fmt(summary.grossDrinks)}</p>
                {totals.gross_sales > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">{((summary.grossDrinks / totals.gross_sales) * 100).toFixed(1)} % of total</p>
                )}
              </div>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                    <Users size={12} className="text-purple-600" />
                  </div>
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Est. Guests</span>
                </div>
                <p className="text-xl font-bold text-gray-900 tabular-nums">
                  {new Intl.NumberFormat('de-DE').format(summary.guests)}
                </p>
                {summary.unmatched > 0 && (
                  <button
                    onClick={() => setShowMissing(v => !v)}
                    className="text-xs text-amber-500 mt-0.5 hover:text-amber-700 hover:underline transition-colors flex items-center gap-1"
                  >
                    <AlertTriangle size={11} />
                    {summary.unmatched} product{summary.unmatched !== 1 ? 's' : ''} not in Finished Goods
                  </button>
                )}
              </div>
            </div>

            {/* Row 2: Net figures */}
            <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-gray-300 border-b border-gray-300 bg-[#1B5E20]/5">
              <div className="px-5 py-3">
                <p className="text-xs font-semibold text-[#1B5E20] uppercase tracking-wide mb-0.5">Total Net Sales</p>
                <p className="text-lg font-bold text-gray-900 tabular-nums">{fmt(totals.net_sales)}</p>
              </div>
              <div className="px-5 py-3">
                <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-0.5">Net Food Sales</p>
                <p className="text-lg font-bold text-gray-900 tabular-nums">{fmt(summary.netFood)}</p>
                {totals.net_sales > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">{((summary.netFood / totals.net_sales) * 100).toFixed(1)} % of net</p>
                )}
              </div>
              <div className="px-5 py-3">
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-0.5">Net Drinks Sales</p>
                <p className="text-lg font-bold text-gray-900 tabular-nums">{fmt(summary.netDrinks)}</p>
                {totals.net_sales > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">{((summary.netDrinks / totals.net_sales) * 100).toFixed(1)} % of net</p>
                )}
              </div>
            </div>

            {/* Row 3: Per-guest */}
            <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-gray-300 bg-gray-50">
              <div className="px-5 py-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Total / Guest</p>
                <p className="text-lg font-bold text-gray-800 tabular-nums">
                  {summary.guests > 0 ? fmt(totals.gross_sales / summary.guests) : '—'}
                </p>
              </div>
              <div className="px-5 py-3">
                <p className="text-xs font-semibold text-amber-500 uppercase tracking-wide mb-0.5">Food / Guest</p>
                <p className="text-lg font-bold text-gray-800 tabular-nums">
                  {summary.guests > 0 ? fmt(summary.grossFood / summary.guests) : '—'}
                </p>
              </div>
              <div className="px-5 py-3">
                <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-0.5">Drinks / Guest</p>
                <p className="text-lg font-bold text-gray-800 tabular-nums">
                  {summary.guests > 0 ? fmt(summary.grossDrinks / summary.guests) : '—'}
                </p>
              </div>
            </div>
          </div>

          {/* ── Missing Products Panel ── */}
          {showMissing && summary.unmatchedProducts.length > 0 && (
            <div className="bg-white rounded-xl border border-amber-200 shadow-sm mb-5 overflow-hidden">

              {/* Panel header */}
              <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={15} className="text-amber-500" />
                  <h2 className="text-xs font-bold text-amber-700 uppercase tracking-wide">
                    {summary.unmatchedProducts.filter(p => !drafts[p.product_name]?.added).length} Products Not in Finished Goods
                  </h2>
                  <span className="text-xs text-amber-500">
                    — {finishedGoods.length} items loaded from Finished Goods · Set category and add to enable guest calculations
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={addAll}
                    disabled={addingAll || summary.unmatchedProducts.every(p => drafts[p.product_name]?.added)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1B5E20] text-white text-xs font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-40"
                  >
                    <Plus size={12} />
                    {addingAll ? 'Adding…' : 'Add All'}
                  </button>
                  <button onClick={() => setShowMissing(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-amber-50/60 border-b border-amber-100">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-amber-700 uppercase tracking-wide">Product Name</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-amber-700 uppercase tracking-wide">Qty Sold</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-amber-700 uppercase tracking-wide">Gross Sales</th>
                      <th className="px-4 py-2 text-center text-xs font-semibold text-amber-700 uppercase tracking-wide">Category</th>
                      <th className="px-4 py-2 text-center text-xs font-semibold text-amber-700 uppercase tracking-wide">VAT</th>
                      <th className="px-4 py-2 text-center text-xs font-semibold text-amber-700 uppercase tracking-wide">Occasion</th>
                      <th className="px-4 py-2 text-center text-xs font-semibold text-amber-700 uppercase tracking-wide">Guests ×</th>
                      <th className="px-4 py-2 text-center text-xs font-semibold text-amber-700 uppercase tracking-wide">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.unmatchedProducts.map((p, i) => {
                      const d = drafts[p.product_name] ?? defaultDraft();
                      return (
                        <tr key={p.product_name}
                          className={`border-b border-gray-100 ${d.added ? 'bg-green-50/50' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                          <td className="px-4 py-2 font-medium text-gray-800">
                            {d.added && <Check size={13} className="inline text-green-600 mr-1.5" />}
                            {p.product_name}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-600 tabular-nums text-xs">
                            {new Intl.NumberFormat('de-DE').format(p.quantity)}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-700 tabular-nums text-xs font-semibold">
                            {fmt(p.gross_sales)}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {d.added ? (
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CATEGORY_STYLES[d.category]}`}>{d.category}</span>
                            ) : (
                              <select
                                value={d.category}
                                onChange={e => setDraft(p.product_name, { category: e.target.value as MenuCategory })}
                                className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#1B5E20]/40"
                              >
                                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            )}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {d.added ? (
                              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${d.vat === '19' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                                {d.vat === '19' ? '19 %' : '7 %'}
                              </span>
                            ) : (
                              <select
                                value={d.vat}
                                onChange={e => setDraft(p.product_name, { vat: e.target.value as '7' | '19' })}
                                className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#1B5E20]/40"
                              >
                                <option value="7">7 %</option>
                                <option value="19">19 %</option>
                              </select>
                            )}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {d.added ? (
                              <span className="text-xs text-gray-500">{d.occasion}</span>
                            ) : (
                              <select
                                value={d.occasion}
                                onChange={e => setDraft(p.product_name, { occasion: e.target.value as 'L' | 'D' | 'L+D' })}
                                className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#1B5E20]/40"
                              >
                                <option value="L">L</option>
                                <option value="D">D</option>
                                <option value="L+D">L+D</option>
                              </select>
                            )}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {d.added ? (
                              <span className="text-xs text-gray-500">{d.guest_multiplier}</span>
                            ) : (
                              <input
                                type="number" min="0" max="10" step="1"
                                value={d.guest_multiplier}
                                onChange={e => setDraft(p.product_name, { guest_multiplier: e.target.value })}
                                className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-14 text-center focus:outline-none focus:ring-1 focus:ring-[#1B5E20]/40"
                              />
                            )}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {d.added ? (
                              <span className="text-xs text-green-600 font-semibold flex items-center justify-center gap-1">
                                <Check size={13} /> Added
                              </span>
                            ) : (
                              <button
                                onClick={() => addOne(p.product_name)}
                                disabled={d.adding}
                                className="px-3 py-1 rounded-lg bg-[#1B5E20] text-white text-xs font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-40 flex items-center gap-1 mx-auto"
                              >
                                <Plus size={11} />
                                {d.adding ? '…' : 'Add'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Products table ── */}
          <div className="rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#1B5E20]">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wide w-12 border-r border-white/10">#</th>
                  <th className="px-4 py-3 text-left border-r border-white/10">
                    <button onClick={() => handleSort('product_name')} className="flex items-center gap-1 text-xs font-semibold text-white/70 uppercase tracking-wide hover:text-white">
                      Product <SortIcon k="product_name" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right border-r border-white/10">
                    <button onClick={() => handleSort('quantity')} className="flex items-center gap-1 text-xs font-semibold text-white/70 uppercase tracking-wide hover:text-white ml-auto">
                      Qty <SortIcon k="quantity" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right border-r border-white/10">
                    <button onClick={() => handleSort('gross_sales')} className="flex items-center gap-1 text-xs font-semibold text-white/70 uppercase tracking-wide hover:text-white ml-auto">
                      Gross Sales <SortIcon k="gross_sales" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-white/70 uppercase tracking-wide border-r border-white/10">Net Sales</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-white/70 uppercase tracking-wide border-r border-white/10">VAT</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-white/70 uppercase tracking-wide border-r border-white/10">Product Price</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-white/70 uppercase tracking-wide">Share</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => (
                  <tr key={row.product_name}
                    className={`border-b border-gray-200 hover:bg-[#1B5E20]/5 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>
                    <td className="px-4 py-2.5 text-xs text-gray-400 font-mono border-r border-gray-200">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800 border-r border-gray-200">{row.product_name}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 border-r border-gray-200 tabular-nums">
                      {new Intl.NumberFormat('de-DE').format(row.quantity)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-800 border-r border-gray-200 tabular-nums">{fmt(row.gross_sales)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 border-r border-gray-200 tabular-nums">{fmt(row.net_sales)}</td>
                    <td className="px-4 py-2.5 text-right border-r border-gray-200 tabular-nums">
                      {(() => { const r = vatForItem(row.product_name); return (
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${r === 0.19 ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                          {r === 0.19 ? '19 %' : '7 %'}
                        </span>
                      ); })()}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600 border-r border-gray-200 tabular-nums">
                      {row.quantity > 0 ? fmt(row.gross_sales / row.quantity) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className="inline-block min-w-[48px] text-xs font-medium text-[#1B5E20]">
                        {totals.gross_sales > 0 ? ((row.gross_sales / totals.gross_sales) * 100).toFixed(1) + ' %' : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#1B5E20]/10 border-t-2 border-[#1B5E20]/30">
                  <td className="px-4 py-3 border-r border-gray-200" />
                  <td className="px-4 py-3 text-xs font-bold text-gray-700 uppercase tracking-wide border-r border-gray-200">Total</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-800 border-r border-gray-200 tabular-nums">
                    {new Intl.NumberFormat('de-DE').format(totals.quantity)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-[#1B5E20] text-base border-r border-gray-200 tabular-nums">{fmt(totals.gross_sales)}</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-700 border-r border-gray-200 tabular-nums">{fmt(totals.net_sales)}</td>
                  <td className="px-4 py-3 border-r border-gray-200" />
                  <td className="px-4 py-3 border-r border-gray-200" />
                  <td className="px-4 py-3 text-right text-xs font-bold text-gray-500">100 %</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-2">{sorted.length} products · {periodLabel}</p>
        </>
      )}
    </div>
  );
}
