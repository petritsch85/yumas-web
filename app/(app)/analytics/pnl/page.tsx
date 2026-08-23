'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

type AggRow = { category: string | null; direction: 'in' | 'out'; total_cents: number };

/* ── VAT / bucketing helpers ───────────────────────────────────────── */
function vatRate(cat: string | null): number {
  if (!cat) return 0;
  if (cat === 'C - Personnel' || cat === 'C - Financing') return 0;
  if (cat.startsWith('C - ')) return 19;
  if (cat.startsWith('S - ')) return 10;
  return 0;
}

function bucketVat(rows: AggRow[]) {
  let brutto = 0, mwst = 0;
  for (const r of rows) {
    const rate = vatRate(r.category);
    mwst   += rate === 0 ? 0 : Math.round(r.total_cents * rate / (100 + rate));
    brutto += r.total_cents;
  }
  return { brutto, mwst, netto: brutto - mwst };
}

function mergeMonths(monthData: AggRow[][], indices: number[]): AggRow[] {
  const map = new Map<string, AggRow>();
  for (const i of indices) {
    for (const r of (monthData[i] ?? [])) {
      const key = `${r.category ?? ''}|${r.direction}`;
      const ex  = map.get(key);
      if (ex) ex.total_cents += r.total_cents;
      else    map.set(key, { ...r });
    }
  }
  return [...map.values()];
}

type PL = {
  salesBrutto: number; mwst: number; mwstPct: number | null; salesNetto: number;
  cogsNetto: number; cogsPct: number | null; grossMarginPct: number | null;
  staff: number; staffPct: number | null;
  rent: number;  rentPct: number | null;
  other: number; otherPct: number | null;
  fcf: number;   fcfPct: number | null;
};

function computePL(rows: AggRow[]): PL {
  const signed = (t: AggRow) => t.direction === 'in' ? t.total_cents : -t.total_cents;
  const catSum = (cat: string) =>
    rows.filter(t => t.category === cat).reduce((s, t) => s + signed(t), 0);

  const sv = bucketVat(rows.filter(t => (t.category ?? '').startsWith('S - ')));
  const cv = bucketVat(rows.filter(t => t.category === 'C - Suppliers'));
  const otherRows = rows.filter(t =>
    (t.category ?? '').startsWith('C - ') &&
    !['C - Suppliers','C - Personnel','C - Rent','C - Financing'].includes(t.category ?? ''),
  );

  const plSales = sv.brutto;   // "Value" = brutto (signed)
  const plStaff = catSum('C - Personnel');
  const plRent  = catSum('C - Rent');
  const plOther = otherRows.reduce((s, t) => s + signed(t), 0);
  const fcf     = plSales + catSum('C - Suppliers') + plStaff + plRent + plOther;

  const pctB = (v: number) => plSales > 0 ? Math.abs(v) / plSales * 100 : null;
  const pctN = (v: number) => sv.netto > 0 ? Math.abs(v) / sv.netto * 100 : null;

  return {
    salesBrutto:    sv.brutto,
    mwst:           sv.mwst,
    mwstPct:        sv.netto > 0 ? sv.mwst / sv.netto * 100 : null,
    salesNetto:     sv.netto,
    cogsNetto:      cv.netto,
    cogsPct:        pctN(cv.netto),
    grossMarginPct: sv.netto > 0 ? (sv.netto - cv.netto) / sv.netto * 100 : null,
    staff:    Math.abs(plStaff),   staffPct: pctB(plStaff),
    rent:     Math.abs(plRent),    rentPct:  pctB(plRent),
    other:    Math.abs(plOther),   otherPct: pctB(plOther),
    fcf,                           fcfPct:   pctB(fcf),
  };
}

