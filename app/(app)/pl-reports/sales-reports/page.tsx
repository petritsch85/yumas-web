'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Upload, FileCheck, AlertCircle, DatabaseZap,
  MapPin, CalendarDays, BarChart3, TableProperties,
  ChevronLeft, ChevronRight, TrendingUp, Receipt, Percent, Euro,
  Loader2,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Location = { id: string; name: string };

type WeekData = {
  week_start:       string;
  week_end:         string | null;
  total_revenue:    number;
  gross_food:       number;
  gross_drinks:     number;
  net_revenue:      number;
  tax_total:        number;
  tips:             number;
  inhouse_revenue:  number;
  takeaway_revenue: number;
};

type ShiftRow = {
  report_date:         string;
  z_report_number:     string;
  gross_total:         number;
  gross_food:          number;
  gross_beverages:     number;
  net_total:           number;
  vat_total:           number;
  tips:                number;
  inhouse_total:       number;
  takeaway_total:      number;
  cancellations_count: number;
  cancellations_total: number;
};

type DayAgg = {
  shiftCount:          number;
  grossTotal:          number;
  grossFood:           number;
  grossDrinks:         number;
  netTotal:            number;
  vatTotal:            number;
  tips:                number;
  inhouseTotal:        number;
  takeawayTotal:       number;
  cancellationsCount:  number;
  cancellationsTotal:  number;
};

type ProductRow = {
  item_name:        string;
  category:         string | null;
  quantity:         number;
  unit_price:       number;
  total_price:      number;
  inhouse_revenue:  number;
  takeaway_revenue: number;
};

type WeeklySummary = {
  weekStart:     string | null;
  weekEnd:       string | null;
  grossTotal:    number;
  grossFood:     number;
  grossDrinks:   number;
  netTotal:      number;
  taxTotal:      number;
  tips:          number;
  inhouseTotal:  number;
  takeawayTotal: number;
};

type WeeklyParseResult = {
  rows:            ProductRow[];
  summary:         WeeklySummary | null;
  categoryRevenue: Record<string, number>;
  error?:          string;
};

type ShiftCat = {
  name:            string;
  isMain:          boolean;
  quantity:        number;
  revenue:         number;
  inhouseRevenue:  number;
  takeawayRevenue: number;
};

type MonthlyParseResult = {
  year:               number;
  month:              number;
  fromZ:              string;
  toZ:                string;
  grossTotal:         number;
  grossFood:          number;
  grossDrinks:        number;
  netTotal:           number;
  vatTotal:           number;
  tips:               number;
  inhouseTotal:       number;
  takeawayTotal:      number;
  cancellationsCount: number;
  cancellationsTotal: number;
  error?:             string;
};

type ShiftParseResult = {
  date:               string;
  zReportNumber:      string;
  grossTotal:         number;
  grossFood:          number;
  grossDrinks:        number;
  netTotal:           number;
  vatTotal:           number;
  tips:               number;
  inhouseTotal:       number;
  takeawayTotal:      number;
  cancellationsCount: number;
  cancellationsTotal: number;
  categories:         ShiftCat[];
  error?:             string;
};

type RowType   = 'section' | 'bold' | 'normal' | 'pct';
type RowFormat = 'currency' | 'pct' | 'pct_delta' | 'count';

type WRow = {
  type:      RowType;
  label:     string;
  format?:   RowFormat;
  color?:    'blue' | 'black';
  getValue?: (w: WeekData | null, pw: WeekData | null) => number | null;
};

type DRow = {
  type:      RowType;
  label:     string;
  format?:   RowFormat;
  color?:    'blue' | 'black';
  getValue?: (d: DayAgg | null) => number | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function parseNum(s: string): number {
  if (!s) return 0;
  const c = s.trim().replace(/[€$\s%]/g, '');
  if (!c) return 0;
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

function isoWeek(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - y.getTime()) / 86400000 + 1) / 7);
}

