'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import { TrendingDown, Calendar, CalendarDays, ChevronUp, ChevronDown as ChevronDownIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';

/* ─── Types ──────────────────────────────────────────────────────────────── */
type BillLine = {
  id:          string;
  description: string;
  quantity:    number;
  unit_price:  number;
  line_total:  number;
  vat_rate:    number;
  bill: {
    invoice_date:   string | null;
    location_label: string | null;
    category:       string | null;
  };
};

/* ─── Constants ──────────────────────────────────────────────────────────── */
const PRIMARY_CATEGORIES = ['Food Cost'] as const;

const SUB_CATEGORIES = ['All', 'Fruit & Veg', 'Meat', 'Spices', 'Dairy', 'Leergut', 'Other'] as const;
type SubCategory = typeof SUB_CATEGORIES[number];

// Keyword-based sub-category classifier (German + Spanish food terms)
const SUB_CATEGORY_KEYWORDS: Record<Exclude<SubCategory, 'All' | 'Other'>, string[]> = {
  'Fruit & Veg': [
    'banana', 'banane', 'tomate', 'tomato', 'paprika', 'zwiebel', 'onion', 'cebolla',
    'gurke', 'cucumber', 'avocado', 'limette', 'lime', 'limon', 'limón', 'zitrone',
    'lemon', 'mango', 'ananas', 'pineapple', 'salat', 'lettuce', 'spinat', 'spinach',
    'karotte', 'carrot', 'zanahoria', 'kohl', 'cabbage', 'repollo', 'chayote',
    'courgette', 'zucchini', 'aubergine', 'eggplant', 'berenjena', 'pilze', 'mushroom',
    'seta', 'blumenkohl', 'cauliflower', 'brokkoli', 'broccoli', 'mais', 'corn', 'maiz',
    'gemüse', 'vegetables', 'obst', 'fruit', 'fruta', 'verdura', 'jalapeño', 'jalapeno',
    'habanero', 'chile', 'chili', 'poblano', 'serrano', 'peperoni', 'knoblauch', 'garlic',
    'ajo', 'ingwer', 'ginger', 'jengibre', 'koriander', 'cilantro', 'petersilie',
    'parsley', 'minze', 'mint', 'hierba', 'kräuter', 'herbs',
  ],
  'Meat': [
    'rind', 'beef', 'res', 'carne', 'schwein', 'pork', 'cerdo', 'hähnchen', 'huhn',
    'chicken', 'pollo', 'lamm', 'lamb', 'cordero', 'fleisch', 'meat', 'filet', 'steak',
    'hackfleisch', 'minced', 'molida', 'wurst', 'sausage', 'chorizo', 'bacon',
    'speck', 'schinken', 'ham', 'jamón', 'barbacoa', 'birria', 'carnitas', 'al pastor',
    'costilla', 'ribs', 'rippe', 'geflügel', 'poultry', 'aves', 'truthahn', 'turkey',
    'pavo', 'ente', 'duck', 'pato', 'garnele', 'shrimp', 'camarón', 'fisch', 'fish',
    'pescado', 'lachs', 'salmon', 'salmón', 'thunfisch', 'tuna', 'atún',
  ],
  'Spices': [
    'gewürz', 'spice', 'especias', 'salz', 'salt', 'sal', 'pfeffer', 'pepper', 'pimienta',
    'oregano', 'cumin', 'kreuzkümmel', 'comino', 'paprikapulver', 'paprika powder',
    'chili powder', 'chilipulver', 'zimt', 'cinnamon', 'canela', 'vanille', 'vanilla',
    'vainilla', 'curry', 'kurkuma', 'turmeric', 'cúrcuma', 'koriandersamen', 'coriander',
    'muskat', 'nutmeg', 'nuez moscada', 'lorbeer', 'bay leaf', 'laurel', 'anis', 'anise',
    'thymian', 'thyme', 'tomillo', 'rosmarin', 'rosemary', 'romero', 'majoran',
    'marjoram', 'mejorana', 'sauce', 'soße', 'salsa', 'marinade', 'gewürzmischung',
    'seasoning', 'sazon', 'achiote', 'annatto', 'mole',
  ],
  'Dairy': [
    'milch', 'milk', 'leche', 'sahne', 'cream', 'crema', 'käse', 'cheese', 'queso',
    'quark', 'joghurt', 'yogurt', 'yoghurt', 'butter', 'mantequilla', 'ei', 'egg',
    'huevo', 'eier', 'eggs', 'huevos', 'rahm', 'creme', 'schmand', 'crème fraîche',
    'mozzarella', 'parmesan', 'gouda', 'emmental', 'feta', 'ricotta', 'mascarpone',
    'condensed', 'kondensmilch', 'molke', 'whey',
  ],
  'Leergut': [
    'leergut', 'klappkiste', 'rollcontainer',
  ],
};

