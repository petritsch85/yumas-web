'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  BarChart3, Plus, Trash2, AlertTriangle, CheckCircle2, Info,
} from 'lucide-react';

/* ─── Types ──────────────────────────────────────────────────────────────── */
type BillLine = {
  description: string;
  quantity:    number;
  unit_price:  number;
  line_total:  number;
  bill: { invoice_date: string | null; location_label: string | null };
};

type RecipeIngredient = {
  quantity: number;
  item: { name: string; unit?: { abbreviation: string } | null } | null;
};

type Recipe = {
  id:   string;
  name: string;
  recipe_ingredients: RecipeIngredient[];
};

type SalesRow = { recipeId: string; recipeName: string; unitsSold: number };

const STORES = ['Eschborn', 'Taunus', 'Westend'] as const;
type Store = typeof STORES[number];

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtPeriodLabel(key: string, mode: 'week' | 'month'): string {
  if (mode === 'week') {
    const [yr, w] = key.split('-W');
    return `KW${w} ${yr}`;
  }
  const [yr, mo] = key.split('-');
  return `${MONTH_LABELS[parseInt(mo) - 1]} ${yr}`;
}

function fmtEur(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function varianceColor(pct: number | null) {
  if (pct === null) return 'text-gray-400';
  if (pct <= 5)  return 'text-green-600';
  if (pct <= 15) return 'text-amber-600';
  return 'text-red-600';
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function StoreYieldPage() {
  const [store, setStore]       = useState<Store>('Eschborn');
  const [timeMode, setTimeMode] = useState<'week' | 'month'>('month');
  const [period, setPeriod]     = useState<string>('');
  const [salesRows, setSalesRows] = useState<SalesRow[]>([]);

  /* ─ Fetch recipes with ingredients ─ */
  const { data: recipes = [] } = useQuery<Recipe[]>({
    queryKey: ['recipes-with-ingredients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipes')
        .select('id, name, recipe_ingredients(quantity, item:items(name, unit:units_of_measure(abbreviation)))')
        .order('name');
      if (error) throw error;
      return (data ?? []) as unknown as Recipe[];
    },
  });

  /* ─ Fetch bill lines for this store ─ */
  const { data: billLines = [], isLoading: loadingBills } = useQuery<BillLine[]>({
    queryKey: ['yield-bills', store],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bill_lines')
        .select('description, quantity, unit_price, line_total, bill:bills!inner(invoice_date, location_label)')
        .eq('bills.location_label', store);
      if (error) throw error;
      return (data ?? []) as unknown as BillLine[];
    },
  });

  /* ─ Available periods from bill data ─ */
  const availablePeriods = useMemo(() => {
    const set = new Set<string>();
    for (const l of billLines) {
      if (l.bill.invoice_date) {
        set.add(timeMode === 'week' ? isoWeekKey(l.bill.invoice_date) : monthKey(l.bill.invoice_date));
      }
    }
    return Array.from(set).sort().reverse();
  }, [billLines, timeMode]);

  // Auto-select latest period
  const selectedPeriod = period || availablePeriods[0] || '';

  /* ─ Actual deliveries for the selected period ─ */
  const actualLines = useMemo(() => {
    return billLines.filter((l) => {
      if (!l.bill.invoice_date) return false;
      const pk = timeMode === 'week' ? isoWeekKey(l.bill.invoice_date) : monthKey(l.bill.invoice_date);
      return pk === selectedPeriod;
    });
  }, [billLines, selectedPeriod, timeMode]);

  /* ─ Aggregate actual by description ─ */
  const actualByItem = useMemo(() => {
    const map = new Map<string, { qty: number; cost: number }>();
    for (const l of actualLines) {
      const cur = map.get(l.description) ?? { qty: 0, cost: 0 };
      map.set(l.description, { qty: cur.qty + l.quantity, cost: cur.cost + l.line_total });
    }
    return Array.from(map.entries())
      .map(([desc, v]) => ({ description: desc, ...v }))
      .sort((a, b) => b.cost - a.cost);
  }, [actualLines]);

  const actualTotal = actualByItem.reduce((s, r) => s + r.cost, 0);

  /* ─ Theoretical: sales × recipe ingredients ─ */
  const theoreticalByItem = useMemo(() => {
    const map = new Map<string, { qty: number }>();
    for (const row of salesRows) {
      if (!row.unitsSold || row.unitsSold <= 0) continue;
      const recipe = recipes.find((r) => r.id === row.recipeId);
      if (!recipe) continue;
      for (const ing of recipe.recipe_ingredients) {
        if (!ing.item?.name) continue;
        const cur = map.get(ing.item.name) ?? { qty: 0 };
        map.set(ing.item.name, { qty: cur.qty + ing.quantity * row.unitsSold });
      }
    }
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v }));
  }, [salesRows, recipes]);

  /* ─ Match theoretical ingredients to actual deliveries for variance ─ */
  const varianceRows = useMemo(() => {
    if (theoreticalByItem.length === 0 || actualByItem.length === 0) return [];
    return actualByItem.map((actual) => {
      const theo = theoreticalByItem.find((t) =>
        actual.description.toLowerCase().includes(t.name.toLowerCase()) ||
        t.name.toLowerCase().includes(actual.description.toLowerCase().split(' ')[0])
      );
      const theoQty  = theo?.qty ?? null;
      const waste    = theoQty !== null ? actual.qty - theoQty : null;
      const wastePct = theoQty !== null && theoQty > 0 ? ((actual.qty - theoQty) / theoQty) * 100 : null;
      return { ...actual, theoQty, waste, wastePct };
    });
  }, [actualByItem, theoreticalByItem]);

  const hasTheo = salesRows.some((r) => r.unitsSold > 0);

  /* ─ Sales row management ─ */
  const addSalesRow = () => {
    if (recipes.length === 0) return;
    setSalesRows((prev) => [...prev, { recipeId: recipes[0].id, recipeName: recipes[0].name, unitsSold: 0 }]);
  };
  const removeSalesRow = (i: number) => setSalesRows((prev) => prev.filter((_, idx) => idx !== i));
  const updateSalesRow = (i: number, patch: Partial<SalesRow>) =>
    setSalesRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const theoreticalTotal = hasTheo
    ? varianceRows.reduce((s, r) => s + (r.theoQty !== null ? (r.theoQty / r.qty) * r.cost : 0), 0)
    : null;
  const wasteTotal = theoreticalTotal !== null ? actualTotal - theoreticalTotal : null;
  const wastePctTotal = theoreticalTotal && theoreticalTotal > 0
    ? ((actualTotal - theoreticalTotal) / theoreticalTotal) * 100
    : null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <BarChart3 size={20} className="text-[#1B5E20]" />
        <h1 className="text-2xl font-bold text-gray-900">Store Yield</h1>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Store tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {STORES.map((s) => (
            <button key={s} onClick={() => setStore(s)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                store === s ? 'bg-white text-[#1B5E20] shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'
              }`}>{s}</button>
          ))}
        </div>

        {/* Time mode */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {(['month', 'week'] as const).map((m) => (
            <button key={m} onClick={() => { setTimeMode(m); setPeriod(''); }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                timeMode === m ? 'bg-white text-[#1B5E20] shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>{m === 'month' ? 'By Month' : 'By Week'}</button>
          ))}
        </div>

        {/* Period picker */}
        {availablePeriods.length > 0 && (
          <select value={selectedPeriod} onChange={(e) => setPeriod(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30">
            {availablePeriods.map((p) => (
              <option key={p} value={p}>{fmtPeriodLabel(p, timeMode)}</option>
            ))}
          </select>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Actual Deliveries</p>
          <p className="text-2xl font-bold text-gray-900">{fmtEur(actualTotal)}</p>
          <p className="text-xs text-gray-400 mt-1">{actualByItem.length} line items · {store}</p>
        </div>
        <div className={`bg-white rounded-xl border shadow-sm p-4 ${hasTheo ? 'border-gray-100' : 'border-dashed border-gray-200'}`}>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Theoretical Usage</p>
          {hasTheo ? (
            <>
              <p className="text-2xl font-bold text-blue-700">{theoreticalTotal !== null ? fmtEur(theoreticalTotal) : '—'}</p>
              <p className="text-xs text-gray-400 mt-1">Based on sales × recipes</p>
            </>
          ) : (
            <p className="text-sm text-gray-400 mt-1">Enter sales data below ↓</p>
          )}
        </div>
        <div className={`bg-white rounded-xl border shadow-sm p-4 ${wasteTotal !== null ? (wasteTotal > 0 ? 'border-red-100 bg-red-50/30' : 'border-green-100 bg-green-50/30') : 'border-dashed border-gray-200'}`}>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Waste (Gap)</p>
          {wasteTotal !== null ? (
            <>
              <p className={`text-2xl font-bold ${wasteTotal > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {wasteTotal > 0 ? '+' : ''}{fmtEur(wasteTotal)}
              </p>
              <p className={`text-xs mt-1 font-medium ${varianceColor(wastePctTotal)}`}>
                {wastePctTotal !== null ? `${wastePctTotal > 0 ? '+' : ''}${wastePctTotal.toFixed(1)}% vs theoretical` : ''}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400 mt-1">Needs sales data</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">

        {/* ── LEFT: Actual Deliveries ── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Actual Deliveries</h2>
            <span className="text-xs text-gray-400">supplier invoices + ZK</span>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {loadingBills ? (
              <div className="p-4 space-y-2">
                {[...Array(5)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
              </div>
            ) : actualByItem.length === 0 ? (
              <div className="p-8 text-center">
                <AlertTriangle size={28} className="mx-auto text-gray-200 mb-2" />
                <p className="text-sm text-gray-400">No bills found for {store} in this period.</p>
                <p className="text-xs text-gray-300 mt-1">Upload invoices in the Bills section.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Item</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Qty</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {actualByItem.map((row, i) => (
                    <tr key={i} className="border-t border-gray-50 hover:bg-gray-50/40">
                      <td className="px-4 py-2 text-gray-800">{row.description}</td>
                      <td className="px-3 py-2 text-right text-gray-500 tabular-nums">{row.qty.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-800">{fmtEur(row.cost)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                    <td className="px-4 py-2 text-xs text-gray-600 uppercase tracking-wide">Total</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right text-[#1B5E20] tabular-nums">{fmtEur(actualTotal)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── RIGHT: Theoretical (Sales Input) ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Theoretical Usage</h2>
              <p className="text-xs text-gray-400">Sales × recipe ingredients</p>
            </div>
            <button onClick={addSalesRow} disabled={recipes.length === 0}
              className="flex items-center gap-1.5 text-xs font-medium text-[#1B5E20] border border-[#1B5E20]/30 rounded-lg px-3 py-1.5 hover:bg-green-50 transition-colors disabled:opacity-40">
              <Plus size={13} /> Add Menu Item
            </button>
          </div>

          {recipes.length === 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
              <Info size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                No recipes found. Set up your recipes in <strong>Production → Recipes</strong> to enable theoretical cost calculation.
              </p>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {salesRows.length === 0 ? (
              <div className="p-8 text-center">
                <Info size={28} className="mx-auto text-gray-200 mb-2" />
                <p className="text-sm text-gray-400 mb-1">Enter what was sold during this period.</p>
                <p className="text-xs text-gray-300">
                  Select a menu item, enter units sold — the system uses your recipes to calculate ingredient usage.
                </p>
                {recipes.length > 0 && (
                  <button onClick={addSalesRow}
                    className="mt-4 flex items-center gap-1.5 mx-auto text-sm font-medium text-[#1B5E20] hover:underline">
                    <Plus size={14} /> Add first item
                  </button>
                )}
              </div>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Menu Item</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase w-24">Units Sold</th>
                      <th className="px-2 py-2.5 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {salesRows.map((row, i) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="px-4 py-2">
                          <select
                            value={row.recipeId}
                            onChange={(e) => {
                              const r = recipes.find((r) => r.id === e.target.value);
                              if (r) updateSalesRow(i, { recipeId: r.id, recipeName: r.name });
                            }}
                            className="w-full border border-gray-200 rounded-md px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30">
                            {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number" min={0} step={1}
                            value={row.unitsSold || ''}
                            onChange={(e) => updateSalesRow(i, { unitsSold: parseFloat(e.target.value) || 0 })}
                            className="w-full border border-gray-200 rounded-md px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <button onClick={() => removeSalesRow(i)} className="text-gray-300 hover:text-red-400 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Calculated ingredient breakdown */}
                {hasTheo && theoreticalByItem.length > 0 && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-blue-50/30">
                    <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">Calculated Ingredient Usage</p>
                    <div className="space-y-1">
                      {theoreticalByItem.map((item, i) => (
                        <div key={i} className="flex justify-between text-xs text-gray-600">
                          <span>{item.name}</span>
                          <span className="tabular-nums font-medium">{item.qty.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Variance / Waste table ── */}
      {hasTheo && varianceRows.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Waste Analysis</h2>
            <span className="text-xs text-gray-400">Actual vs Theoretical — gap = Waste</span>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-700 text-white">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Item</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide">Actual Qty</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide">Theoretical Qty</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide">Waste Qty</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide">Actual Cost</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide bg-gray-600">Waste %</th>
                </tr>
              </thead>
              <tbody>
                {varianceRows.map((row, i) => (
                  <tr key={i} className={`border-t border-gray-50 hover:bg-gray-50/40 ${row.wastePct !== null && row.wastePct > 15 ? 'bg-red-50/20' : ''}`}>
                    <td className="px-4 py-2.5 text-gray-800">{row.description}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{row.qty.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-blue-700">
                      {row.theoQty !== null ? row.theoQty.toFixed(2) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {row.waste !== null ? (
                        <span className={row.waste > 0 ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                          {row.waste > 0 ? '+' : ''}{row.waste.toFixed(2)}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{fmtEur(row.cost)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {row.wastePct !== null ? (
                        <span className={`text-sm font-semibold ${varianceColor(row.wastePct)}`}>
                          {row.wastePct > 0 ? '+' : ''}{row.wastePct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-gray-300 text-sm">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-4 py-2.5 text-xs text-gray-600 uppercase tracking-wide">Total</td>
                  <td colSpan={3} className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">{fmtEur(actualTotal)}</td>
                  <td className={`px-3 py-2.5 text-right text-sm font-bold ${varianceColor(wastePctTotal)}`}>
                    {wastePctTotal !== null ? `${wastePctTotal > 0 ? '+' : ''}${wastePctTotal.toFixed(1)}%` : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> &lt;5% — On target</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> 5–15% — Monitor</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> &gt;15% — Investigate</span>
          </div>
        </div>
      )}
    </div>
  );
}
