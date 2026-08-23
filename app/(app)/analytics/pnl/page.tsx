'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';

/* ── Period helpers (copied from cashflow page) ─────────────────────── */
type Period = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'H1' | 'H2' |
  'Jan' | 'Feb' | 'Mar' | 'Apr' | 'May' | 'Jun' |
  'Jul' | 'Aug' | 'Sep' | 'Oct' | 'Nov' | 'Dec';

const QUARTER_PERIODS: Record<string, Period[]> = {
  Q1: ['Jan','Feb','Mar'], Q2: ['Apr','May','Jun'],
  Q3: ['Jul','Aug','Sep'], Q4: ['Oct','Nov','Dec'],
  H1: ['Jan','Feb','Mar','Apr','May','Jun'],
  H2: ['Jul','Aug','Sep','Oct','Nov','Dec'],
};

const MONTH_NUM: Record<string, number> = {
  Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,
  Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12,
};

const ALL_MONTHS: Period[] = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const QUARTERS: Period[]   = ['Q1','Q2','Q3','Q4'];

function periodDateRange(year: number, period: Period) {
  if (period in QUARTER_PERIODS) {
    const months = QUARTER_PERIODS[period];
    const first  = MONTH_NUM[months[0]];
    const last   = MONTH_NUM[months[months.length - 1]];
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

/* ── VAT helpers ──────────────────────────────────────────────────────── */
function defaultVatRate(cat: string | null): number {
  if (!cat) return 0;
  if (cat === 'C - Personnel' || cat === 'C - Financing') return 0;
  if (cat.startsWith('C - ')) return 19;
  if (cat.startsWith('S - ')) return 10;
  return 0;
}

function bucketVat(rows: { category: string | null; total_cents: number }[]) {
  let bruttoAbs = 0, mwstAbs = 0;
  for (const r of rows) {
    const rate = defaultVatRate(r.category);
    mwstAbs   += rate === 0 ? 0 : Math.round(r.total_cents * rate / (100 + rate));
    bruttoAbs += r.total_cents;
  }
  const nettoAbs   = bruttoAbs - mwstAbs;
  const blendedPct = nettoAbs > 0 ? (mwstAbs / nettoAbs * 100) : 0;
  return { bruttoAbs, mwstAbs, nettoAbs, blendedPct };
}

/* ── Formatters ───────────────────────────────────────────────────────── */
function eur(cents: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/* ── Main page ─────────────────────────────────────────────────────────── */
export default function GroupPnlPage() {
  const [selectedYear,   setSelectedYear]   = useState(2026);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('Q1');
  const availableYears = [2025, 2026];

  const { dateFrom, dateTo } = periodDateRange(selectedYear, selectedPeriod);

  const activeQuarterMonths: Period[] = selectedPeriod in QUARTER_PERIODS
    ? QUARTER_PERIODS[selectedPeriod]
    : (Object.entries(QUARTER_PERIODS).find(([, ms]) => ms.includes(selectedPeriod as Period))?.[1] ?? []);

  type AggRow = { category: string | null; direction: 'in' | 'out'; total_cents: number };

  const { data: aggRows = [], isFetching } = useQuery<AggRow[]>({
    queryKey: ['cashflow-agg', dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/cashflow/aggregate?dateFrom=${dateFrom}&dateTo=${dateTo}`);
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    },
  });

  /* ── P&L derivations ──────────────────────────────────────────────── */
  const signed = (t: AggRow) => t.direction === 'in' ? t.total_cents : -t.total_cents;
  const catNetSum = (cat: string) =>
    aggRows.filter(t => t.category === cat).reduce((s, t) => s + signed(t), 0);

  const totalIn  = aggRows.filter(t => t.direction === 'in').reduce((s,t)  => s + t.total_cents, 0);
  const totalOut = aggRows.filter(t => t.direction === 'out').reduce((s,t) => s + t.total_cents, 0);
  const net      = totalIn - totalOut;

  const plSales     = aggRows.filter(t => (t.category ?? '').startsWith('S - ')).reduce((s,t) => s + signed(t), 0);
  const plCogs      = catNetSum('C - Suppliers');
  const plStaff     = catNetSum('C - Personnel');
  const plRent      = catNetSum('C - Rent');
  const plFinancing = catNetSum('C - Financing');
  const plOther     = aggRows.filter(t =>
    (t.category ?? '').startsWith('C - ') &&
    !['C - Suppliers','C - Personnel','C - Rent','C - Financing'].includes(t.category ?? '')
  ).reduce((s,t) => s + signed(t), 0);
  const plFcf          = plSales + plCogs + plStaff + plRent + plOther;
  const plChangeInCash = plFcf + plFinancing;
  const checkOk        = Math.abs(plChangeInCash - net) < 1;

  const salesVat = bucketVat(aggRows.filter(t => (t.category ?? '').startsWith('S - ')));
  const cogsVat  = bucketVat(aggRows.filter(t => t.category === 'C - Suppliers'));
  const staffVat = bucketVat(aggRows.filter(t => t.category === 'C - Personnel'));
  const rentVat  = bucketVat(aggRows.filter(t => t.category === 'C - Rent'));
  const otherVat = bucketVat(aggRows.filter(t =>
    (t.category ?? '').startsWith('C - ') &&
    !['C - Suppliers','C - Personnel','C - Rent','C - Financing'].includes(t.category ?? '')
  ));

  /* ── Table cell helpers ───────────────────────────────────────────── */
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Group P&amp;L and CFS</h1>
        <p className="text-sm text-gray-500 mt-1">
          {dateFrom} → {dateTo}
          {isFetching && <span className="ml-2 text-gray-400 text-xs">Loading…</span>}
        </p>
      </div>

      {/* Year + Period selector */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide w-12">Year</span>
          <div className="flex gap-2">
            {availableYears.map(y => (
              <button key={y} onClick={() => setSelectedYear(y)}
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
              {QUARTERS.map(q => (
                <button key={q} onClick={() => setSelectedPeriod(q)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                    selectedPeriod === q ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                  }`}>{q}</button>
              ))}
              <div className="w-px bg-gray-200 self-stretch mx-1" />
              {(['H1','H2'] as Period[]).map(h => (
                <button key={h} onClick={() => setSelectedPeriod(h)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                    selectedPeriod === h ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                  }`}>{h}</button>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {ALL_MONTHS.map(m => {
                const isSel = selectedPeriod === m;
                const inQ   = activeQuarterMonths.includes(m);
                return (
                  <button key={m} onClick={() => setSelectedPeriod(m)}
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

      {/* P&L summary table */}
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
    </div>
  );
}