function currentISOWeek(): number {
  const t = new Date();
  return isoWeek(`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate(); // month is 1-based
}

const safeNum = (n: any): number | null =>
  n !== null && n !== undefined && !isNaN(Number(n)) ? Number(n) : null;

const pct = (num: any, denom: any): number | null => {
  const n = safeNum(num), d = safeNum(denom);
  if (n === null || d === null || d === 0) return null;
  return (n / d) * 100;
};

const growth = (curr: any, prev: any): number | null => {
  const c = safeNum(curr), p = safeNum(prev);
  if (c === null || p === null || p === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
};

const fmt = (n: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);

const fmtNum = (n: number) =>
  new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

type DayCol  = { type: 'day';  day: number; dow: string };
type WeekCol = { type: 'week'; label: string; wDays: number[] };
type DailyCol = DayCol | WeekCol;
const PAGE_SIZE = 30;
const TOTAL_WEEKS = 52;

// ─────────────────────────────────────────────────────────────────────────────
// SHIFT AGGREGATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function shiftToAgg(sr: ShiftRow): DayAgg {
  return {
    shiftCount:          1,
    grossTotal:          sr.gross_total         ?? 0,
    grossFood:           sr.gross_food          ?? 0,
    grossDrinks:         sr.gross_beverages     ?? 0,
    netTotal:            sr.net_total           ?? 0,
    vatTotal:            sr.vat_total           ?? 0,
    tips:                sr.tips                ?? 0,
    inhouseTotal:        sr.inhouse_total       ?? 0,
    takeawayTotal:       sr.takeaway_total      ?? 0,
    cancellationsCount:  sr.cancellations_count ?? 0,
    cancellationsTotal:  sr.cancellations_total ?? 0,
  };
}

function addAgg(a: DayAgg, b: DayAgg): DayAgg {
  return {
    shiftCount:          a.shiftCount          + b.shiftCount,
    grossTotal:          a.grossTotal          + b.grossTotal,
    grossFood:           a.grossFood           + b.grossFood,
    grossDrinks:         a.grossDrinks         + b.grossDrinks,
    netTotal:            a.netTotal            + b.netTotal,
    vatTotal:            a.vatTotal            + b.vatTotal,
    tips:                a.tips                + b.tips,
    inhouseTotal:        a.inhouseTotal        + b.inhouseTotal,
    takeawayTotal:       a.takeawayTotal       + b.takeawayTotal,
    cancellationsCount:  a.cancellationsCount  + b.cancellationsCount,
    cancellationsTotal:  a.cancellationsTotal  + b.cancellationsTotal,
  };
}

const EMPTY_AGG: DayAgg = { shiftCount:0, grossTotal:0, grossFood:0, grossDrinks:0, netTotal:0, vatTotal:0, tips:0, inhouseTotal:0, takeawayTotal:0, cancellationsCount:0, cancellationsTotal:0 };

function sumMap(map: Record<number, DayAgg>): DayAgg | null {
  const vals = Object.values(map);
  if (!vals.length) return null;
  return vals.reduce<DayAgg>((acc, d) => addAgg(acc, d), { ...EMPTY_AGG });
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV PARSERS
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_NAMES = new Set([
  'turnover','gross turnover','net turnover','taxes',
  'types of payment','taxes by payment method','revenue breakdown',
  'cancellations','discounts','tables','guests',
  'main categories','categories','products',
]);

function parseWeeklyCSV(raw: string): WeeklyParseResult {
  const content = raw.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const lines   = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 5) return { rows:[], summary:null, categoryRevenue:{}, error:'File appears to be empty.' };

  const split = (line: string) => line.split(';').map(v => v.replace(/^"|"$/g,'').trim());

  let weekStart: string | null = null, weekEnd: string | null = null;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const cols = split(lines[i]);
    if (cols[0].toLowerCase().startsWith('date')) {
      weekStart = parseDate(cols[1] ?? '');
      weekEnd   = parseDate(cols[2] ?? '');
      break;
    }
  }

  let section = '';
  const rows: ProductRow[] = [];
  const categoryRevenue: Record<string,number> = {};
  let grossFood = 0, grossDrinks = 0, grossTotal = 0;
  let netTotal  = 0, taxTotal    = 0, tips       = 0;
  let inhouseTotal = 0, takeawayTotal = 0;

  for (const line of lines) {
    const cols  = split(line);
    const first = cols[0].toLowerCase();
    if (cols.every(c => c === '')) { section = ''; continue; }
    if (SECTION_NAMES.has(first))  { section = first; continue; }
    if (first === 'date:' || first === 'z report:') continue;

    switch (section) {
      case 'turnover':
        if (first === 'tip') tips = parseNum(cols[3]);
        break;
      case 'gross turnover':
        if      (first.startsWith('7.'))  grossFood   = parseNum(cols[3]);
        else if (first.startsWith('19.')) grossDrinks = parseNum(cols[3]);
        else if (first === 'total')       grossTotal  = parseNum(cols[3]);
        break;
      case 'net turnover':
        if (first === 'total') netTotal = parseNum(cols[3]);
        break;
      case 'taxes':
        if (first === 'total') taxTotal = parseNum(cols[3]);
        break;
      case 'main categories':
        if (cols[0]) { inhouseTotal += parseNum(cols[7]); takeawayTotal += parseNum(cols[10]); }
        break;
      case 'categories':
        if (cols[0] && parseNum(cols[3]) > 0) categoryRevenue[cols[0]] = parseNum(cols[3]);
        break;
      case 'products': {
        if (!cols[0]) break;
        const qty = parseNum(cols[2]), rev = parseNum(cols[3]);
        const inh = parseNum(cols[7]), tak = parseNum(cols[10]);
        if (rev > 0 || qty > 0) rows.push({ item_name:cols[0], category:null, quantity:qty, unit_price:qty>0?Math.round((rev/qty)*100)/100:0, total_price:rev, inhouse_revenue:inh, takeaway_revenue:tak });
        break;
      }
    }
  }

  if (rows.length === 0 && grossTotal === 0)
    return { rows:[], summary:null, categoryRevenue:{}, error:'Could not parse this file as an Orderbird Z-report.' };

  if (inhouseTotal === 0 && takeawayTotal === 0 && rows.length > 0) {
    inhouseTotal  = rows.reduce((s,r) => s + r.inhouse_revenue,  0);
    takeawayTotal = rows.reduce((s,r) => s + r.takeaway_revenue, 0);
  }
  if (grossTotal === 0) grossTotal = grossFood + grossDrinks;

  return { rows, summary:{ weekStart, weekEnd, grossTotal, grossFood, grossDrinks, netTotal, taxTotal, tips, inhouseTotal, takeawayTotal }, categoryRevenue };
}

function parseShiftCSV(raw: string): ShiftParseResult {
  const empty: ShiftParseResult = { date:'', zReportNumber:'', grossTotal:0, grossFood:0, grossDrinks:0, netTotal:0, vatTotal:0, tips:0, inhouseTotal:0, takeawayTotal:0, cancellationsCount:0, cancellationsTotal:0, categories:[] };

  const content = raw.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const lines   = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 5) return { ...empty, error:'File appears to be empty.' };

  const split = (line: string) => line.split(';').map(v => v.replace(/^"|"$/g,'').trim());

  let date = '', zReportNumber = '';
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const cols = split(lines[i]);
    if (cols[0].toLowerCase().startsWith('date'))     { date           = parseDate(cols[1] ?? '') ?? ''; }
    if (cols[0].toLowerCase().includes('z report'))   { zReportNumber  = cols[1] ?? ''; }
  }

  let section = '';
  let grossTotal = 0, grossFood = 0, grossDrinks = 0;
  let netTotal = 0, vatTotal = 0, tips = 0;
  let inhouseTotal = 0, takeawayTotal = 0;
  let cancellationsCount = 0, cancellationsTotal = 0;
  const categories: ShiftCat[] = [];

  for (const line of lines) {
    const cols  = split(line);
    const first = cols[0].toLowerCase();
    if (cols.every(c => c === '')) { section = ''; continue; }
    if (SECTION_NAMES.has(first))  { section = first; continue; }
    if (first === 'date:' || first === 'z report:') continue;

    switch (section) {
      case 'turnover':
        if (first === 'tip') tips = parseNum(cols[3]);
        break;
      case 'gross turnover':
        if      (first.startsWith('7.'))  grossFood   = parseNum(cols[3]);
        else if (first.startsWith('19.')) grossDrinks = parseNum(cols[3]);
        else if (first === 'total')       grossTotal  = parseNum(cols[3]);
        break;
      case 'net turnover':
        if (first === 'total') netTotal = parseNum(cols[3]);
        break;
      case 'taxes':
        if (first === 'total') vatTotal = parseNum(cols[3]);
        break;
      case 'cancellations':
        if (first === 'total') { cancellationsCount = Math.round(parseNum(cols[2])); cancellationsTotal = parseNum(cols[3]); }
        break;
      case 'main categories': {
        if (!cols[0] || first === 'total') break;
        const qty = Math.round(parseNum(cols[2])), rev = parseNum(cols[3]);
        const inh = parseNum(cols[7]),              tak = parseNum(cols[10]);
        inhouseTotal  += inh;
        takeawayTotal += tak;
        categories.push({ name:cols[0], isMain:true, quantity:qty, revenue:rev, inhouseRevenue:inh, takeawayRevenue:tak });
        break;
      }
      case 'categories': {
        if (!cols[0] || first === 'total') break;
        const qty = Math.round(parseNum(cols[2])), rev = parseNum(cols[3]);
        const inh = parseNum(cols[7]),              tak = parseNum(cols[10]);
        if (rev > 0) categories.push({ name:cols[0], isMain:false, quantity:qty, revenue:rev, inhouseRevenue:inh, takeawayRevenue:tak });
        break;
      }
    }
  }

  if (grossTotal === 0 && date === '')
    return { ...empty, error:'Could not parse this file as an Orderbird shift report.' };

  return { date, zReportNumber, grossTotal, grossFood, grossDrinks, netTotal, vatTotal, tips, inhouseTotal, takeawayTotal, cancellationsCount, cancellationsTotal, categories };
}

function parseMonthlyCSV(raw: string): MonthlyParseResult {
  const empty: MonthlyParseResult = { year:0, month:0, fromZ:'', toZ:'', grossTotal:0, grossFood:0, grossDrinks:0, netTotal:0, vatTotal:0, tips:0, inhouseTotal:0, takeawayTotal:0, cancellationsCount:0, cancellationsTotal:0 };

  const content = raw.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const lines   = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 5) return { ...empty, error:'File appears to be empty.' };

  const split = (line: string) => line.split(';').map(v => v.replace(/^"|"$/g,'').trim());

  let year = 0, month = 0, fromZ = '', toZ = '';
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const cols = split(lines[i]);
    if (cols[0].toLowerCase().startsWith('date')) {
      const d = parseDate(cols[1] ?? '');
      if (d) { year = parseInt(d.slice(0,4), 10); month = parseInt(d.slice(5,7), 10); }
    }
    if (cols[0].toLowerCase().includes('z report')) { fromZ = cols[1] ?? ''; toZ = cols[2] ?? ''; }
  }

  let section = '';
  let grossTotal = 0, grossFood = 0, grossDrinks = 0;
  let netTotal = 0, vatTotal = 0, tips = 0;
  let inhouseTotal = 0, takeawayTotal = 0;
  let cancellationsCount = 0, cancellationsTotal = 0;

  for (const line of lines) {
    const cols  = split(line);
    const first = cols[0].toLowerCase();
    if (cols.every(c => c === '')) { section = ''; continue; }
    if (SECTION_NAMES.has(first))  { section = first; continue; }
    if (first === 'date:' || first === 'z report:') continue;

    switch (section) {
      case 'turnover':
        if (first === 'tip') tips = parseNum(cols[3]);
        break;
      case 'gross turnover':
        if      (first.startsWith('7.'))  grossFood   = parseNum(cols[3]);
        else if (first.startsWith('19.')) grossDrinks = parseNum(cols[3]);
        else if (first === 'total')       grossTotal  = parseNum(cols[3]);
        break;
      case 'net turnover':
        if (first === 'total') netTotal = parseNum(cols[3]);
        break;
      case 'taxes':
        if (first === 'total') vatTotal = parseNum(cols[3]);
        break;
      case 'cancellations':
        if (first === 'total') { cancellationsCount = Math.round(parseNum(cols[2])); cancellationsTotal = parseNum(cols[3]); }
        break;
      case 'main categories': {
        if (!cols[0] || first === 'total') break;
        inhouseTotal  += parseNum(cols[7]);
        takeawayTotal += parseNum(cols[10]);
        break;
      }
    }
  }

  if (grossTotal === 0 && year === 0)
    return { ...empty, error:'Could not parse this file as an Orderbird monthly report. Make sure the date range spans a full month.' };

  return { year, month, fromZ, toZ, grossTotal, grossFood, grossDrinks, netTotal, vatTotal, tips, inhouseTotal, takeawayTotal, cancellationsCount, cancellationsTotal };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROW DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

const WEEKLY_ROWS: WRow[] = [
  { type:'section', label:'REVENUE' },
  { type:'bold',   label:'Total Gross Revenue',     color:'blue',  format:'currency',  getValue:(w)=>safeNum(w?.total_revenue) },
  { type:'pct',    label:'Revenue growth (%)',       color:'black', format:'pct_delta', getValue:(w,pw)=>growth(safeNum(w?.total_revenue), safeNum(pw?.total_revenue)) },
  { type:'normal', label:'Food Revenue (7% VAT)',    color:'blue',  format:'currency',  getValue:(w)=>safeNum(w?.gross_food) },
  { type:'pct',    label:'Food share (%)',           color:'black', format:'pct',       getValue:(w)=>pct(safeNum(w?.gross_food), safeNum(w?.total_revenue)) },
  { type:'normal', label:'Drinks Revenue (19% VAT)', color:'blue',  format:'currency',  getValue:(w)=>safeNum(w?.gross_drinks) },
  { type:'pct',    label:'Drinks share (%)',         color:'black', format:'pct',       getValue:(w)=>pct(safeNum(w?.gross_drinks), safeNum(w?.total_revenue)) },
  { type:'normal', label:'Tips',                     color:'blue',  format:'currency',  getValue:(w)=>safeNum(w?.tips) },
  { type:'section', label:'NET REVENUE' },
  { type:'bold',   label:'Net Revenue',              color:'blue',  format:'currency',  getValue:(w)=>safeNum(w?.net_revenue) },
  { type:'pct',    label:'Net growth (%)',           color:'black', format:'pct_delta', getValue:(w,pw)=>growth(safeNum(w?.net_revenue), safeNum(pw?.net_revenue)) },
  { type:'normal', label:'VAT',                      color:'blue',  format:'currency',  getValue:(w)=>safeNum(w?.tax_total) },
  { type:'pct',    label:'Effective VAT rate (%)',   color:'black', format:'pct',       getValue:(w)=>pct(safeNum(w?.tax_total), safeNum(w?.net_revenue)) },
  { type:'section', label:'CHANNEL MIX' },
  { type:'normal', label:'In-house Revenue',         color:'blue',  format:'currency',  getValue:(w)=>safeNum(w?.inhouse_revenue) },
  { type:'pct',    label:'In-house share (%)',       color:'black', format:'pct',       getValue:(w)=>pct(safeNum(w?.inhouse_revenue), safeNum(w?.total_revenue)) },
  { type:'normal', label:'Takeaway Revenue',         color:'blue',  format:'currency',  getValue:(w)=>safeNum(w?.takeaway_revenue) },
  { type:'pct',    label:'Takeaway share (%)',       color:'black', format:'pct',       getValue:(w)=>pct(safeNum(w?.takeaway_revenue), safeNum(w?.total_revenue)) },
  { type:'section', label:'COSTS' },
  { type:'normal', label:'Food Cost',                color:'black', format:'currency',  getValue:()=>null },
  { type:'pct',    label:'Food cost (%)',            color:'black', format:'pct',       getValue:()=>null },
  { type:'normal', label:'Drinks Cost',              color:'black', format:'currency',  getValue:()=>null },
  { type:'pct',    label:'Drinks cost (%)',          color:'black', format:'pct',       getValue:()=>null },
  { type:'normal', label:'Labour Cost',              color:'black', format:'currency',  getValue:()=>null },
  { type:'pct',    label:'Labour cost (%)',          color:'black', format:'pct',       getValue:()=>null },
  { type:'section', label:'PROFITABILITY' },
  { type:'bold',   label:'Gross Profit',             color:'black', format:'currency',  getValue:()=>null },
  { type:'pct',    label:'Gross margin (%)',         color:'black', format:'pct',       getValue:()=>null },
  { type:'bold',   label:'EBITDA',                   color:'black', format:'currency',  getValue:()=>null },
  { type:'pct',    label:'EBITDA margin (%)',        color:'black', format:'pct',       getValue:()=>null },
];

const DAILY_ROWS: DRow[] = [
  { type:'section', label:'REVENUE' },
  { type:'bold',   label:'Total Gross Revenue',     color:'blue',  format:'currency', getValue:(d)=>safeNum(d?.grossTotal) },
  { type:'normal', label:'Food (7% VAT)',            color:'blue',  format:'currency', getValue:(d)=>safeNum(d?.grossFood) },
  { type:'pct',    label:'Food share (%)',           color:'black', format:'pct',      getValue:(d)=>pct(d?.grossFood, d?.grossTotal) },
  { type:'normal', label:'Beverages (19% VAT)',      color:'blue',  format:'currency', getValue:(d)=>safeNum(d?.grossDrinks) },
  { type:'pct',    label:'Beverages share (%)',      color:'black', format:'pct',      getValue:(d)=>pct(d?.grossDrinks, d?.grossTotal) },
  { type:'normal', label:'Tips',                     color:'blue',  format:'currency', getValue:(d)=>safeNum(d?.tips) },
  { type:'section', label:'NET REVENUE' },
  { type:'bold',   label:'Net Revenue',              color:'blue',  format:'currency', getValue:(d)=>safeNum(d?.netTotal) },
  { type:'normal', label:'VAT',                      color:'blue',  format:'currency', getValue:(d)=>safeNum(d?.vatTotal) },
  { type:'pct',    label:'Effective VAT rate (%)',   color:'black', format:'pct',      getValue:(d)=>pct(d?.vatTotal, d?.netTotal) },
  { type:'section', label:'CHANNEL MIX' },
  { type:'normal', label:'In-house Revenue',         color:'blue',  format:'currency', getValue:(d)=>safeNum(d?.inhouseTotal) },
  { type:'pct',    label:'In-house share (%)',       color:'black', format:'pct',      getValue:(d)=>pct(d?.inhouseTotal, d?.grossTotal) },
  { type:'normal', label:'Takeaway Revenue',         color:'blue',  format:'currency', getValue:(d)=>safeNum(d?.takeawayTotal) },
  { type:'pct',    label:'Takeaway share (%)',       color:'black', format:'pct',      getValue:(d)=>pct(d?.takeawayTotal, d?.grossTotal) },
  { type:'section', label:'SHIFTS & CANCELLATIONS' },
  { type:'normal', label:'Shifts uploaded',          color:'black', format:'count',    getValue:(d)=>safeNum(d?.shiftCount) },
  { type:'normal', label:'Cancellation count',       color:'black', format:'count',    getValue:(d)=>safeNum(d?.cancellationsCount) },
  { type:'normal', label:'Cancellation value (€)',   color:'black', format:'currency', getValue:(d)=>safeNum(d?.cancellationsTotal) },
];

// ─────────────────────────────────────────────────────────────────────────────
// MONTHLY P&L TYPES + ROWS
// ─────────────────────────────────────────────────────────────────────────────

type MonthlyReportData = {
  report_month:        number;
  report_year:         number;
  gross_total:         number | null;
  gross_food:          number | null;
  gross_beverages:     number | null;
  net_total:           number | null;
  vat_total:           number | null;
  tips:                number | null;
  inhouse_total:       number | null;
  takeaway_total:      number | null;
  cancellations_count: number | null;
  cancellations_total: number | null;
};

type MRow = {
  type:      RowType;
  label:     string;
  color?:    string;
  format?:   RowFormat;
  getValue?: (m: MonthlyReportData | null, pm: MonthlyReportData | null) => number | null;
};

const MONTHLY_ROWS: MRow[] = [
  { type:'section', label:'REVENUE' },
  { type:'bold',   label:'Total Gross Revenue',      color:'blue',  format:'currency',  getValue:(m)=>safeNum(m?.gross_total) },
  { type:'pct',    label:'Revenue growth (%)',        color:'black', format:'pct_delta', getValue:(m,pm)=>growth(safeNum(m?.gross_total), safeNum(pm?.gross_total)) },
  { type:'normal', label:'Food Revenue (7% VAT)',     color:'blue',  format:'currency',  getValue:(m)=>safeNum(m?.gross_food) },
  { type:'pct',    label:'Food share (%)',            color:'black', format:'pct',       getValue:(m)=>pct(safeNum(m?.gross_food), safeNum(m?.gross_total)) },
  { type:'normal', label:'Drinks Revenue (19% VAT)',  color:'blue',  format:'currency',  getValue:(m)=>safeNum(m?.gross_beverages) },
  { type:'pct',    label:'Drinks share (%)',          color:'black', format:'pct',       getValue:(m)=>pct(safeNum(m?.gross_beverages), safeNum(m?.gross_total)) },
  { type:'normal', label:'Tips',                      color:'blue',  format:'currency',  getValue:(m)=>safeNum(m?.tips) },
  { type:'section', label:'NET REVENUE' },
  { type:'bold',   label:'Net Revenue',               color:'blue',  format:'currency',  getValue:(m)=>safeNum(m?.net_total) },
  { type:'pct',    label:'Net growth (%)',            color:'black', format:'pct_delta', getValue:(m,pm)=>growth(safeNum(m?.net_total), safeNum(pm?.net_total)) },
  { type:'normal', label:'VAT',                       color:'blue',  format:'currency',  getValue:(m)=>safeNum(m?.vat_total) },
  { type:'pct',    label:'Effective VAT rate (%)',    color:'black', format:'pct',       getValue:(m)=>pct(safeNum(m?.vat_total), safeNum(m?.net_total)) },
  { type:'section', label:'CHANNEL MIX' },
  { type:'normal', label:'In-house Revenue',          color:'blue',  format:'currency',  getValue:(m)=>safeNum(m?.inhouse_total) },
  { type:'pct',    label:'In-house share (%)',        color:'black', format:'pct',       getValue:(m)=>pct(safeNum(m?.inhouse_total), safeNum(m?.gross_total)) },
  { type:'normal', label:'Takeaway Revenue',          color:'blue',  format:'currency',  getValue:(m)=>safeNum(m?.takeaway_total) },
  { type:'pct',    label:'Takeaway share (%)',        color:'black', format:'pct',       getValue:(m)=>pct(safeNum(m?.takeaway_total), safeNum(m?.gross_total)) },
  { type:'section', label:'CANCELLATIONS' },
  { type:'normal', label:'Cancellation count',        color:'black', format:'count',     getValue:(m)=>safeNum(m?.cancellations_count) },
  { type:'normal', label:'Cancellation value (€)',    color:'black', format:'currency',  getValue:(m)=>safeNum(m?.cancellations_total) },
  { type:'section', label:'COSTS' },
  { type:'normal', label:'Food Cost',                 color:'black', format:'currency',  getValue:()=>null },
  { type:'pct',    label:'Food cost (%)',             color:'black', format:'pct',       getValue:()=>null },
  { type:'normal', label:'Labour Cost',               color:'black', format:'currency',  getValue:()=>null },
  { type:'pct',    label:'Labour cost (%)',           color:'black', format:'pct',       getValue:()=>null },
  { type:'section', label:'PROFITABILITY' },
  { type:'bold',   label:'Gross Profit',              color:'black', format:'currency',  getValue:()=>null },
  { type:'pct',    label:'Gross margin (%)',          color:'black', format:'pct',       getValue:()=>null },
  { type:'bold',   label:'EBITDA',                    color:'black', format:'currency',  getValue:()=>null },
  { type:'pct',    label:'EBITDA margin (%)',         color:'black', format:'pct',       getValue:()=>null },
];

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function SalesReportsPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tab / sub-tab
  const [activeTab,   setActiveTab]   = useState<'upload'|'daily'|'weekly'|'monthly'>('daily');
  const [reportType,  setReportType]  = useState<'weekly'|'shift'|'monthly'>('shift');

  // Shared controls
  const [location, setLocation] = useState<Location | null>(null);
  const [year,     setYear]     = useState(new Date().getFullYear());
  const [month,    setMonth]    = useState(new Date().getMonth() + 1);

  // Upload state
  const [fileName,       setFileName]       = useState<string | null>(null);
  const [weeklyResult,   setWeeklyResult]   = useState<WeeklyParseResult | null>(null);
  const [shiftResult,    setShiftResult]    = useState<ShiftParseResult | null>(null);
  const [monthlyResult,  setMonthlyResult]  = useState<MonthlyParseResult | null>(null);
  const [parseError,     setParseError]     = useState<string | null>(null);
  const [importing,     setImporting]     = useState(false);
  const [isDragging,    setIsDragging]    = useState(false);
  const [weeklyPage,    setWeeklyPage]    = useState(0);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-active'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name, type').eq('is_active', true).order('name');
      return ((data ?? []) as { id: string; name: string; type: string }[])
        .filter(l => l.type === 'restaurant')
        .map(({ id, name }) => ({ id, name })) as Location[];
    },
  });

  // Weekly imports
  const { data: weeklyImports = [] } = useQuery({
    queryKey: ['weekly-sales', location?.id, year],
    enabled: !!location && activeTab === 'weekly',
    queryFn: async () => {
      const { data } = await supabase
        .from('sales_imports')
        .select('week_start,week_end,total_revenue,gross_food,gross_drinks,net_revenue,tax_total,tips,inhouse_revenue,takeaway_revenue')
        .eq('location_id', location!.id)
        .gte('week_start', `${year}-01-01`)
        .lte('week_start', `${year}-12-31`)
        .order('week_start', { ascending: true });
      return (data ?? []) as WeekData[];
    },
  });

  // Monthly reports
  const { data: monthlyReports = [] } = useQuery({
    queryKey: ['monthly-reports', location?.id, year],
    enabled: !!location && activeTab === 'monthly',
    queryFn: async () => {
      const { data } = await supabase
        .from('monthly_reports')
        .select('report_month,report_year,gross_total,gross_food,gross_beverages,net_total,vat_total,tips,inhouse_total,takeaway_total,cancellations_count,cancellations_total')
        .eq('location_id', location!.id)
        .eq('report_year', year)
        .order('report_month', { ascending: true });
      return (data ?? []) as MonthlyReportData[];
    },
  });

  // Shift reports for daily view
  const { data: shiftRows = [] } = useQuery({
    queryKey: ['shift-reports', location?.id, year, month],
    enabled: !!location && activeTab === 'daily',
    queryFn: async () => {
      const mm   = String(month).padStart(2, '0');
      const last = daysInMonth(year, month);
      const { data } = await supabase
        .from('shift_reports')
        .select('report_date,z_report_number,gross_total,gross_food,gross_beverages,net_total,vat_total,tips,inhouse_total,takeaway_total,cancellations_count,cancellations_total')
        .eq('location_id', location!.id)
        .gte('report_date', `${year}-${mm}-01`)
        .lte('report_date', `${year}-${mm}-${String(last).padStart(2,'0')}`)
        .order('report_date', { ascending: true });
      return (data ?? []) as ShiftRow[];
    },
  });

  // ── Derived data ───────────────────────────────────────────────────────────

  const monthMap = useMemo<Record<number, MonthlyReportData>>(() => {
    const m: Record<number, MonthlyReportData> = {};
    for (const r of monthlyReports) m[r.report_month] = r;
    return m;
  }, [monthlyReports]);

  const yearMonthTotal = useMemo<MonthlyReportData | null>(() => {
    const rows = Object.values(monthMap);
    if (!rows.length) return null;
    return rows.reduce<MonthlyReportData>((acc, m) => ({
      report_month: 0, report_year: year,
      gross_total:         (acc.gross_total         ?? 0) + (m.gross_total         ?? 0),
      gross_food:          (acc.gross_food          ?? 0) + (m.gross_food          ?? 0),
      gross_beverages:     (acc.gross_beverages     ?? 0) + (m.gross_beverages     ?? 0),
      net_total:           (acc.net_total           ?? 0) + (m.net_total           ?? 0),
      vat_total:           (acc.vat_total           ?? 0) + (m.vat_total           ?? 0),
      tips:                (acc.tips                ?? 0) + (m.tips                ?? 0),
      inhouse_total:       (acc.inhouse_total       ?? 0) + (m.inhouse_total       ?? 0),
      takeaway_total:      (acc.takeaway_total      ?? 0) + (m.takeaway_total      ?? 0),
      cancellations_count: (acc.cancellations_count ?? 0) + (m.cancellations_count ?? 0),
      cancellations_total: (acc.cancellations_total ?? 0) + (m.cancellations_total ?? 0),
    }), { report_month:0, report_year:year, gross_total:0, gross_food:0, gross_beverages:0, net_total:0, vat_total:0, tips:0, inhouse_total:0, takeaway_total:0, cancellations_count:0, cancellations_total:0 });
  }, [monthMap, year]);

  const weekMap = useMemo<Record<number, WeekData>>(() => {
    const m: Record<number, WeekData> = {};
    for (const imp of weeklyImports) if (imp.week_start) m[isoWeek(imp.week_start)] = imp;
    return m;
  }, [weeklyImports]);

  const cwk = currentISOWeek();

  const yearTotal = useMemo<WeekData | null>(() => {
    if (!weeklyImports.length) return null;
    return weeklyImports.reduce<WeekData>((acc, w) => ({
      week_start:'', week_end:null,
      total_revenue:    acc.total_revenue    + (safeNum(w.total_revenue)    ?? 0),
      gross_food:       acc.gross_food       + (safeNum(w.gross_food)       ?? 0),
      gross_drinks:     acc.gross_drinks     + (safeNum(w.gross_drinks)     ?? 0),
      net_revenue:      acc.net_revenue      + (safeNum(w.net_revenue)      ?? 0),
      tax_total:        acc.tax_total        + (safeNum(w.tax_total)        ?? 0),
      tips:             acc.tips             + (safeNum(w.tips)             ?? 0),
      inhouse_revenue:  acc.inhouse_revenue  + (safeNum(w.inhouse_revenue)  ?? 0),
      takeaway_revenue: acc.takeaway_revenue + (safeNum(w.takeaway_revenue) ?? 0),
    }), { week_start:'', week_end:null, total_revenue:0, gross_food:0, gross_drinks:0, net_revenue:0, tax_total:0, tips:0, inhouse_revenue:0, takeaway_revenue:0 });
  }, [weeklyImports]);

  // Split shifts per day: sort by z_report_number (lower = lunch, higher = dinner)
  const { lunchMap, dinnerMap, totalMap } = useMemo(() => {
    const byDay: Record<number, ShiftRow[]> = {};
    for (const sr of shiftRows) {
      const day = new Date(sr.report_date + 'T12:00:00Z').getUTCDate();
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(sr);
    }
    for (const day in byDay) {
      byDay[day].sort((a, b) => parseInt(a.z_report_number || '0', 10) - parseInt(b.z_report_number || '0', 10));
    }
    const lunchMap:  Record<number, DayAgg> = {};
    const dinnerMap: Record<number, DayAgg> = {};
    const totalMap:  Record<number, DayAgg> = {};
    for (const [dayStr, shifts] of Object.entries(byDay)) {
      const day = parseInt(dayStr, 10);
      let total: DayAgg | null = null;
      if (shifts[0]) { lunchMap[day]  = shiftToAgg(shifts[0]); total = shiftToAgg(shifts[0]); }
      if (shifts[1]) { dinnerMap[day] = shiftToAgg(shifts[1]); total = total ? addAgg(total, shiftToAgg(shifts[1])) : shiftToAgg(shifts[1]); }
      for (let i = 2; i < shifts.length; i++) if (total) total = addAgg(total, shiftToAgg(shifts[i]));
      if (total) totalMap[day] = total;
    }
    return { lunchMap, dinnerMap, totalMap };
  }, [shiftRows]);

  const lunchMonthTotal  = useMemo(() => sumMap(lunchMap),  [lunchMap]);
  const dinnerMonthTotal = useMemo(() => sumMap(dinnerMap), [dinnerMap]);
  const totalMonthTotal  = useMemo(() => sumMap(totalMap),  [totalMap]);

  const totalDays = useMemo(() => daysInMonth(year, month), [year, month]);
  const days      = useMemo(() => Array.from({ length: totalDays }, (_, i) => i + 1), [totalDays]);

  // Build day + week-summary column sequence for the daily P&L
  const dailyCols = useMemo<DailyCol[]>(() => {
    const result: DailyCol[] = [];
    let wDays: number[] = [];
    const mm = String(month).padStart(2, '0');
    for (const d of days) {
      const dow = new Date(year, month - 1, d).getDay(); // 0=Sun
      result.push({ type: 'day', day: d, dow: DOW_SHORT[dow] });
      wDays.push(d);
      if (dow === 0) {
        // Use the Sunday's date to get the correct ISO calendar week
        const cw = isoWeek(`${year}-${mm}-${String(d).padStart(2,'0')}`);
        result.push({ type: 'week', label: `CW${cw}`, wDays: [...wDays] });
        wDays = [];
      }
    }
    if (wDays.length > 0) {
      // Trailing partial week — use the last day to get its CW
      const lastD = wDays[wDays.length - 1];
      const cw = isoWeek(`${year}-${mm}-${String(lastD).padStart(2,'0')}`);
      result.push({ type: 'week', label: `CW${cw}`, wDays: [...wDays] });
    }
    return result;
  }, [days, year, month]);

  const topCats = useMemo(() =>
    Object.entries(weeklyResult?.categoryRevenue ?? {}).sort((a,b) => b[1]-a[1]).slice(0, 12),
    [weeklyResult]
  );

  const canImportWeekly  = !!location && !!weeklyResult?.rows?.length && !importing;
  const canImportShift   = !!location && !!shiftResult && !shiftResult.error && !!shiftResult.date && !importing;
  const canImportMonthly = !!location && !!monthlyResult && !monthlyResult.error && monthlyResult.year > 0 && !importing;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const resetUpload = useCallback(() => {
    setFileName(null); setWeeklyResult(null); setShiftResult(null); setMonthlyResult(null);
    setParseError(null); setWeeklyPage(0);
  }, []);

  const processFile = useCallback((file: File) => {
    setFileName(file.name);
    setWeeklyResult(null); setShiftResult(null); setMonthlyResult(null); setParseError(null); setWeeklyPage(0);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (reportType === 'weekly') {
        const r = parseWeeklyCSV(content ?? '');
        if (r.error) { setParseError(r.error); return; }
        setWeeklyResult(r);
      } else if (reportType === 'monthly') {
        const r = parseMonthlyCSV(content ?? '');
        if (r.error) { setParseError(r.error); return; }
        setMonthlyResult(r);
      } else {
        const r = parseShiftCSV(content ?? '');
        if (r.error) { setParseError(r.error); return; }
        setShiftResult(r);
      }
    };
    reader.readAsText(file, 'UTF-8');
  }, [reportType]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files?.[0]; if (f) processFile(f);
  }, [processFile]);

  const handleImportWeekly = useCallback(async () => {
    if (!location || !weeklyResult?.rows || !weeklyResult?.summary) return;
    setImporting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const s = weeklyResult.summary;
      const { data: imp, error: impErr } = await supabase.from('sales_imports').insert({
        location_id: location.id, file_name: fileName ?? 'unknown.csv',
        week_start: s.weekStart, week_end: s.weekEnd,
        row_count: weeklyResult.rows.length, total_revenue: s.grossTotal,
        net_revenue: s.netTotal, tax_total: s.taxTotal, tips: s.tips,
        gross_food: s.grossFood, gross_drinks: s.grossDrinks,
        inhouse_revenue: s.inhouseTotal, takeaway_revenue: s.takeawayTotal,
        imported_by: user?.id ?? null,
      }).select('id').single();
      if (impErr) throw impErr;
      for (let i = 0; i < weeklyResult.rows.length; i += 200) {
        const chunk = weeklyResult.rows.slice(i, i+200).map(r => ({
          import_id: imp.id, item_name: r.item_name, category: r.category,
          quantity: r.quantity, unit_price: r.unit_price, total_price: r.total_price,
          inhouse_revenue: r.inhouse_revenue, takeaway_revenue: r.takeaway_revenue,
        }));
        const { error } = await supabase.from('sales_import_lines').insert(chunk);
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ['sales-imports'] });
      queryClient.invalidateQueries({ queryKey: ['weekly-sales'] });
      resetUpload(); setActiveTab('weekly');
    } catch (e: any) { alert(`Import failed: ${e.message}`); }
    finally { setImporting(false); }
  }, [location, weeklyResult, fileName, queryClient, resetUpload]);

  const handleImportShift = useCallback(async () => {
    if (!location || !shiftResult || !shiftResult.date) return;
    setImporting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: inserted, error: srErr } = await supabase.from('shift_reports').insert({
        location_id: location.id, report_date: shiftResult.date,
        z_report_number: shiftResult.zReportNumber,
        gross_total: shiftResult.grossTotal, gross_food: shiftResult.grossFood,
        gross_beverages: shiftResult.grossDrinks, net_total: shiftResult.netTotal,
        vat_total: shiftResult.vatTotal, tips: shiftResult.tips,
        inhouse_total: shiftResult.inhouseTotal, takeaway_total: shiftResult.takeawayTotal,
        cancellations_count: shiftResult.cancellationsCount,
        cancellations_total: shiftResult.cancellationsTotal,
        uploaded_by: user?.id ?? null,
      }).select('id').single();
      if (srErr) throw srErr;
      if (shiftResult.categories.length > 0) {
        const { error: catErr } = await supabase.from('shift_report_categories').insert(
          shiftResult.categories.map(c => ({
            shift_report_id: inserted.id, category_name: c.name,
            quantity: c.quantity, total_revenue: c.revenue,
            inhouse_revenue: c.inhouseRevenue, takeaway_revenue: c.takeawayRevenue,
            is_main_category: c.isMain,
          }))
        );
        if (catErr) throw catErr;
      }
      // Navigate to the month of the imported shift
      const d = new Date(shiftResult.date + 'T12:00:00Z');
      setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth() + 1);
      queryClient.invalidateQueries({ queryKey: ['shift-reports'] });
      resetUpload(); setActiveTab('daily');
    } catch (e: any) { alert(`Import failed: ${e.message}`); }
    finally { setImporting(false); }
  }, [location, shiftResult, queryClient, resetUpload]);

  const handleImportMonthly = useCallback(async () => {
    if (!location || !monthlyResult || monthlyResult.year === 0) return;
    setImporting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('monthly_reports').upsert({
        location_id:         location.id,
        report_year:         monthlyResult.year,
        report_month:        monthlyResult.month,
        from_z:              monthlyResult.fromZ,
        to_z:                monthlyResult.toZ,
        gross_total:         monthlyResult.grossTotal,
        gross_food:          monthlyResult.grossFood,
        gross_beverages:     monthlyResult.grossDrinks,
        net_total:           monthlyResult.netTotal,
        vat_total:           monthlyResult.vatTotal,
        tips:                monthlyResult.tips,
        inhouse_total:       monthlyResult.inhouseTotal,
        takeaway_total:      monthlyResult.takeawayTotal,
        cancellations_count: monthlyResult.cancellationsCount,
        cancellations_total: monthlyResult.cancellationsTotal,
        uploaded_by:         user?.id ?? null,
      }, { onConflict: 'location_id,report_year,report_month' });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['monthly-reports'] });
      resetUpload();
    } catch (e: any) { alert(`Import failed: ${e.message}`); }
    finally { setImporting(false); }
  }, [location, monthlyResult, queryClient, resetUpload]);

  // ── Cell renderers ─────────────────────────────────────────────────────────

  const renderWeeklyCell = (row: WRow, kw: number) => {
    if (row.type === 'section') return null;
    const w = weekMap[kw] ?? null, pw = weekMap[kw-1] ?? null;
    const val = row.getValue?.(w, pw) ?? null;
    if (val === null) return <span className="text-gray-300 select-none">—</span>;
    if (row.format === 'currency') return <span className={row.color === 'blue' ? 'text-blue-700' : 'text-gray-900'}>{fmtNum(val)}</span>;
    if (row.format === 'pct') return <span className="text-gray-500">{val.toFixed(1)}%</span>;
    if (row.format === 'pct_delta') { const s = val>=0?'+':'', cl = val>=0?'text-green-600':'text-red-500'; return <span className={cl}>{s}{val.toFixed(1)}%</span>; }
    return <span>{fmtNum(val)}</span>;
  };

  const renderDayCell = (row: DRow, data: DayAgg | null) => {
    if (row.type === 'section') return null;
    const val = row.getValue?.(data) ?? null;
    if (val === null) return <span className="text-gray-300 select-none">—</span>;
    if (row.format === 'currency') return <span className={row.color === 'blue' ? 'text-blue-700' : 'text-gray-900'}>{fmtNum(val)}</span>;
    if (row.format === 'count')    return <span className="text-gray-700">{Math.round(val)}</span>;
    if (row.format === 'pct')      return <span className="text-gray-500">{val.toFixed(1)}%</span>;
    return <span>{fmtNum(val)}</span>;
  };

  const renderMonthCell = (row: MRow, mn: number) => {
    if (row.type === 'section') return null;
    const m = monthMap[mn] ?? null, pm = monthMap[mn-1] ?? null;
    const val = row.getValue?.(m, pm) ?? null;
    if (val === null) return <span className="text-gray-300 select-none">—</span>;
    if (row.format === 'currency') return <span className={row.color === 'blue' ? 'text-blue-700' : 'text-gray-900'}>{fmtNum(val)}</span>;
    if (row.format === 'pct')      return <span className="text-gray-500">{val.toFixed(1)}%</span>;
    if (row.format === 'count')    return <span className="text-gray-700">{Math.round(val)}</span>;
    if (row.format === 'pct_delta') {
      const s = val >= 0 ? '+' : '', cl = val >= 0 ? 'text-green-600' : 'text-red-500';
      return <span className={cl}>{s}{val.toFixed(1)}%</span>;
    }
    return <span>{fmtNum(val)}</span>;
  };

  // ── Shared controls UI ─────────────────────────────────────────────────────

  const today = new Date();
  const todayDay   = today.getDate();
  const todayMonth = today.getMonth() + 1;
  const todayYear  = today.getFullYear();

  const LABEL_W  = 220;
  const COL_W_WK = 76;
  const COL_W_MN = 90;
  const COL_W_D  = 68;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ── */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload shift &amp; weekly Z-reports · view daily and weekly P&amp;L</p>
        </div>
        <div className="flex items-center gap-5 text-xs text-gray-500 pt-1">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-600 inline-block" />Reported</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-gray-800 inline-block" />Calculated</span>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="border-b border-gray-200 mb-5">
        <nav className="flex gap-6">
          {([
            ['upload',  <Upload size={14} />,        'Upload'],
            ['daily',   <CalendarDays size={14} />,  'Daily P&L'],
            ['monthly', <TableProperties size={14} />, 'Monthly P&L'],
            ['weekly',  <BarChart3 size={14} />,     'Weekly P&L'],
          ] as const).map(([t, icon, label]) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === t ? 'border-[#1B5E20] text-[#1B5E20]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {icon}{label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Shared controls (location + year + month) ── */}
      {activeTab !== 'upload' && (
        <div className="flex items-center gap-6 mb-5 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Location</span>
            {locations.map(l => (
              <button key={l.id} onClick={() => setLocation(l)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  location?.id === l.id ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20] hover:text-[#1B5E20]'
                }`}
              ><MapPin size={11} />{l.name}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Year</span>
            {[2025, 2026, 2027].map(y => (
              <button key={y} onClick={() => setYear(y)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  year === y ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >{y}</button>
            ))}
          </div>
          {activeTab === 'daily' && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider mr-1">Month</span>
              {MONTHS.map((mn, i) => (
                <button key={mn} onClick={() => setMonth(i+1)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    month === i+1 ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >{mn}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          UPLOAD TAB
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'upload' && (
        <div>
          {/* Report type toggle */}
          <div className="flex gap-3 mb-5">
            {([
              ['shift',   '⏱',  'Shift Report',   'Single shift Z-report (lunch or dinner)'],
              ['monthly', '📅', 'Monthly Report', 'Full-month Z-report aggregate'],
              ['weekly',  '📋', 'Weekly Report',  'KW report covering a full week'],
            ] as const).map(([t, emoji, label, desc]) => (
              <button key={t} onClick={() => { setReportType(t); resetUpload(); }}
                className={`flex-1 py-3 px-4 rounded-xl border-2 text-left transition-colors ${
                  reportType === t ? 'border-[#1B5E20] bg-green-50' : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className={`text-sm font-bold ${reportType === t ? 'text-[#1B5E20]' : 'text-gray-700'}`}>{emoji} {label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
              </button>
            ))}
          </div>

          <div className="flex gap-6 items-start">
            {/* ── Left panel ── */}
            <div className="w-80 flex-shrink-0 space-y-4">

              {/* Location */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Location</label>
                <div className="flex flex-wrap gap-2">
                  {locations.map(l => (
                    <button key={l.id} onClick={() => setLocation(l)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        location?.id === l.id ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20] hover:text-[#1B5E20]'
                      }`}
                    ><MapPin size={12} />{l.name}</button>
                  ))}
                </div>
              </div>

              {/* Drop zone */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Orderbird Z-Report CSV — {reportType === 'shift' ? 'Shift' : reportType === 'monthly' ? 'Monthly' : 'Weekly'}
                </label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                    isDragging ? 'border-[#1B5E20] bg-green-50' :
                    fileName && !parseError ? 'border-green-400 bg-green-50' :
                    parseError ? 'border-red-300 bg-red-50' :
                    'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  {fileName && !parseError
                    ? <FileCheck className="mx-auto mb-2 text-green-600" size={32} />
                    : <Upload    className="mx-auto mb-2 text-gray-400"   size={32} />}
                  <p className={`text-sm font-semibold mb-1 ${fileName && !parseError ? 'text-green-700' : 'text-gray-600'}`}>
                    {fileName ?? 'Drop CSV here'}
                  </p>
                  <p className="text-xs text-gray-400 mb-3">
                    {weeklyResult   ? `${weeklyResult.rows.length} products parsed` :
                     shiftResult    ? `Z-Report ${shiftResult.zReportNumber} · ${fmtDate(shiftResult.date)}` :
                     monthlyResult  ? `Z ${monthlyResult.fromZ}–${monthlyResult.toZ} · ${MONTHS[monthlyResult.month-1]} ${monthlyResult.year}` :
                     'or click to browse'}
                  </p>
                  <input ref={fileInputRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
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

                {/* Save button */}
                <button
                  onClick={reportType === 'weekly' ? handleImportWeekly : reportType === 'monthly' ? handleImportMonthly : handleImportShift}
                  disabled={reportType === 'weekly' ? !canImportWeekly : reportType === 'monthly' ? !canImportMonthly : !canImportShift}
                  className={`mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-colors ${
                    (reportType === 'weekly' ? canImportWeekly : reportType === 'monthly' ? canImportMonthly : canImportShift)
                      ? 'bg-[#1B5E20] text-white hover:bg-[#2E7D32]'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {importing
                    ? <Loader2 size={16} className="animate-spin" />
                    : <DatabaseZap size={16} />}
                  {importing ? 'Saving…' :
                   !location ? 'Select a location first' :
                   reportType === 'weekly'
                     ? (canImportWeekly  ? `Save weekly report · ${fmt(weeklyResult!.summary!.grossTotal)}`                                         : 'Drop a CSV file above')
                     : reportType === 'monthly'
                     ? (canImportMonthly ? `Save monthly report · ${MONTHS[monthlyResult!.month-1]} ${monthlyResult!.year} · ${fmt(monthlyResult!.grossTotal)}` : 'Drop a CSV file above')
                     : (canImportShift   ? `Save shift report · ${fmt(shiftResult!.grossTotal)}`                                                    : 'Drop a CSV file above')}
                </button>
              </div>

              {/* ── Weekly summary cards ── */}
              {reportType === 'weekly' && weeklyResult?.summary && (
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                    {fmtDate(weeklyResult.summary.weekStart)} – {fmtDate(weeklyResult.summary.weekEnd)}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { icon: Euro,       label:'Gross Revenue', value: fmt(weeklyResult.summary.grossTotal),  color:'text-[#1B5E20]' },
                      { icon: Receipt,    label:'Net Revenue',   value: fmt(weeklyResult.summary.netTotal),    color:'text-blue-700'  },
                      { icon: Percent,    label:'VAT',           value: fmt(weeklyResult.summary.taxTotal),    color:'text-amber-700' },
                      { icon: TrendingUp, label:'Tips',          value: fmt(weeklyResult.summary.tips),        color:'text-purple-700'},
                    ].map(s => (
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
              )}

              {/* ── Shift summary cards ── */}
              {reportType === 'shift' && shiftResult && !shiftResult.error && (
                <div className="space-y-3">
                  <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm flex items-center gap-5">
                    <div>
                      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Date</p>
                      <p className="text-base font-bold text-gray-900 mt-0.5">{fmtDate(shiftResult.date)}</p>
                    </div>
                    <div className="border-l border-gray-200 pl-5">
                      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Z-Report #</p>
                      <p className="text-base font-bold text-gray-900 mt-0.5">{shiftResult.zReportNumber || '—'}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label:'Gross Revenue', value: fmt(shiftResult.grossTotal),         color:'text-[#1B5E20]'  },
                      { label:'Net Revenue',   value: fmt(shiftResult.netTotal),            color:'text-blue-700'   },
                      { label:'VAT',           value: fmt(shiftResult.vatTotal),            color:'text-amber-700'  },
                      { label:'Tips',          value: fmt(shiftResult.tips),               color:'text-purple-700' },
                    ].map(s => (
                      <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                        <p className="text-xs text-gray-400 font-semibold uppercase mb-1">{s.label}</p>
                        <p className={`text-sm font-bold ${s.color}`}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                  {shiftResult.cancellationsTotal > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs">
                      <span className="font-semibold text-amber-800">Cancellations: </span>
                      <span className="text-amber-700">{shiftResult.cancellationsCount}× · {fmt(shiftResult.cancellationsTotal)}</span>
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-gray-400 text-center leading-relaxed">
                Export from MY orderbird → Reports → Z-Report → Export CSV
              </p>
            </div>

            {/* ── Right panel ── */}
            <div className="flex-1 min-w-0 space-y-5">

              {/* Weekly: category bars + product table */}
              {reportType === 'weekly' && weeklyResult?.summary && (
                <>
                  {/* Revenue splits */}
                  <div className="grid grid-cols-2 gap-4">
                    {weeklyResult.summary.grossTotal > 0 && (
                      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Gross Revenue Split</p>
                        {[
                          { label:'Food (7% VAT)',    value:weeklyResult.summary.grossFood,   color:'#2E7D32' },
                          { label:'Drinks (19% VAT)', value:weeklyResult.summary.grossDrinks, color:'#1565C0' },
                        ].map(row => {
                          const p = weeklyResult.summary!.grossTotal > 0 ? (row.value / weeklyResult.summary!.grossTotal) * 100 : 0;
                          return (
                            <div key={row.label} className="mb-2 last:mb-0">
                              <div className="flex justify-between text-xs mb-1"><span className="text-gray-700 font-medium">{row.label}</span><span className="text-gray-500">{fmt(row.value)} · {p.toFixed(1)}%</span></div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width:`${p}%`, backgroundColor:row.color }} /></div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {(weeklyResult.summary.inhouseTotal > 0 || weeklyResult.summary.takeawayTotal > 0) && (
                      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">In-house vs Takeaway</p>
                        {[
                          { label:'In-house',  value:weeklyResult.summary.inhouseTotal,  color:'#2E7D32' },
                          { label:'Takeaway',  value:weeklyResult.summary.takeawayTotal, color:'#E65100' },
                        ].map(row => {
                          const p = weeklyResult.summary!.grossTotal > 0 ? (row.value / weeklyResult.summary!.grossTotal) * 100 : 0;
                          return (
                            <div key={row.label} className="mb-2 last:mb-0">
                              <div className="flex justify-between text-xs mb-1"><span className="text-gray-700 font-medium">{row.label}</span><span className="text-gray-500">{fmt(row.value)} · {p.toFixed(1)}%</span></div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width:`${p}%`, backgroundColor:row.color }} /></div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Categories */}
                  {topCats.length > 0 && (
                    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Revenue by Category</p>
                      <div className="space-y-2">
                        {topCats.map(([cat, rev]) => {
                          const p = weeklyResult.summary!.grossTotal > 0 ? (rev / weeklyResult.summary!.grossTotal) * 100 : 0;
                          return (
                            <div key={cat}>
                              <div className="flex justify-between text-xs mb-1"><span className="text-gray-700 font-medium">{cat}</span><span className="text-gray-500">{fmt(rev)} · {p.toFixed(1)}%</span></div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#2E7D32] rounded-full" style={{ width:`${p}%` }} /></div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Products table */}
                  {weeklyResult.rows.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">All Products</p>
                        <p className="text-xs text-gray-400">{weeklyResult.rows.length} products · page {weeklyPage+1} of {Math.ceil(weeklyResult.rows.length/PAGE_SIZE)}</p>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-200">
                                {['#','Product','Qty','Unit €','Revenue','In-house','Takeaway','% Share'].map(h => (
                                  <th key={h} className={`px-3 py-2.5 font-semibold text-gray-500 uppercase tracking-wide ${h==='#'||h==='Product' ? 'text-left' : 'text-right'}`}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {weeklyResult.rows.slice(weeklyPage*PAGE_SIZE, (weeklyPage+1)*PAGE_SIZE).map((r, i) => {
                                const rank = weeklyPage*PAGE_SIZE + i + 1;
                                const p    = weeklyResult.summary!.grossTotal > 0 ? (r.total_price/weeklyResult.summary!.grossTotal)*100 : 0;
                                return (
                                  <tr key={i} className="hover:bg-gray-50">
                                    <td className="px-3 py-2 text-gray-400 tabular-nums">{rank}</td>
                                    <td className="px-3 py-2 text-gray-900 font-medium max-w-[220px] truncate">{r.item_name}</td>
                                    <td className="px-3 py-2 text-right text-gray-600 tabular-nums">{r.quantity.toLocaleString('de-DE')}</td>
                                    <td className="px-3 py-2 text-right text-gray-500 tabular-nums">{r.unit_price>0?fmt(r.unit_price):'—'}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-gray-900 tabular-nums">{fmt(r.total_price)}</td>
                                    <td className="px-3 py-2 text-right text-gray-500 tabular-nums">{r.inhouse_revenue>0?fmt(r.inhouse_revenue):'—'}</td>
                                    <td className="px-3 py-2 text-right text-gray-500 tabular-nums">{r.takeaway_revenue>0?fmt(r.takeaway_revenue):'—'}</td>
                                    <td className="px-3 py-2 text-right text-gray-400 tabular-nums">{p.toFixed(1)}%</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50">
                          <button onClick={() => setWeeklyPage(p => Math.max(0, p-1))} disabled={weeklyPage===0} className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft size={14} /> Prev</button>
                          <span className="text-xs text-gray-400">{weeklyPage*PAGE_SIZE+1}–{Math.min((weeklyPage+1)*PAGE_SIZE, weeklyResult.rows.length)} of {weeklyResult.rows.length}</span>
                          <button onClick={() => setWeeklyPage(p => Math.min(Math.ceil(weeklyResult.rows.length/PAGE_SIZE)-1, p+1))} disabled={weeklyPage>=Math.ceil(weeklyResult.rows.length/PAGE_SIZE)-1} className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed">Next <ChevronRight size={14} /></button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Shift: category breakdown */}
              {reportType === 'shift' && shiftResult && !shiftResult.error && (
                <div className="space-y-4">
                  {/* Main categories */}
                  {shiftResult.categories.filter(c => c.isMain).length > 0 && (
                    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Main Categories</p>
                      {shiftResult.categories.filter(c => c.isMain).map(cat => {
                        const p = shiftResult.grossTotal > 0 ? (cat.revenue / shiftResult.grossTotal) * 100 : 0;
                        return (
                          <div key={cat.name} className="mb-3 last:mb-0">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="font-medium text-gray-700">{cat.name}</span>
                              <span className="text-gray-500">{fmt(cat.revenue)} · {p.toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#2E7D32] rounded-full" style={{ width:`${p}%` }} /></div>
                            <div className="flex gap-4 mt-1 text-xs text-gray-400">
                              <span>In-house: {fmt(cat.inhouseRevenue)}</span>
                              {cat.takeawayRevenue > 0 && <span>Takeaway: {fmt(cat.takeawayRevenue)}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Sub-categories */}
                  {shiftResult.categories.filter(c => !c.isMain && c.revenue > 0).length > 0 && (
                    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Categories</p>
                      {shiftResult.categories.filter(c => !c.isMain && c.revenue > 0).sort((a,b) => b.revenue - a.revenue).slice(0, 12).map(cat => {
                        const p = shiftResult.grossTotal > 0 ? (cat.revenue / shiftResult.grossTotal) * 100 : 0;
                        return (
                          <div key={cat.name} className="mb-2 last:mb-0">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-gray-700">{cat.name} <span className="text-gray-400">×{cat.quantity}</span></span>
                              <span className="text-gray-500">{fmt(cat.revenue)} · {p.toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width:`${p}%` }} /></div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Monthly: summary cards + channel split */}
              {reportType === 'monthly' && monthlyResult && !monthlyResult.error && (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                      {MONTHS[monthlyResult.month-1]} {monthlyResult.year} · Z-Reports {monthlyResult.fromZ}–{monthlyResult.toZ}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label:'Gross Revenue', value: fmt(monthlyResult.grossTotal),         color:'text-[#1B5E20]'  },
                        { label:'Net Revenue',   value: fmt(monthlyResult.netTotal),            color:'text-blue-700'   },
                        { label:'VAT',           value: fmt(monthlyResult.vatTotal),            color:'text-amber-700'  },
                        { label:'Tips',          value: fmt(monthlyResult.tips),               color:'text-purple-700' },
                      ].map(s => (
                        <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                          <p className="text-xs text-gray-400 font-semibold uppercase mb-1">{s.label}</p>
                          <p className={`text-sm font-bold ${s.color}`}>{s.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Revenue Split</p>
                    {[
                      { label:'Food (7% VAT)',    value:monthlyResult.grossFood,   color:'#2E7D32' },
                      { label:'Drinks (19% VAT)', value:monthlyResult.grossDrinks, color:'#1565C0' },
                      { label:'In-house',         value:monthlyResult.inhouseTotal,  color:'#0F766E' },
                      { label:'Takeaway',         value:monthlyResult.takeawayTotal, color:'#E65100' },
                    ].map(row => {
                      const p = monthlyResult.grossTotal > 0 ? (row.value / monthlyResult.grossTotal) * 100 : 0;
                      return (
                        <div key={row.label} className="mb-2 last:mb-0">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-700 font-medium">{row.label}</span>
                            <span className="text-gray-500">{fmt(row.value)} · {p.toFixed(1)}%</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width:`${p}%`, backgroundColor:row.color }} /></div>
                        </div>
                      );
                    })}
                  </div>
                  {monthlyResult.cancellationsTotal > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs">
                      <span className="font-semibold text-amber-800">Cancellations: </span>
                      <span className="text-amber-700">{monthlyResult.cancellationsCount}× · {fmt(monthlyResult.cancellationsTotal)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Empty state */}
              {!weeklyResult && !shiftResult && !monthlyResult && !parseError && (
                <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-gray-200 rounded-xl gap-3">
                  <Upload size={40} className="text-gray-200" />
                  <p className="text-sm text-gray-400">
                    {reportType === 'shift'   ? 'Drop a shift Z-report CSV to preview data'   :
                     reportType === 'monthly' ? 'Drop a monthly Z-report CSV to preview data' :
                                               'Drop a weekly Z-report CSV to preview data'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          DAILY P&L TAB
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'daily' && (
        !location ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2 border border-dashed border-gray-200 rounded-xl">
            <MapPin size={36} className="text-gray-200" />
            <p className="text-sm">Select a location to view the daily P&amp;L</p>
          </div>
        ) : (() => {
          const totalCols = dailyCols.length + 2; // label + day/week cols + month total

          // Helper: render one P&L block (lunch / dinner / total) as a <tbody>
          const renderBlock = (
            map:      Record<number, DayAgg>,
            mTotal:   DayAgg | null,
            label:    string,
            headerBg: string,
          ) => (
            <tbody key={label}>
              {/* Block banner — sticky left so label stays visible when scrolling right */}
              <tr>
                <td colSpan={totalCols}
                  className="sticky left-0 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white"
                  style={{ backgroundColor: headerBg }}>
                  {label}
                </td>
              </tr>
              {DAILY_ROWS.map((row, i) => {
                if (row.type === 'section') {
                  return (
                    <tr key={i}>
                      <td colSpan={totalCols}
                        className="sticky left-0 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest"
                        style={{ backgroundColor:'#f3f4f6', color:'#6b7280', letterSpacing:'0.07em' }}>
                        {row.label}
                      </td>
                    </tr>
                  );
                }
                const isBold = row.type === 'bold';
                const isPct  = row.type === 'pct';
                const bg     = isBold ? '#f0fdf4' : '#ffffff';
                return (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50/60 group" style={{ backgroundColor:bg }}>
                    <td className={`sticky left-0 z-10 px-4 py-2 whitespace-nowrap border-r border-gray-100 group-hover:bg-gray-50/60 transition-colors ${
                      isBold ? 'font-bold text-gray-900' : isPct ? 'pl-8 text-gray-400 italic' : 'text-gray-700'
                    }`} style={{ backgroundColor:bg }}>
                      {row.label}
                    </td>
                    {dailyCols.map((col, ci) => {
                      if (col.type === 'day') {
                        const isCurDay = year===todayYear && month===todayMonth && col.day===todayDay;
                        return (
                          <td key={ci} className={`py-2 text-right tabular-nums ${isBold ? 'font-bold' : ''}`}
                            style={{ paddingLeft:4, paddingRight:8, backgroundColor: isCurDay ? 'rgba(59,130,246,0.04)' : undefined }}>
                            {renderDayCell(row, map[col.day] ?? null)}
                          </td>
                        );
                      } else {
                        const present = col.wDays.filter(d => map[d]);
                        const wAgg = present.length > 0
                          ? present.reduce<DayAgg>((acc, d) => addAgg(acc, map[d]), { ...EMPTY_AGG })
                          : null;
                        return (
                          <td key={ci} className={`py-2 text-right tabular-nums ${isBold ? 'font-bold' : ''}`}
                            style={{ paddingLeft:4, paddingRight:6, backgroundColor:'#fffbeb', borderLeft:'1px solid #fde68a', borderRight:'1px solid #fde68a' }}>
                            {isPct ? <span className="text-gray-300">—</span> : renderDayCell(row, wAgg)}
                          </td>
                        );
                      }
                    })}
                    <td className={`py-2 text-right tabular-nums border-l border-gray-200 ${isBold ? 'font-bold' : ''}`}
                      style={{ paddingLeft:4, paddingRight:8 }}>
                      {isPct || !mTotal
                        ? <span className="text-gray-300">—</span>
                        : renderDayCell(row, mTotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          );

          return (
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
                <table className="text-xs border-collapse" style={{ minWidth: LABEL_W + (dailyCols.length + 1) * COL_W_D }}>
                  {/* Sticky column header */}
                  <thead className="sticky top-0 z-30">
                    <tr style={{ backgroundColor:'#111827' }}>
                      <th className="sticky left-0 z-20 px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap border-r border-gray-700"
                        style={{ backgroundColor:'#111827', minWidth:LABEL_W, width:LABEL_W }}>
                        METRIC / DAY · {MONTHS[month-1]} {year}
                      </th>
                      {dailyCols.map((col, ci) => {
                        if (col.type === 'day') {
                          const hasData  = !!totalMap[col.day];
                          const isCurDay = year===todayYear && month===todayMonth && col.day===todayDay;
                          const isSun    = col.dow === 'Sun';
                          return (
                            <th key={ci} className="py-2 text-right font-bold whitespace-nowrap tabular-nums"
                              style={{ minWidth:COL_W_D, width:COL_W_D, paddingLeft:4, paddingRight:8,
                                color: isCurDay ? '#ffffff' : hasData ? '#93c5fd' : '#4b5563',
                                borderBottom: isCurDay ? '2px solid #3b82f6' : isSun ? '2px solid #7c3aed' : 'none',
                                borderRight: isSun ? '1px solid #374151' : undefined }}>
                              <div style={{ fontSize:9, fontWeight:400, opacity:0.55, marginBottom:1 }}>{col.dow}</div>
                              <div>{col.day}</div>
                            </th>
                          );
                        } else {
                          return (
                            <th key={ci} className="py-2 text-right font-bold whitespace-nowrap tabular-nums"
                              style={{ minWidth:COL_W_D, width:COL_W_D, paddingLeft:4, paddingRight:8,
                                color:'#fbbf24', backgroundColor:'#1c1917',
                                borderLeft:'1px solid #374151', borderRight:'1px solid #374151' }}>
                              <div style={{ fontSize:9, fontWeight:400, opacity:0.6, marginBottom:1 }}>WEEK</div>
                              <div>{col.label}</div>
                            </th>
                          );
                        }
                      })}
                      <th className="py-2 text-right font-bold whitespace-nowrap border-l border-gray-700"
                        style={{ minWidth:COL_W_D+8, paddingLeft:4, paddingRight:8, color:'#e5e7eb' }}>
                        <div style={{ fontSize:9, fontWeight:400, opacity:0.55, marginBottom:1 }}>TOTAL</div>
                        <div>{MONTHS[month-1]}</div>
                      </th>
                    </tr>
                  </thead>

                  {renderBlock(lunchMap,  lunchMonthTotal,  '☀️  Lunch Shift',  '#92400E')}
                  {renderBlock(dinnerMap, dinnerMonthTotal, '🌙  Dinner Shift', '#1E3A5F')}
                  {renderBlock(totalMap,  totalMonthTotal,  '∑   Daily Total',  '#111827')}
                </table>
              </div>
              <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {shiftRows.length} shift report{shiftRows.length !== 1 ? 's' : ''} ·{' '}
                  {Object.keys(totalMap).length} day{Object.keys(totalMap).length !== 1 ? 's' : ''} with data
                </span>
                {totalMonthTotal && (
                  <span className="text-xs text-gray-400">
                    Monthly gross: <span className="font-bold text-[#1B5E20]">{fmt(totalMonthTotal.grossTotal)}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })()
      )}

      {/* ══════════════════════════════════════════════════════════════════
          WEEKLY P&L TAB
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'weekly' && (
        !location ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2 border border-dashed border-gray-200 rounded-xl">
            <MapPin size={36} className="text-gray-200" />
            <p className="text-sm">Select a location to view the weekly P&amp;L</p>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
              <table className="text-xs border-collapse" style={{ minWidth: LABEL_W + (TOTAL_WEEKS + 1) * COL_W_WK }}>
                <thead className="sticky top-0 z-30">
                  <tr style={{ backgroundColor:'#111827' }}>
                    <th className="sticky left-0 z-20 px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap border-r border-gray-700"
                      style={{ backgroundColor:'#111827', minWidth:LABEL_W, width:LABEL_W }}>
                      METRIC / PERIOD · {year}
                    </th>
                    {Array.from({ length: TOTAL_WEEKS }, (_, i) => i+1).map(kw => {
                      const hasWeek  = !!weekMap[kw];
                      const isCurWk  = kw === cwk;
                      return (
                        <th key={kw} className="py-3 text-right font-bold whitespace-nowrap tabular-nums"
                          style={{ minWidth:COL_W_WK, width:COL_W_WK, paddingLeft:4, paddingRight:10,
                            color: isCurWk ? '#ffffff' : hasWeek ? '#93c5fd' : '#4b5563',
                            borderBottom: isCurWk ? '2px solid #3b82f6' : 'none' }}>
                          KW{kw}
                        </th>
                      );
                    })}
                    <th className="py-3 text-right font-bold whitespace-nowrap border-l border-gray-700"
                      style={{ minWidth:COL_W_WK+8, paddingLeft:4, paddingRight:10, color:'#e5e7eb' }}>
                      FY {year}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {WEEKLY_ROWS.map((row, i) => {
                    if (row.type === 'section') {
                      return (
                        <tr key={i}>
                          <td colSpan={TOTAL_WEEKS + 2} className="sticky left-0 px-4 py-2 text-xs font-bold uppercase tracking-widest"
                            style={{ backgroundColor:'#f3f4f6', color:'#374151', letterSpacing:'0.08em' }}>
                            {row.label}
                          </td>
                        </tr>
                      );
                    }
                    const isBold = row.type === 'bold';
                    const isPct  = row.type === 'pct';
                    const bg     = isBold ? '#f0fdf4' : '#ffffff';
                    return (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50/60 group" style={{ backgroundColor:bg }}>
                        <td className={`sticky left-0 z-10 px-4 py-2 whitespace-nowrap border-r border-gray-100 group-hover:bg-gray-50/60 transition-colors ${
                          isBold ? 'font-bold text-gray-900' : isPct ? 'pl-8 text-gray-400 italic' : 'text-gray-700'
                        }`} style={{ backgroundColor:bg }}>
                          {row.label}
                        </td>
                        {Array.from({ length: TOTAL_WEEKS }, (_, j) => j+1).map(kw => {
                          const isCurWk = kw === cwk;
                          return (
                            <td key={kw} className={`py-2 text-right tabular-nums ${isBold ? 'font-bold' : ''}`}
                              style={{ paddingLeft:4, paddingRight:10, backgroundColor: isCurWk ? 'rgba(59,130,246,0.04)' : undefined }}>
                              {renderWeeklyCell(row, kw)}
                            </td>
                          );
                        })}
                        <td className={`py-2 text-right tabular-nums border-l border-gray-200 ${isBold ? 'font-bold' : ''}`}
                          style={{ paddingLeft:4, paddingRight:10 }}>
                          {isPct || !yearTotal ? <span className="text-gray-300">—</span> : (() => {
                            const val = row.getValue?.(yearTotal, null) ?? null;
                            if (val === null) return <span className="text-gray-300">—</span>;
                            if (row.format === 'currency') return <span className={row.color==='blue'?'text-blue-700':'text-gray-900'}>{fmtNum(val)}</span>;
                            return <span className="text-gray-300">—</span>;
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-400">{weeklyImports.length} week{weeklyImports.length!==1?'s':''} imported</span>
              {yearTotal && (
                <span className="text-xs text-gray-400">
                  Total gross {year}: <span className="font-bold text-[#1B5E20]">{fmt(yearTotal.total_revenue)}</span>
                </span>
              )}
            </div>
          </div>
        )
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MONTHLY P&L TAB
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'monthly' && (
        !location ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2 border border-dashed border-gray-200 rounded-xl">
            <MapPin size={36} className="text-gray-200" />
            <p className="text-sm">Select a location to view the monthly P&amp;L</p>
          </div>
        ) : monthlyReports.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2 border border-dashed border-gray-200 rounded-xl">
            <TableProperties size={36} className="text-gray-200" />
            <p className="text-sm font-medium">No monthly reports for {location.name} · {year}</p>
            <p className="text-xs">Upload a monthly Z-report CSV in the Upload tab</p>
            <button onClick={() => setActiveTab('upload')}
              className="mt-1 px-4 py-2 bg-[#1B5E20] text-white text-xs font-semibold rounded-lg hover:bg-[#2E7D32] transition-colors">
              Go to Upload
            </button>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
              <table className="text-xs border-collapse" style={{ minWidth: LABEL_W + 13 * COL_W_MN }}>
                <thead className="sticky top-0 z-30">
                  <tr style={{ backgroundColor:'#111827' }}>
                    <th className="sticky left-0 z-20 px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap border-r border-gray-700"
                      style={{ backgroundColor:'#111827', minWidth:LABEL_W, width:LABEL_W }}>
                      METRIC / MONTH · {year}
                    </th>
                    {MONTHS.map((mn, i) => {
                      const hasData   = !!monthMap[i+1];
                      const isCurMon  = year === todayYear && i+1 === todayMonth;
                      return (
                        <th key={mn} className="py-3 text-right font-bold whitespace-nowrap tabular-nums"
                          style={{ minWidth:COL_W_MN, width:COL_W_MN, paddingLeft:4, paddingRight:10,
                            color: isCurMon ? '#ffffff' : hasData ? '#93c5fd' : '#4b5563',
                            borderBottom: isCurMon ? '2px solid #3b82f6' : 'none' }}>
                          {mn}
                        </th>
                      );
                    })}
                    <th className="py-3 text-right font-bold whitespace-nowrap border-l border-gray-700"
                      style={{ minWidth:COL_W_MN+8, paddingLeft:4, paddingRight:10, color:'#e5e7eb' }}>
                      FY {year}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MONTHLY_ROWS.map((row, i) => {
                    if (row.type === 'section') {
                      return (
                        <tr key={i}>
                          <td colSpan={14} className="sticky left-0 px-4 py-2 text-xs font-bold uppercase tracking-widest"
                            style={{ backgroundColor:'#f3f4f6', color:'#374151', letterSpacing:'0.08em' }}>
                            {row.label}
                          </td>
                        </tr>
                      );
                    }
                    const isBold = row.type === 'bold';
                    const isPct  = row.type === 'pct';
                    const bg     = isBold ? '#f0fdf4' : '#ffffff';
                    return (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50/60 group" style={{ backgroundColor:bg }}>
                        <td className={`sticky left-0 z-10 px-4 py-2 whitespace-nowrap border-r border-gray-100 group-hover:bg-gray-50/60 transition-colors ${
                          isBold ? 'font-bold text-gray-900' : isPct ? 'pl-8 text-gray-400 italic' : 'text-gray-700'
                        }`} style={{ backgroundColor:bg }}>
                          {row.label}
                        </td>
                        {MONTHS.map((_, mi) => {
                          const isCurMon = year === todayYear && mi+1 === todayMonth;
                          return (
                            <td key={mi} className={`py-2 text-right tabular-nums ${isBold ? 'font-bold' : ''}`}
                              style={{ paddingLeft:4, paddingRight:10, backgroundColor: isCurMon ? 'rgba(59,130,246,0.04)' : undefined }}>
                              {renderMonthCell(row, mi+1)}
                            </td>
                          );
                        })}
                        <td className={`py-2 text-right tabular-nums border-l border-gray-200 ${isBold ? 'font-bold' : ''}`}
                          style={{ paddingLeft:4, paddingRight:10 }}>
                          {isPct || !yearMonthTotal ? <span className="text-gray-300">—</span> : (() => {
                            const val = row.getValue?.(yearMonthTotal, null) ?? null;
                            if (val === null) return <span className="text-gray-300">—</span>;
                            if (row.format === 'currency') return <span className={row.color === 'blue' ? 'text-blue-700' : 'text-gray-900'}>{fmtNum(val)}</span>;
                            if (row.format === 'count')    return <span className="text-gray-700">{Math.round(val)}</span>;
                            return <span className="text-gray-300">—</span>;
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-400">{monthlyReports.length} month{monthlyReports.length !== 1 ? 's' : ''} imported</span>
              {yearMonthTotal && (
                <span className="text-xs text-gray-400">
                  Total gross {year}: <span className="font-bold text-[#1B5E20]">{fmt(yearMonthTotal.gross_total ?? 0)}</span>
                </span>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}