const CLASSIFICATION_ORDER: Array<Exclude<SubCategory, 'All' | 'Other'>> = [
  'Leergut', 'Fruit & Veg', 'Meat', 'Spices', 'Dairy',
];

function classifyLine(description: string): Exclude<SubCategory, 'All'> {
  const lower = description.toLowerCase();
  for (const cat of CLASSIFICATION_ORDER) {
    if (SUB_CATEGORY_KEYWORDS[cat].some((kw) => lower.includes(kw))) {
      return cat;
    }
  }
  return 'Other';
}

/* ─── Time helpers ───────────────────────────────────────────────────────── */
function getISOWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function periodKey(dateStr: string, mode: 'week' | 'month'): string {
  const d = new Date(dateStr + 'T00:00:00');
  if (mode === 'week') {
    const { week, year } = getISOWeek(d);
    return `${year}-KW${String(week).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodLabel(key: string, mode: 'week' | 'month'): string {
  if (mode === 'week') {
    const [, kw] = key.split('-');
    return kw; // e.g. "KW03"
  }
  const [year, mo] = key.split('-');
  return `${MONTH_LABELS[parseInt(mo) - 1]} ${year}`;
}

function fmtEur(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function COGSPage() {
  const { t } = useT();
  const [primaryCat]  = useState<string>('Food Cost');
  const [subCat, setSubCat]     = useState<SubCategory>('All');
  const [timeMode, setTimeMode] = useState<'week' | 'month'>('month');
  const [sortKey, setSortKey]   = useState<string>('total');   // 'total' | period key
  const [sortDir, setSortDir]   = useState<'desc' | 'asc'>('desc');

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  /* ─ Fetch all bill lines for Food Cost bills ─ */
  const { data: rawLines = [], isLoading } = useQuery<BillLine[]>({
    queryKey: ['cogs-lines', primaryCat],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bill_lines')
        .select('id, description, quantity, unit_price, line_total, vat_rate, bill:bills!inner(invoice_date, location_label, category)')
        .eq('bills.category', primaryCat);
      if (error) throw error;
      return (data ?? []) as unknown as BillLine[];
    },
  });

  /* ─ Classify and filter ─ */
  const lines = useMemo(() => {
    return rawLines.map((l) => ({
      ...l,
      subCategory: classifyLine(l.description),
    }));
  }, [rawLines]);

  const filtered = useMemo(() => {
    if (subCat === 'All') return lines;
    return lines.filter((l) => l.subCategory === subCat);
  }, [lines, subCat]);

  /* ─ Build pivot ─ */
  const { periods, rows } = useMemo(() => {
    // Collect all time periods that appear in the data
    const periodSet = new Set<string>();
    for (const l of filtered) {
      if (l.bill.invoice_date) periodSet.add(periodKey(l.bill.invoice_date, timeMode));
    }
    const periods = Array.from(periodSet).sort();

    // Group by (description, location)
    type RowKey = string;
    const rowMap = new Map<RowKey, {
      description: string;
      location:    string;
      subCategory: string;
      totals:      Record<string, number>;
      rowTotal:    number;
    }>();

    for (const l of filtered) {
      if (!l.bill.invoice_date) continue;
      const pk  = periodKey(l.bill.invoice_date, timeMode);
      const loc = l.bill.location_label ?? '—';
      const key = `${l.description}||${loc}`;
      if (!rowMap.has(key)) {
        rowMap.set(key, { description: l.description, location: loc, subCategory: l.subCategory, totals: {}, rowTotal: 0 });
      }
      const row = rowMap.get(key)!;
      row.totals[pk] = (row.totals[pk] ?? 0) + l.line_total;
      row.rowTotal  += l.line_total;
    }

    // Sort rows by description then location
    const rows = Array.from(rowMap.values()).sort((a, b) =>
      a.description.localeCompare(b.description) || a.location.localeCompare(b.location)
    );

    return { periods, rows };
  }, [filtered, timeMode]);

  /* ─ Sorted rows ─ */
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aVal = sortKey === 'total' ? a.rowTotal : (a.totals[sortKey] ?? 0);
      const bVal = sortKey === 'total' ? b.rowTotal : (b.totals[sortKey] ?? 0);
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
    });
  }, [rows, sortKey, sortDir]);

  /* ─ Period totals (column sums) ─ */
  const colTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const row of rows) {
      for (const [pk, val] of Object.entries(row.totals)) {
        t[pk] = (t[pk] ?? 0) + val;
      }
    }
    return t;
  }, [rows]);

  const grandTotal = rows.reduce((s, r) => s + r.rowTotal, 0);

  const SUB_CAT_COLORS: Record<SubCategory, string> = {
    'All':         'bg-gray-800 text-white',
    'Fruit & Veg': 'bg-green-600 text-white',
    'Meat':        'bg-red-700 text-white',
    'Spices':      'bg-amber-600 text-white',
    'Dairy':       'bg-blue-500 text-white',
    'Leergut':     'bg-amber-900 text-white',
    'Other':       'bg-gray-500 text-white',
  };
  const SUB_CAT_INACTIVE: Record<SubCategory, string> = {
    'All':         'bg-gray-100 text-gray-600 hover:bg-gray-200',
    'Fruit & Veg': 'bg-green-50 text-green-700 hover:bg-green-100',
    'Meat':        'bg-red-50 text-red-700 hover:bg-red-100',
    'Spices':      'bg-amber-50 text-amber-700 hover:bg-amber-100',
    'Dairy':       'bg-blue-50 text-blue-700 hover:bg-blue-100',
    'Leergut':     'bg-amber-100 text-amber-900 hover:bg-amber-200',
    'Other':       'bg-gray-50 text-gray-600 hover:bg-gray-100',
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <ChevronDownIcon size={10} className="opacity-30 ml-0.5" />;
    return sortDir === 'desc'
      ? <ChevronDownIcon size={10} className="opacity-90 ml-0.5" />
      : <ChevronUp size={10} className="opacity-90 ml-0.5" />;
  };

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center gap-2 mb-6">
        <TrendingDown size={20} className="text-[#1B5E20]" />
        <h1 className="text-2xl font-bold text-gray-900">{t('analysis.cogsAnalysis')}</h1>
      </div>

      {/* Primary category tabs */}
      <div className="flex gap-2 mb-5">
        {PRIMARY_CATEGORIES.map((cat) => (
          <div
            key={cat}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#1B5E20] text-white shadow-sm"
          >
            {cat}
          </div>
        ))}
        <div className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 border border-dashed border-gray-200 cursor-default">
          {t('analysis.moreComing')}
        </div>
      </div>

      {/* Sub-category pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        {SUB_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setSubCat(cat)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              subCat === cat ? SUB_CAT_COLORS[cat] : SUB_CAT_INACTIVE[cat]
            }`}
          >
            {cat}
            {cat !== 'All' && (
              <span className="ml-1.5 opacity-70 text-xs">
                ({lines.filter((l) => l.subCategory === cat).length})
              </span>
            )}
            {cat === 'All' && (
              <span className="ml-1.5 opacity-70 text-xs">({lines.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Time mode toggle + summary */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setTimeMode('month')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              timeMode === 'month' ? 'bg-white text-[#1B5E20] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Calendar size={12} /> {t('analysis.byMonth')}
          </button>
          <button
            onClick={() => setTimeMode('week')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              timeMode === 'week' ? 'bg-white text-[#1B5E20] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <CalendarDays size={12} /> {t('analysis.byWeek')}
          </button>
        </div>
        {!isLoading && (
          <div className="text-xs text-gray-500">
            <span className="font-semibold text-gray-900">{rows.length}</span> item-location combinations ·{' '}
            Total: <span className="font-semibold text-[#1B5E20]">{fmtEur(grandTotal)} €</span>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${50 + (i % 4) * 12}%` }} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <TrendingDown size={36} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm text-gray-400">
              {rawLines.length === 0
                ? 'No Food Cost bills saved yet. Upload and save invoices from the Bills page.'
                : `No items classified as "${subCat}" yet.`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-700 text-white">
                  <th className="sticky left-0 z-10 bg-gray-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide min-w-[220px]">
                    {t('analysis.item')}
                  </th>
                  <th className="sticky left-[220px] z-10 bg-gray-700 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide min-w-[110px] border-l border-gray-600">
                    {t('analysis.location')}
                  </th>
                  {subCat === 'All' && (
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide min-w-[100px] border-l border-gray-600">
                      {t('analysis.category')}
                    </th>
                  )}
                  {periods.map((pk) => (
                    <th
                      key={pk}
                      onClick={() => handleSort(pk)}
                      className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide min-w-[80px] border-l border-gray-600 cursor-pointer hover:bg-gray-600 select-none"
                    >
                      <span className="inline-flex items-center justify-end gap-0.5">
                        {periodLabel(pk, timeMode)}<SortIcon col={pk} />
                      </span>
                    </th>
                  ))}
                  <th
                    onClick={() => handleSort('total')}
                    className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide min-w-[90px] border-l border-gray-500 bg-gray-600 cursor-pointer hover:bg-gray-500 select-none"
                  >
                    <span className="inline-flex items-center justify-end gap-0.5">
                      {t('analysis.total')}<SortIcon col="total" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => (
                  <tr key={i} className="border-t border-gray-50 hover:bg-gray-50/40">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-sm text-gray-800 border-r border-gray-100 hover:bg-gray-50/40 min-w-[220px]">
                      {row.description}
                    </td>
                    <td className="sticky left-[220px] z-10 bg-white px-3 py-2.5 text-xs text-gray-500 border-r border-gray-200 hover:bg-gray-50/40 min-w-[110px]">
                      {row.location}
                    </td>
                    {subCat === 'All' && (
                      <td className="px-3 py-2.5 text-xs border-r border-gray-100">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SUB_CAT_COLORS[row.subCategory as SubCategory]}`}>
                          {row.subCategory}
                        </span>
                      </td>
                    )}
                    {periods.map((pk) => (
                      <td key={pk} className="px-3 py-2.5 text-right text-sm tabular-nums text-gray-700 border-l border-gray-50">
                        {row.totals[pk] ? fmtEur(row.totals[pk]) : ''}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-[#1B5E20] border-l border-gray-200 bg-green-50/30">
                      {fmtEur(row.rowTotal)}
                    </td>
                  </tr>
                ))}

                {/* Column totals footer */}
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className="sticky left-0 z-10 bg-gray-50 px-4 py-2.5 text-xs text-gray-600 uppercase tracking-wide">
                    {t('analysis.total')}
                  </td>
                  <td className="sticky left-[220px] z-10 bg-gray-50 px-3 py-2.5 border-r border-gray-200" />
                  {subCat === 'All' && <td className="px-3 py-2.5 border-r border-gray-100" />}
                  {periods.map((pk) => (
                    <td key={pk} className="px-3 py-2.5 text-right text-sm tabular-nums text-gray-800 border-l border-gray-100">
                      {colTotals[pk] ? fmtEur(colTotals[pk]) : ''}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums text-[#1B5E20] border-l border-gray-200 bg-green-100/40">
                    {fmtEur(grandTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