/* ── Formatters ────────────────────────────────────────────────────── */
const fmtAmt = (cents: number) =>
  (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

/* ── Column definitions ────────────────────────────────────────────── */
type ColDef = { label: string; indices: number[]; summary: boolean };
const COLS: ColDef[] = [
  { label: 'Jan', indices: [0],              summary: false },
  { label: 'Feb', indices: [1],              summary: false },
  { label: 'Mar', indices: [2],              summary: false },
  { label: 'Q1',  indices: [0,1,2],          summary: true  },
  { label: 'Apr', indices: [3],              summary: false },
  { label: 'May', indices: [4],              summary: false },
  { label: 'Jun', indices: [5],              summary: false },
  { label: 'Q2',  indices: [3,4,5],          summary: true  },
  { label: 'H1',  indices: [0,1,2,3,4,5],   summary: true  },
  { label: 'Jul', indices: [6],              summary: false },
  { label: 'Aug', indices: [7],              summary: false },
  { label: 'Sep', indices: [8],              summary: false },
  { label: 'Q3',  indices: [6,7,8],          summary: true  },
  { label: 'Oct', indices: [9],              summary: false },
  { label: 'Nov', indices: [10],             summary: false },
  { label: 'Dec', indices: [11],             summary: false },
  { label: 'Q4',  indices: [9,10,11],        summary: true  },
  { label: 'H2',  indices: [6,7,8,9,10,11], summary: true  },
  { label: 'FY',  indices: [0,1,2,3,4,5,6,7,8,9,10,11], summary: true },
];

function monthRange(year: number, monthIdx: number) {
  const m = monthIdx + 1;
  return {
    dateFrom: `${year}-${String(m).padStart(2,'0')}-01`,
    dateTo:   `${year}-${String(m).padStart(2,'0')}-${new Date(year, m, 0).getDate()}`,
  };
}

/* ── Page ──────────────────────────────────────────────────────────── */
export default function GroupPnlPage() {
  const [year, setYear] = useState(2026);
  const availableYears  = [2025, 2026];

  const { data: monthData = [], isFetching } = useQuery<AggRow[][]>({
    queryKey: ['pnl-monthly', year],
    queryFn: async () => {
      return Promise.all(
        Array.from({ length: 12 }, (_, i) => {
          const { dateFrom, dateTo } = monthRange(year, i);
          return fetch(`/api/cashflow/aggregate?dateFrom=${dateFrom}&dateTo=${dateTo}`)
            .then(r => r.json())
            .then(j => (Array.isArray(j) ? j : []) as AggRow[]);
        }),
      );
    },
    staleTime: 60_000,
  });

  const colPLs = useMemo(() =>
    COLS.map(col => computePL(mergeMonths(monthData, col.indices))),
  [monthData]);

  /* ── Cell renderers ─────────────────────────────────────────────── */
  const th = (label: string, summary: boolean) => (
    <th className={`px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wide whitespace-nowrap sticky top-0 z-10
      ${summary ? 'bg-gray-100 text-gray-700' : 'bg-gray-50 text-gray-500'}`}>
      {label}
    </th>
  );

  const amtCell = (cents: number, bold = false, summary = false, color?: string) => (
    <td className={`px-2 py-1.5 text-right text-xs tabular-nums whitespace-nowrap
      ${summary ? 'bg-gray-50 font-semibold' : ''}
      ${bold ? 'font-bold' : ''}
      ${color ?? 'text-gray-700'}`}>
      {fmtAmt(cents)}
    </td>
  );

  const pctCell = (v: number | null, summary = false) => (
    <td className={`px-2 py-1.5 text-right text-xs tabular-nums text-gray-500 whitespace-nowrap
      ${summary ? 'bg-gray-50' : ''}`}>
      {fmtPct(v)}
    </td>
  );

  const blankCell = (summary = false) => (
    <td className={`px-2 py-1 ${summary ? 'bg-gray-50' : ''}`} />
  );

  const fcfColor = (pl: PL) => pl.fcf >= 0 ? 'text-green-700' : 'text-red-700';

  const rowLabel   = (label: string, bold = false, indent = false) => (
    <td className={`px-3 py-1.5 text-xs whitespace-nowrap sticky left-0 z-20 bg-white border-r border-gray-200
      ${bold ? 'font-bold text-gray-900' : 'text-gray-500'}
      ${indent ? 'pl-6 italic' : ''}`}>
      {label}
    </td>
  );

  const spacerRow = (
    <tr key="spacer" className="h-2">
      <td className="sticky left-0 z-20 bg-white border-r border-gray-200" />
      {COLS.map(c => <td key={c.label} className={c.summary ? 'bg-gray-50' : ''} />)}
    </tr>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Group P&amp;L and CFS</h1>
          {isFetching && <p className="text-xs text-gray-400 mt-1">Loading…</p>}
        </div>
        {/* Year selector */}
        <div className="flex gap-2">
          {availableYears.map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
                year === y ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
              }`}>{y}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse" style={{ minWidth: '2000px' }}>
            <thead>
              <tr>
                {/* Sticky row-label column header */}
                <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500
                  bg-gray-50 sticky left-0 z-30 border-r border-b border-gray-200 w-36">
                  P&amp;L
                </th>
                {COLS.map(c => (
                  <th key={c.label}
                    className={`px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wide whitespace-nowrap border-b border-gray-200
                      ${c.summary ? 'bg-gray-100 text-gray-700' : 'bg-gray-50 text-gray-500'}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">

              {/* Sales (Brutto) */}
              <tr className="hover:bg-gray-50/40">
                {rowLabel('Sales (Brutto)', true)}
                {colPLs.map((pl, i) => amtCell(pl.salesBrutto, true, COLS[i].summary, 'text-green-700'))}
              </tr>

              {/* MwSt */}
              <tr className="hover:bg-gray-50/40">
                {rowLabel('MwSt', false, true)}
                {colPLs.map((pl, i) => amtCell(pl.mwst, false, COLS[i].summary))}
              </tr>

              {/* MwSt (%) */}
              <tr className="hover:bg-gray-50/40">
                {rowLabel('MwSt (%)', false, true)}
                {colPLs.map((pl, i) => pctCell(pl.mwstPct, COLS[i].summary))}
              </tr>

              {/* Sales (Netto) */}
              <tr className="hover:bg-gray-50/40">
                {rowLabel('Sales (Netto)', true)}
                {colPLs.map((pl, i) => amtCell(pl.salesNetto, true, COLS[i].summary, 'text-green-700'))}
              </tr>

              {spacerRow}

              {/* COGS */}
              <tr className="hover:bg-gray-50/40">
                {rowLabel('COGS', true)}
                {colPLs.map((pl, i) => amtCell(pl.cogsNetto, true, COLS[i].summary, 'text-red-700'))}
              </tr>

              {/* COGS % */}
              <tr className="hover:bg-gray-50/40">
                {rowLabel('COGS %', false, true)}
                {colPLs.map((pl, i) => pctCell(pl.cogsPct, COLS[i].summary))}
              </tr>

              {/* Gross margin % */}
              <tr className="hover:bg-gray-50/40">
                {rowLabel('Gross margin %', false, true)}
                {colPLs.map((pl, i) => pctCell(pl.grossMarginPct, COLS[i].summary))}
              </tr>

              {spacerRow}

              {/* Staff */}
              <tr className="hover:bg-gray-50/40">
                {rowLabel('Staff', true)}
                {colPLs.map((pl, i) => amtCell(pl.staff, true, COLS[i].summary, 'text-red-700'))}
              </tr>

              {/* Staff % */}
              <tr className="hover:bg-gray-50/40">
                {rowLabel('as % of sales', false, true)}
                {colPLs.map((pl, i) => pctCell(pl.staffPct, COLS[i].summary))}
              </tr>

              {/* Rent */}
              <tr className="hover:bg-gray-50/40">
                {rowLabel('Rent', true)}
                {colPLs.map((pl, i) => amtCell(pl.rent, true, COLS[i].summary, 'text-red-700'))}
              </tr>

              {/* Rent % */}
              <tr className="hover:bg-gray-50/40">
                {rowLabel('as % of sales', false, true)}
                {colPLs.map((pl, i) => pctCell(pl.rentPct, COLS[i].summary))}
              </tr>

              {/* Other */}
              <tr className="hover:bg-gray-50/40">
                {rowLabel('Other', true)}
                {colPLs.map((pl, i) => amtCell(pl.other, true, COLS[i].summary, 'text-red-700'))}
              </tr>

              {/* Other % */}
              <tr className="hover:bg-gray-50/40">
                {rowLabel('as % of sales', false, true)}
                {colPLs.map((pl, i) => pctCell(pl.otherPct, COLS[i].summary))}
              </tr>

              {spacerRow}

              {/* FCF */}
              <tr className="bg-gray-50 border-t-2 border-gray-300">
                {rowLabel('FCF', true)}
                {colPLs.map((pl, i) => amtCell(pl.fcf, true, COLS[i].summary, fcfColor(pl)))}
              </tr>

            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
