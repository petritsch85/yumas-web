'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';
import {
  Upload, FileCheck, AlertCircle, DatabaseZap,
  MapPin, CalendarDays, BarChart3, TableProperties,
  ChevronLeft, ChevronRight, TrendingUp, Receipt, Percent, Euro,
  Loader2, SlidersHorizontal, Ban,
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
  shift_type:          'lunch' | 'dinner' | null;
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

type WeeklyBatchItem = {
  fileName: string;
  result:   WeeklyParseResult;
  status:   'pending' | 'saving' | 'saved' | 'error';
  errorMsg?: string;
};

type ShiftConfidence = 'high' | 'medium' | 'low';

type ShiftBatchItem = {
  fileName:          string;
  result:            ShiftParseResult;
  detectedType:      'lunch' | 'dinner';
  confidence:        ShiftConfidence;
  manualOverride?:   'lunch' | 'dinner';
  status:            'pending' | 'saving' | 'saved' | 'error';
  errorMsg?:         string;
};

type ForecastSettings = {
  shift_type:    'lunch' | 'dinner';
  week_base_net: number;
  growth_rate:   number;
  weight_mon:    number; weight_tue: number; weight_wed: number; weight_thu: number;
  weight_fri:    number; weight_sat: number; weight_sun: number;
};

// Draft: weights stored as pct strings (Mon–Sat only; Sun auto-computed)
type DraftSettings = {
  weekBaseNet: string;
  growthRate:  string;
  mon: string; tue: string; wed: string; thu: string; fri: string; sat: string;
};

type ClosureDay = {
  id:           string;
  closure_date: string;
  shift_type:   'lunch' | 'dinner' | 'all';
  reason:       string | null;
};

const DEFAULT_DRAFT: DraftSettings = {
  weekBaseNet:'0', growthRate:'0',
  mon:'14.3', tue:'14.3', wed:'14.3', thu:'14.3', fri:'14.3', sat:'14.3',
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
const QUARTER_MONTHS: [number,number,number][] = [[1,2,3],[4,5,6],[7,8,9],[10,11,12]];

type DayCol  = { type: 'day';  dateKey: string; day: number; month: number; dow: string };
type WeekCol = { type: 'week'; label: string; wDateKeys: string[] };
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

function sumMap(map: Record<string, DayAgg>): DayAgg | null {
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

  // Weekly reports have Mon–Sun day columns before the grand total column.
  // Scan from the RIGHT to find the first non-zero numeric value in a row.
  const lastNum = (cols: string[]): number => {
    for (let i = cols.length - 1; i >= 1; i--) {
      const n = parseNum(cols[i]);
      if (n !== 0) return n;
    }
    return 0;
  };

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
        if (first === 'tip') tips = lastNum(cols);
        break;
      case 'gross turnover':
        if      (first.startsWith('7.'))  grossFood   = lastNum(cols);
        else if (first.startsWith('19.')) grossDrinks = lastNum(cols);
        else if (first === 'total')       grossTotal  = lastNum(cols);
        break;
      case 'net turnover':
        if (first === 'total') netTotal = lastNum(cols);
        break;
      case 'taxes':
        if (first === 'total') taxTotal = lastNum(cols);
        break;
      case 'main categories':
        if (cols[0]) { inhouseTotal += lastNum(cols.slice(0, 9)); takeawayTotal += lastNum(cols.slice(9)); }
        break;
      case 'categories':
        if (cols[0]) { const v = lastNum(cols); if (v > 0) categoryRevenue[cols[0]] = v; }
        break;
      case 'products': {
        if (!cols[0]) break;
        const qty = parseNum(cols[2]), rev = lastNum(cols);
        if (rev > 0 || qty > 0) rows.push({ item_name:cols[0], category:null, quantity:qty, unit_price:qty>0?Math.round((rev/qty)*100)/100:0, total_price:rev, inhouse_revenue:0, takeaway_revenue:0 });
        break;
      }
    }
  }

  if (rows.length === 0 && grossTotal === 0)
    return { rows:[], summary:null, categoryRevenue:{}, error:'Could not parse this file as an Orderbird Z-report.' };

  if (grossTotal === 0) grossTotal = grossFood + grossDrinks;
  // Fallback: derive net from gross minus VAT if parser still missed it
  if (netTotal === 0 && grossTotal > 0 && taxTotal > 0) netTotal = grossTotal - taxTotal;

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
// SHIFT AUTO-CLASSIFIER
// ─────────────────────────────────────────────────────────────────────────────

const LUNCH_KEYWORDS  = /burrito|bowl|taco|enchilada|nacho|quesadilla/i;
const DINNER_KEYWORDS = /cocktail|beer|bier|wine|wein|gin|rum|tequila|vodka|whisky|whiskey|spirit|prosecco|sekt|shot|aperol|campari|margarita|mojito|negroni/i;

function classifyShiftType(r: ShiftParseResult): { type: 'lunch' | 'dinner'; confidence: ShiftConfidence } {
  if (r.grossTotal === 0) return { type: 'dinner', confidence: 'low' };

  let lunchScore  = 0;
  let dinnerScore = 0;

  // Signal 1 — drinks share (19% VAT): strongest signal; no alcohol at lunch
  const drinksShare = r.grossDrinks / r.grossTotal;
  if      (drinksShare < 0.03) lunchScore  += 3;
  else if (drinksShare < 0.08) lunchScore  += 1;
  else if (drinksShare > 0.20) dinnerScore += 3;
  else if (drinksShare > 0.12) dinnerScore += 1;

  // Signal 2 — food share (7% VAT): lunch is almost pure food
  const foodShare = r.grossFood / r.grossTotal;
  if (foodShare > 0.92) lunchScore += 1;

  // Signal 3 — category keyword scan
  for (const cat of r.categories) {
    if (LUNCH_KEYWORDS.test(cat.name))  { lunchScore  += 2; break; }
    if (DINNER_KEYWORDS.test(cat.name)) { dinnerScore += 2; break; }
  }

  // Signal 4 — tips share: evening guests tip more
  const tipsShare = r.grossTotal > 0 ? r.tips / r.grossTotal : 0;
  if      (tipsShare < 0.015) lunchScore  += 1;
  else if (tipsShare > 0.04)  dinnerScore += 1;

  const type = lunchScore >= dinnerScore ? 'lunch' : 'dinner';
  const diff = Math.abs(lunchScore - dinnerScore);
  const confidence: ShiftConfidence = diff >= 3 ? 'high' : diff >= 1 ? 'medium' : 'low';

  return { type, confidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// FORECAST ENGINE
// ─────────────────────────────────────────────────────────────────────────────

// DOW_KEYS indexed by JS getUTCDay() (0=Sun … 6=Sat)
const DOW_WEIGHT_KEYS = [
  'weight_sun','weight_mon','weight_tue','weight_wed',
  'weight_thu','weight_fri','weight_sat',
] as const;

function computeDailyForecast(dateKey: string, s: ForecastSettings): number {
  if (!s.week_base_net) return 0;
  const d       = new Date(dateKey + 'T12:00:00Z');
  const today   = new Date();
  const refMs   = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const weeksAhead = Math.round((d.getTime() - refMs) / (7 * 24 * 3600 * 1000));
  const growth  = (1 + s.growth_rate / 100) ** Math.max(0, weeksAhead);
  const weight  = s[DOW_WEIGHT_KEYS[d.getUTCDay()]] as number;
  return s.week_base_net * weight * growth;
}

function settingsToDraft(s: ForecastSettings): DraftSettings {
  return {
    weekBaseNet: s.week_base_net.toString(),
    growthRate:  s.growth_rate.toString(),
    mon: (s.weight_mon * 100).toFixed(1),
    tue: (s.weight_tue * 100).toFixed(1),
    wed: (s.weight_wed * 100).toFixed(1),
    thu: (s.weight_thu * 100).toFixed(1),
    fri: (s.weight_fri * 100).toFixed(1),
    sat: (s.weight_sat * 100).toFixed(1),
  };
}

function draftToPayload(d: DraftSettings, type: 'lunch'|'dinner', locationId: string) {
  const mon = Math.max(0, parseFloat(d.mon) || 0);
  const tue = Math.max(0, parseFloat(d.tue) || 0);
  const wed = Math.max(0, parseFloat(d.wed) || 0);
  const thu = Math.max(0, parseFloat(d.thu) || 0);
  const fri = Math.max(0, parseFloat(d.fri) || 0);
  const sat = Math.max(0, parseFloat(d.sat) || 0);
  const sun = Math.max(0, 100 - mon - tue - wed - thu - fri - sat);
  const total = mon + tue + wed + thu + fri + sat + sun || 100;
  return {
    location_id:   locationId,
    shift_type:    type,
    week_base_net: parseFloat(d.weekBaseNet) || 0,
    growth_rate:   parseFloat(d.growthRate)  || 0,
    weight_mon: mon/total, weight_tue: tue/total, weight_wed: wed/total,
    weight_thu: thu/total, weight_fri: fri/total, weight_sat: sat/total,
    weight_sun: sun/total,
    updated_at: new Date().toISOString(),
  };
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
  const [activeTab,   setActiveTab]   = useState<'upload'|'daily'>('daily');
  const [subTab,      setSubTab]      = useState<'daily'|'weekly'|'monthly'>('daily');
  const [reportType,  setReportType]  = useState<'weekly'|'shift'|'monthly'>('shift');

  // Shared controls
  const [location, setLocation] = useState<Location | null>(null);
  const [year,     setYear]     = useState(new Date().getFullYear());
  const [quarter,  setQuarter]  = useState<number>(Math.ceil((new Date().getMonth() + 1) / 3));

  // Upload state
  const [fileName,       setFileName]       = useState<string | null>(null);
  const [weeklyResult,   setWeeklyResult]   = useState<WeeklyParseResult | null>(null);
  const [weeklyBatch,    setWeeklyBatch]    = useState<WeeklyBatchItem[]>([]);
  const [shiftBatch,     setShiftBatch]     = useState<ShiftBatchItem[]>([]);
  const [monthlyResult,  setMonthlyResult]  = useState<MonthlyParseResult | null>(null);
  const [parseError,     setParseError]     = useState<string | null>(null);
  const [importing,     setImporting]     = useState(false);
  const [isDragging,    setIsDragging]    = useState(false);
  const [weeklyPage,    setWeeklyPage]    = useState(0);

  // Forecast
  const [showForecastPanel, setShowForecastPanel] = useState(false);
  const [lunchDraft,  setLunchDraft]  = useState<DraftSettings>(DEFAULT_DRAFT);
  const [dinnerDraft, setDinnerDraft] = useState<DraftSettings>(DEFAULT_DRAFT);
  const [savingForecast, setSavingForecast] = useState(false);

  // Closures
  const [showClosuresPanel, setShowClosuresPanel] = useState(false);
  const [closureForm, setClosureForm] = useState<{ date: string; shiftType: 'lunch'|'dinner'|'all'; reason: string }>
    ({ date: '', shiftType: 'all', reason: '' });
  const [addingClosure, setAddingClosure] = useState(false);

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
    enabled: !!location && activeTab === 'daily',
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
    enabled: !!location && activeTab === 'daily',
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

  // Shift reports for daily view — fetch the full quarter at once
  const { data: shiftRows = [] } = useQuery({
    queryKey: ['shift-reports', location?.id, year, quarter],
    enabled: !!location && activeTab === 'daily',
    queryFn: async () => {
      const [firstM, , lastM] = QUARTER_MONTHS[quarter - 1];
      const qStart = `${year}-${String(firstM).padStart(2,'0')}-01`;
      const qEnd   = `${year}-${String(lastM).padStart(2,'0')}-${String(daysInMonth(year, lastM)).padStart(2,'0')}`;
      const { data } = await supabase
        .from('shift_reports')
        .select('report_date,z_report_number,shift_type,gross_total,gross_food,gross_beverages,net_total,vat_total,tips,inhouse_total,takeaway_total,cancellations_count,cancellations_total')
        .eq('location_id', location!.id)
        .gte('report_date', qStart)
        .lte('report_date', qEnd)
        .order('report_date', { ascending: true });
      return (data ?? []) as ShiftRow[];
    },
  });

  // Shift reports for full year — used in weekly summary (lunch/dinner split by KW)
  const { data: yearShiftRows = [] } = useQuery({
    queryKey: ['shift-reports-year', location?.id, year],
    enabled: !!location && activeTab === 'daily' && subTab === 'weekly',
    queryFn: async () => {
      const { data } = await supabase
        .from('shift_reports')
        .select('report_date,shift_type,net_total')
        .eq('location_id', location!.id)
        .gte('report_date', `${year}-01-01`)
        .lte('report_date', `${year}-12-31`)
        .order('report_date', { ascending: true });
      return (data ?? []) as Pick<ShiftRow, 'report_date'|'shift_type'|'net_total'>[];
    },
  });

  // Forecast settings
  const { data: forecastSettings = [] } = useQuery({
    queryKey: ['forecast-settings', location?.id],
    enabled:  !!location,
    queryFn: async () => {
      const { data } = await supabase
        .from('forecast_settings')
        .select('shift_type,week_base_net,growth_rate,weight_mon,weight_tue,weight_wed,weight_thu,weight_fri,weight_sat,weight_sun')
        .eq('location_id', location!.id);
      return (data ?? []) as ForecastSettings[];
    },
  });

  // Closure days — fetch all for this location (across all years)
  const { data: closureDays = [], refetch: refetchClosures } = useQuery({
    queryKey: ['closure-days', location?.id],
    enabled:  !!location,
    queryFn: async () => {
      const { data } = await supabase
        .from('closure_days')
        .select('id,closure_date,shift_type,reason')
        .eq('location_id', location!.id)
        .order('closure_date', { ascending: true });
      return (data ?? []) as ClosureDay[];
    },
  });

  // Sync fetched settings → draft whenever they load or location changes
  useEffect(() => {
    const ls = forecastSettings.find(s => s.shift_type === 'lunch');
    const ds = forecastSettings.find(s => s.shift_type === 'dinner');
    setLunchDraft(ls  ? settingsToDraft(ls)  : DEFAULT_DRAFT);
    setDinnerDraft(ds ? settingsToDraft(ds) : DEFAULT_DRAFT);
  }, [forecastSettings]);

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

  // Split shifts per day into lunch / dinner using explicit shift_type when set
  const { lunchMap, dinnerMap, totalMap } = useMemo(() => {
    const lunchMap:  Record<string, DayAgg> = {};
    const dinnerMap: Record<string, DayAgg> = {};
    const totalMap:  Record<string, DayAgg> = {};

    // Group by date
    const byDate: Record<string, ShiftRow[]> = {};
    for (const sr of shiftRows) {
      if (!byDate[sr.report_date]) byDate[sr.report_date] = [];
      byDate[sr.report_date].push(sr);
    }

    for (const [dk, shifts] of Object.entries(byDate)) {
      // If every shift on this day has an explicit shift_type, use it directly
      const allTagged = shifts.every(s => s.shift_type === 'lunch' || s.shift_type === 'dinner');
      if (allTagged) {
        for (const s of shifts) {
          const agg = shiftToAgg(s);
          if (s.shift_type === 'lunch') {
            lunchMap[dk] = lunchMap[dk] ? addAgg(lunchMap[dk], agg) : agg;
          } else {
            dinnerMap[dk] = dinnerMap[dk] ? addAgg(dinnerMap[dk], agg) : agg;
          }
          totalMap[dk] = totalMap[dk] ? addAgg(totalMap[dk], agg) : agg;
        }
      } else {
        // Legacy fallback: sort ascending by Z-report number (lower = lunch)
        const sorted = [...shifts].sort((a, b) =>
          parseInt(a.z_report_number || '0', 10) - parseInt(b.z_report_number || '0', 10)
        );
        let total: DayAgg | null = null;
        if (sorted[0]) { lunchMap[dk]  = shiftToAgg(sorted[0]); total = shiftToAgg(sorted[0]); }
        if (sorted[1]) { dinnerMap[dk] = shiftToAgg(sorted[1]); total = total ? addAgg(total, shiftToAgg(sorted[1])) : shiftToAgg(sorted[1]); }
        for (let i = 2; i < sorted.length; i++) if (total) total = addAgg(total, shiftToAgg(sorted[i]));
        if (total) totalMap[dk] = total;
      }
    }
    return { lunchMap, dinnerMap, totalMap };
  }, [shiftRows]);

  const lunchQtrTotal  = useMemo(() => sumMap(lunchMap),  [lunchMap]);
  const dinnerQtrTotal = useMemo(() => sumMap(dinnerMap), [dinnerMap]);
  const totalQtrTotal  = useMemo(() => sumMap(totalMap),  [totalMap]);

  // Weekly lunch/dinner breakdown from shift data (for weekly summary)
  const { lunchWeekMap, dinnerWeekMap, totalWeekMap } = useMemo(() => {
    const lunchWeekMap:  Record<number, number> = {};
    const dinnerWeekMap: Record<number, number> = {};
    const totalWeekMap:  Record<number, number> = {};
    for (const sr of yearShiftRows) {
      const kw  = isoWeek(sr.report_date);
      const net = sr.net_total ?? 0;
      if (sr.shift_type === 'lunch')  lunchWeekMap[kw]  = (lunchWeekMap[kw]  ?? 0) + net;
      if (sr.shift_type === 'dinner') dinnerWeekMap[kw] = (dinnerWeekMap[kw] ?? 0) + net;
      totalWeekMap[kw] = (totalWeekMap[kw] ?? 0) + net;
    }
    return { lunchWeekMap, dinnerWeekMap, totalWeekMap };
  }, [yearShiftRows]);

  const lunchFYNet  = useMemo(() => Object.values(lunchWeekMap).reduce((s, v) => s + v, 0),  [lunchWeekMap]);
  const dinnerFYNet = useMemo(() => Object.values(dinnerWeekMap).reduce((s, v) => s + v, 0), [dinnerWeekMap]);
  const totalFYNet  = useMemo(() => Object.values(totalWeekMap).reduce((s, v) => s + v, 0),  [totalWeekMap]);

  // Build day + week-summary column sequence covering the full quarter
  const dailyCols = useMemo<DailyCol[]>(() => {
    const result: DailyCol[] = [];
    let wDateKeys: string[] = [];
    for (const m of QUARTER_MONTHS[quarter - 1]) {
      const mm = String(m).padStart(2, '0');
      for (let d = 1; d <= daysInMonth(year, m); d++) {
        const dd = String(d).padStart(2, '0');
        const dateKey = `${year}-${mm}-${dd}`;
        const dow = new Date(year, m - 1, d).getDay();
        result.push({ type: 'day', dateKey, day: d, month: m, dow: DOW_SHORT[dow] });
        wDateKeys.push(dateKey);
        if (dow === 0) {
          result.push({ type: 'week', label: `CW${isoWeek(dateKey)}`, wDateKeys: [...wDateKeys] });
          wDateKeys = [];
        }
      }
    }
    if (wDateKeys.length > 0) {
      const lastKey = wDateKeys[wDateKeys.length - 1];
      result.push({ type: 'week', label: `CW${isoWeek(lastKey)}`, wDateKeys: [...wDateKeys] });
    }
    return result;
  }, [quarter, year]);

  // O(1) lookup set for closed shifts: "lunch:2026-05-01", "dinner:2026-05-01"
  const closureSet = useMemo(() => {
    const s = new Set<string>();
    for (const c of closureDays) {
      if (c.shift_type === 'lunch'  || c.shift_type === 'all') s.add(`lunch:${c.closure_date}`);
      if (c.shift_type === 'dinner' || c.shift_type === 'all') s.add(`dinner:${c.closure_date}`);
    }
    return s;
  }, [closureDays]);

  // Forecast net revenue per day — keyed by dateKey; 0 for closure days
  const { lunchForecastMap, dinnerForecastMap, totalForecastMap } = useMemo(() => {
    const lS = forecastSettings.find(s => s.shift_type === 'lunch');
    const dS = forecastSettings.find(s => s.shift_type === 'dinner');
    const lunchForecastMap:  Record<string, number> = {};
    const dinnerForecastMap: Record<string, number> = {};
    const totalForecastMap:  Record<string, number> = {};
    for (const col of dailyCols) {
      if (col.type !== 'day') continue;
      const dk = col.dateKey;
      const lv = lS && !closureSet.has(`lunch:${dk}`)  ? computeDailyForecast(dk, lS) : 0;
      const dv = dS && !closureSet.has(`dinner:${dk}`) ? computeDailyForecast(dk, dS) : 0;
      if (lS) lunchForecastMap[dk]  = lv;
      if (dS) dinnerForecastMap[dk] = dv;
      if (lS || dS) totalForecastMap[dk] = lv + dv;
    }
    return { lunchForecastMap, dinnerForecastMap, totalForecastMap };
  }, [forecastSettings, closureSet, dailyCols]);

  const topCats = useMemo(() =>
    Object.entries(weeklyResult?.categoryRevenue ?? {}).sort((a,b) => b[1]-a[1]).slice(0, 12),
    [weeklyResult]
  );

  const canImportWeekly  = !!location && weeklyBatch.some(i => i.status === 'pending' && !i.result.error) && !importing;
  const canImportShift   = !!location && shiftBatch.some(i => i.status === 'pending' && !i.result.error) && !importing;
  const canImportMonthly = !!location && !!monthlyResult && !monthlyResult.error && monthlyResult.year > 0 && !importing;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const resetUpload = useCallback(() => {
    setFileName(null); setWeeklyResult(null); setWeeklyBatch([]); setShiftBatch([]);
    setMonthlyResult(null); setParseError(null); setWeeklyPage(0);
  }, []);

  const processFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (reportType === 'shift') {
        const r = parseShiftCSV(content ?? '');
        if (r.error) { setParseError(r.error); return; }
        setParseError(null);
        const { type: detectedType, confidence } = classifyShiftType(r);
        setShiftBatch(prev => [...prev, { fileName: file.name, result: r, detectedType, confidence, status: 'pending' }]);
      } else if (reportType === 'weekly') {
        const r = parseWeeklyCSV(content ?? '');
        setParseError(null);
        setWeeklyBatch(prev => [...prev, { fileName: file.name, result: r, status: 'pending' }]);
      } else {
        setFileName(file.name);
        setMonthlyResult(null); setParseError(null);
        const r = parseMonthlyCSV(content ?? '');
        if (r.error) { setParseError(r.error); return; }
        setMonthlyResult(r);
      }
    };
    reader.readAsText(file, 'UTF-8');
  }, [reportType]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    Array.from(e.dataTransfer.files ?? []).forEach(f => processFile(f));
  }, [processFile]);

  const handleImportWeekly = useCallback(async () => {
    const pending = weeklyBatch.filter(i => i.status === 'pending' && !i.result.error);
    if (!location || !pending.length) return;
    setImporting(true);
    const { data: { user } } = await supabase.auth.getUser();
    for (const item of pending) {
      setWeeklyBatch(prev => prev.map(i => i === item ? { ...i, status: 'saving' } : i));
      try {
        const s = item.result.summary!;
        const { data: imp, error: impErr } = await supabase.from('sales_imports').insert({
          location_id: location.id, file_name: item.fileName,
          week_start: s.weekStart, week_end: s.weekEnd,
          row_count: item.result.rows.length, total_revenue: s.grossTotal,
          net_revenue: s.netTotal, tax_total: s.taxTotal, tips: s.tips,
          gross_food: s.grossFood, gross_drinks: s.grossDrinks,
          inhouse_revenue: s.inhouseTotal, takeaway_revenue: s.takeawayTotal,
          imported_by: user?.id ?? null,
        }).select('id').single();
        if (impErr) throw impErr;
        for (let i = 0; i < item.result.rows.length; i += 200) {
          const chunk = item.result.rows.slice(i, i + 200).map(r => ({
            import_id: imp.id, item_name: r.item_name, category: r.category,
            quantity: r.quantity, unit_price: r.unit_price, total_price: r.total_price,
            inhouse_revenue: r.inhouse_revenue, takeaway_revenue: r.takeaway_revenue,
          }));
          const { error } = await supabase.from('sales_import_lines').insert(chunk);
          if (error) throw error;
        }
        setWeeklyBatch(prev => prev.map(i => i === item ? { ...i, status: 'saved' } : i));
      } catch (e: any) {
        setWeeklyBatch(prev => prev.map(i => i === item ? { ...i, status: 'error', errorMsg: e.message } : i));
      }
    }
    queryClient.invalidateQueries({ queryKey: ['sales-imports'] });
    queryClient.invalidateQueries({ queryKey: ['weekly-sales'] });
    setImporting(false);
  }, [location, weeklyBatch, queryClient]);

  const handleImportShift = useCallback(async () => {
    const pending = shiftBatch.filter(i => i.status === 'pending' && !i.result.error);
    if (!location || !pending.length) return;
    setImporting(true);
    const { data: { user } } = await supabase.auth.getUser();
    let lastDate = '';
    for (const item of pending) {
      setShiftBatch(prev => prev.map(i => i === item ? { ...i, status: 'saving' } : i));
      try {
        const sr = item.result;
        const effectiveType = item.manualOverride ?? item.detectedType;
        const { data: inserted, error: srErr } = await supabase.from('shift_reports').insert({
          location_id: location.id, report_date: sr.date,
          z_report_number: sr.zReportNumber,
          shift_type: effectiveType,
          gross_total: sr.grossTotal, gross_food: sr.grossFood,
          gross_beverages: sr.grossDrinks, net_total: sr.netTotal,
          vat_total: sr.vatTotal, tips: sr.tips,
          inhouse_total: sr.inhouseTotal, takeaway_total: sr.takeawayTotal,
          cancellations_count: sr.cancellationsCount,
          cancellations_total: sr.cancellationsTotal,
          uploaded_by: user?.id ?? null,
        }).select('id').single();
        if (srErr) throw srErr;
        if (sr.categories.length > 0) {
          const { error: catErr } = await supabase.from('shift_report_categories').insert(
            sr.categories.map(c => ({
              shift_report_id: inserted.id, category_name: c.name,
              quantity: c.quantity, total_revenue: c.revenue,
              inhouse_revenue: c.inhouseRevenue, takeaway_revenue: c.takeawayRevenue,
              is_main_category: c.isMain,
            }))
          );
          if (catErr) throw catErr;
        }
        lastDate = sr.date;
        setShiftBatch(prev => prev.map(i => i === item ? { ...i, status: 'saved' } : i));
      } catch (e: any) {
        setShiftBatch(prev => prev.map(i => i === item ? { ...i, status: 'error', errorMsg: e.message } : i));
      }
    }
    queryClient.invalidateQueries({ queryKey: ['shift-reports'] });
    setImporting(false);
    if (lastDate) {
      const d = new Date(lastDate + 'T12:00:00Z');
      setYear(d.getUTCFullYear()); setQuarter(Math.ceil((d.getUTCMonth() + 1) / 3));
    }
    // Only switch tab if all saved (no errors)
    if (shiftBatch.every(i => i.status === 'saved' || i.status === 'error')) {
      setActiveTab('daily');
    }
  }, [location, shiftBatch, queryClient]);

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

  const handleSaveForecast = useCallback(async () => {
    if (!location) return;
    setSavingForecast(true);
    try {
      const { error } = await supabase.from('forecast_settings').upsert([
        draftToPayload(lunchDraft,  'lunch',  location.id),
        draftToPayload(dinnerDraft, 'dinner', location.id),
      ], { onConflict: 'location_id,shift_type' });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['forecast-settings'] });
      setShowForecastPanel(false);
    } catch (e: any) { alert(`Save failed: ${e.message}`); }
    finally { setSavingForecast(false); }
  }, [location, lunchDraft, dinnerDraft, queryClient]);

  const handleAddClosure = useCallback(async () => {
    if (!location || !closureForm.date) return;
    setAddingClosure(true);
    try {
      const { error } = await supabase.from('closure_days').insert({
        location_id:  location.id,
        closure_date: closureForm.date,
        shift_type:   closureForm.shiftType,
        reason:       closureForm.reason || null,
      });
      if (error) throw error;
      await refetchClosures();
      setClosureForm({ date: '', shiftType: 'all', reason: '' });
    } catch (e: any) { alert(`Could not add closure: ${e.message}`); }
    finally { setAddingClosure(false); }
  }, [location, closureForm, refetchClosures]);

  const handleDeleteClosure = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('closure_days').delete().eq('id', id);
      if (error) throw error;
      await refetchClosures();
    } catch (e: any) { alert(`Could not delete closure: ${e.message}`); }
  }, [refetchClosures]);

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
            ['upload', <Upload size={14} />,       'Upload'],
            ['daily',  <CalendarDays size={14} />, 'P&L'],
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

      {/* ── Shared controls ── */}
      {activeTab !== 'upload' && (
        <div className="mb-5 space-y-3">
          {/* Row 1: Location + Year */}
          <div className="flex items-center gap-6 flex-wrap">
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
          </div>
          {/* Row 2: Daily / Weekly / Monthly sub-tabs + Quarter picker */}
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-1.5">
              {(['daily','weekly','monthly'] as const).map(st => (
                <button key={st} onClick={() => setSubTab(st)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold border transition-colors capitalize ${
                    subTab === st ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20] hover:text-[#1B5E20]'
                  }`}
                >{st.charAt(0).toUpperCase() + st.slice(1)}</button>
              ))}
            </div>
            {subTab === 'daily' && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider mr-1">Quarter</span>
                {(['Q1','Q2','Q3','Q4'] as const).map((qLabel, i) => (
                  <button key={qLabel} onClick={() => setQuarter(i+1)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                      quarter === i+1 ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                    }`}
                  >{qLabel}</button>
                ))}
              </div>
            )}
            {subTab === 'daily' && (
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => { setShowClosuresPanel(p => !p); setShowForecastPanel(false); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    showClosuresPanel
                      ? 'bg-red-700 text-white border-red-700'
                      : closureDays.length > 0
                        ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  <Ban size={12} />
                  Closures{closureDays.length > 0 ? ` (${closureDays.length})` : ''}
                </button>
                <button onClick={() => { setShowForecastPanel(p => !p); setShowClosuresPanel(false); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    showForecastPanel
                      ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                      : forecastSettings.length > 0
                        ? 'bg-green-50 text-[#1B5E20] border-green-200 hover:bg-green-100'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  <SlidersHorizontal size={12} />
                  Forecast{forecastSettings.length > 0 ? ' ✓' : ''}
                </button>
              </div>
            )}
          </div>
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
                    (reportType === 'shift' ? shiftBatch.length > 0 : reportType === 'weekly' ? weeklyBatch.length > 0 : !!fileName) && !parseError ? 'border-green-400 bg-green-50' :
                    parseError ? 'border-red-300 bg-red-50' :
                    'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  {(reportType === 'shift' ? shiftBatch.length > 0 : reportType === 'weekly' ? weeklyBatch.length > 0 : !!fileName) && !parseError
                    ? <FileCheck className="mx-auto mb-2 text-green-600" size={32} />
                    : <Upload    className="mx-auto mb-2 text-gray-400"   size={32} />}
                  <p className={`text-sm font-semibold mb-1 ${(reportType === 'shift' ? shiftBatch.length > 0 : reportType === 'weekly' ? weeklyBatch.length > 0 : !!fileName) && !parseError ? 'text-green-700' : 'text-gray-600'}`}>
                    {reportType === 'shift'
                      ? (shiftBatch.length > 0 ? `${shiftBatch.length} file${shiftBatch.length > 1 ? 's' : ''} queued` : 'Drop CSV files here')
                      : reportType === 'weekly'
                      ? (weeklyBatch.length > 0 ? `${weeklyBatch.length} file${weeklyBatch.length > 1 ? 's' : ''} queued` : 'Drop CSV files here')
                      : (fileName ?? 'Drop CSV here')}
                  </p>
                  <p className="text-xs text-gray-400 mb-3">
                    {monthlyResult ? `Z ${monthlyResult.fromZ}–${monthlyResult.toZ} · ${MONTHS[monthlyResult.month-1]} ${monthlyResult.year}` :
                     reportType === 'shift' && shiftBatch.length > 0
                       ? `${shiftBatch.filter(i => i.status === 'pending').length} pending · ${shiftBatch.filter(i => i.status === 'saved').length} saved`
                       : reportType === 'weekly' && weeklyBatch.length > 0
                       ? `${weeklyBatch.filter(i => i.status === 'pending').length} pending · ${weeklyBatch.filter(i => i.status === 'saved').length} saved`
                       : 'or click to browse'}
                  </p>
                  <input ref={fileInputRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
                    multiple={reportType === 'shift' || reportType === 'weekly'}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => { Array.from(e.target.files ?? []).forEach(f => processFile(f)); e.target.value = ''; }}
                  />
                  <span className="px-4 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors inline-block">
                    {reportType === 'shift'
                      ? (shiftBatch.length > 0 ? 'Add more files' : 'Browse files')
                      : reportType === 'weekly'
                      ? (weeklyBatch.length > 0 ? 'Add more files' : 'Browse files')
                      : (fileName ? 'Replace file' : 'Browse files')}
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
                     ? (() => {
                         const pending = weeklyBatch.filter(i => i.status === 'pending' && !i.result.error);
                         if (!canImportWeekly) return weeklyBatch.length > 0 ? 'No pending reports to save' : 'Drop CSV files above';
                         return `Save ${pending.length} weekly report${pending.length > 1 ? 's' : ''}`;
                       })()
                     : reportType === 'monthly'
                     ? (canImportMonthly ? `Save monthly report · ${MONTHS[monthlyResult!.month-1]} ${monthlyResult!.year} · ${fmt(monthlyResult!.grossTotal)}` : 'Drop a CSV file above')
                     : (() => {
                         const pending = shiftBatch.filter(i => i.status === 'pending' && !i.result.error);
                         if (!canImportShift) return shiftBatch.length > 0 ? 'No pending reports to save' : 'Drop a CSV file above';
                         const nLunch  = pending.filter(i => (i.manualOverride ?? i.detectedType) === 'lunch').length;
                         const nDinner = pending.filter(i => (i.manualOverride ?? i.detectedType) === 'dinner').length;
                         const parts   = [];
                         if (nLunch)  parts.push(`${nLunch} × ☀️ Lunch`);
                         if (nDinner) parts.push(`${nDinner} × 🌙 Dinner`);
                         return `Save ${parts.join(' · ')}`;
                       })()}
                </button>
              </div>

              {/* ── Weekly batch list ── */}
              {reportType === 'weekly' && weeklyBatch.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Queued weeks</p>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {weeklyBatch.map((item, idx) => {
                      const s = item.result.summary;
                      const statusIcon  = item.status === 'saved' ? '✓' : item.status === 'error' ? '✗' : item.status === 'saving' ? '…' : '○';
                      const statusColor = item.status === 'saved' ? 'text-green-600' : item.status === 'error' ? 'text-red-500' : item.status === 'saving' ? 'text-blue-500' : 'text-gray-400';
                      return (
                        <div key={idx} className="bg-white border border-gray-100 rounded-lg px-3 py-2 flex items-center gap-2 shadow-sm">
                          <span className={`text-sm font-bold flex-shrink-0 w-4 text-center ${statusColor}`}>{statusIcon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-800 truncate">
                              {s ? `${fmtDate(s.weekStart)} – ${fmtDate(s.weekEnd)}` : item.fileName}
                            </p>
                            <p className="text-xs text-gray-400">
                              {s ? `Gross ${fmt(s.grossTotal)} · Net ${fmt(s.netTotal)}` : item.result.error ?? ''}
                            </p>
                            {item.status === 'error' && item.errorMsg && (
                              <p className="text-xs text-red-500 truncate">{item.errorMsg}</p>
                            )}
                          </div>
                          {item.status === 'pending' && (
                            <button
                              onClick={() => setWeeklyBatch(prev => prev.filter((_, i) => i !== idx))}
                              className="flex-shrink-0 text-gray-300 hover:text-red-400 text-xs font-bold transition-colors"
                              title="Remove">✕</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Shift batch list ── */}
              {reportType === 'shift' && shiftBatch.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Queued shifts
                  </p>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {shiftBatch.map((item, idx) => {
                      const effectiveType = item.manualOverride ?? item.detectedType;
                      const isLunch = effectiveType === 'lunch';
                      const isOverridden = !!item.manualOverride;
                      const confDots =
                        item.confidence === 'high'   ? '●●●' :
                        item.confidence === 'medium' ? '●●○' : '●○○';
                      const statusIcon =
                        item.status === 'saved'  ? '✓' :
                        item.status === 'error'  ? '✗' :
                        item.status === 'saving' ? '…' : '○';
                      const statusColor =
                        item.status === 'saved'  ? 'text-green-600' :
                        item.status === 'error'  ? 'text-red-500'   :
                        item.status === 'saving' ? 'text-blue-500'  : 'text-gray-400';
                      return (
                        <div key={idx} className="bg-white border border-gray-100 rounded-lg px-3 py-2 flex items-center gap-2 shadow-sm">
                          <span className={`text-sm font-bold flex-shrink-0 w-4 text-center ${statusColor}`}>{statusIcon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-800 truncate">{fmtDate(item.result.date)}</p>
                            <p className="text-xs text-gray-400">
                              Z-{item.result.zReportNumber || '?'} · {fmt(item.result.grossTotal)}
                            </p>
                            {item.status === 'error' && item.errorMsg && (
                              <p className="text-xs text-red-500 truncate">{item.errorMsg}</p>
                            )}
                          </div>
                          {/* Shift type badge — click to toggle */}
                          {item.status === 'pending' && (
                            <button
                              title={`${isOverridden ? 'Manually set' : 'Auto-detected'} · ${item.confidence} confidence (${confDots})\nClick to flip`}
                              onClick={() => setShiftBatch(prev => prev.map((it, i) =>
                                i !== idx ? it : { ...it, manualOverride: effectiveType === 'lunch' ? 'dinner' : 'lunch' }
                              ))}
                              className={`flex-shrink-0 flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold border transition-colors ${
                                isLunch
                                  ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                                  : 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100'
                              } ${isOverridden ? 'ring-1 ring-offset-1 ring-gray-400' : ''}`}
                            >
                              {isLunch ? '☀️' : '🌙'}
                              <span className="ml-0.5">{isLunch ? 'L' : 'D'}</span>
                              <span className={`ml-1 text-[8px] tracking-tighter ${isLunch ? 'text-amber-400' : 'text-blue-300'}`}>{confDots}</span>
                            </button>
                          )}
                          {item.status === 'saved' && (
                            <span className={`flex-shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                              isLunch ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-700'
                            }`}>{isLunch ? '☀️' : '🌙'}</span>
                          )}
                          {item.status === 'pending' && (
                            <button
                              onClick={() => setShiftBatch(prev => prev.filter((_, i) => i !== idx))}
                              className="flex-shrink-0 text-gray-300 hover:text-red-400 text-xs font-bold transition-colors ml-0.5"
                              title="Remove"
                            >✕</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
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

              {/* Shift: batch summary table */}
              {reportType === 'shift' && shiftBatch.length > 0 && (
                <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                      {shiftBatch.length} file{shiftBatch.length > 1 ? 's' : ''} queued
                    </p>
                    <p className="text-xs text-gray-400">
                      {shiftBatch.filter(i => (i.manualOverride ?? i.detectedType) === 'lunch').length} × ☀️&nbsp;
                      {shiftBatch.filter(i => (i.manualOverride ?? i.detectedType) === 'dinner').length} × 🌙
                    </p>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {['Shift','Date','Z-Report','Gross','Net','VAT','Tips','Conf.','Status'].map(h => (
                          <th key={h} className={`px-3 py-2 font-semibold text-gray-400 uppercase tracking-wide ${h === 'Date' || h === 'Z-Report' ? 'text-left' : h === 'Status' || h === 'Shift' || h === 'Conf.' ? 'text-center' : 'text-right'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {shiftBatch.map((item, idx) => {
                        const effectiveType = item.manualOverride ?? item.detectedType;
                        const isLunch = effectiveType === 'lunch';
                        const isOverridden = !!item.manualOverride;
                        const confDots =
                          item.confidence === 'high'   ? '●●●' :
                          item.confidence === 'medium' ? '●●○' : '●○○';
                        const statusIcon =
                          item.status === 'saved'  ? '✓' :
                          item.status === 'error'  ? '✗' :
                          item.status === 'saving' ? '…' : '○';
                        const statusColor =
                          item.status === 'saved'  ? 'text-green-600 font-bold' :
                          item.status === 'error'  ? 'text-red-500 font-bold'   :
                          item.status === 'saving' ? 'text-blue-500'            : 'text-gray-400';
                        return (
                          <tr key={idx} className="hover:bg-gray-50/60">
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${
                                isLunch ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-800'
                              } ${isOverridden ? 'ring-1 ring-gray-400' : ''}`}>
                                {isLunch ? '☀️' : '🌙'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-800 font-medium">{fmtDate(item.result.date)}</td>
                            <td className="px-3 py-2 text-gray-500">{item.result.zReportNumber || '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-[#1B5E20] font-semibold">{fmtNum(item.result.grossTotal)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-blue-700">{fmtNum(item.result.netTotal)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmtNum(item.result.vatTotal)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-purple-700">{fmtNum(item.result.tips)}</td>
                            <td className={`px-3 py-2 text-center text-[10px] tracking-tighter ${
                              item.confidence === 'high' ? 'text-green-500' : item.confidence === 'medium' ? 'text-amber-500' : 'text-red-400'
                            }`} title={`${item.confidence} confidence${isOverridden ? ' · manually overridden' : ''}`}>{confDots}</td>
                            <td className={`px-3 py-2 text-center ${statusColor}`} title={item.errorMsg}>{statusIcon}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {shiftBatch.length > 1 && (
                      <tfoot>
                        <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                          <td className="px-3 py-2 text-gray-600" colSpan={2}>Total ({shiftBatch.length} shifts)</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#1B5E20]">{fmtNum(shiftBatch.reduce((s,i) => s + i.result.grossTotal, 0))}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-blue-700">{fmtNum(shiftBatch.reduce((s,i) => s + i.result.netTotal, 0))}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmtNum(shiftBatch.reduce((s,i) => s + i.result.vatTotal, 0))}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-purple-700">{fmtNum(shiftBatch.reduce((s,i) => s + i.result.tips, 0))}</td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
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
              {!weeklyResult && shiftBatch.length === 0 && !monthlyResult && !parseError && (
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
        <>
        {subTab === 'daily' && (
        <>
          {/* ── Closures panel ── */}
          {showClosuresPanel && (
            <div className="mb-4 border border-red-200 rounded-xl bg-white shadow-sm overflow-hidden">
              <div className="bg-red-50 border-b border-red-200 px-4 py-3 flex items-center justify-between">
                <span className="text-xs font-bold text-red-700 uppercase tracking-wider flex items-center gap-2">
                  <Ban size={13} /> Closure Days{location ? ` — ${location.name}` : ''}
                </span>
                <button onClick={() => setShowClosuresPanel(false)} className="text-red-400 hover:text-red-600 text-sm font-bold">✕</button>
              </div>
              <div className="divide-y divide-red-50">
                {/* Add form */}
                <div className="px-5 py-4 bg-white">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Add closure</p>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Date</label>
                      <input type="date" value={closureForm.date}
                        onChange={e => setClosureForm(f => ({ ...f, date: e.target.value }))}
                        className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-red-400" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Shift</label>
                      <select value={closureForm.shiftType}
                        onChange={e => setClosureForm(f => ({ ...f, shiftType: e.target.value as 'lunch'|'dinner'|'all' }))}
                        className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-red-400 bg-white">
                        <option value="all">All day</option>
                        <option value="lunch">☀️ Lunch only</option>
                        <option value="dinner">🌙 Dinner only</option>
                      </select>
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <label className="block text-xs text-gray-400 mb-1">Reason (optional)</label>
                      <input type="text" placeholder="e.g. Public holiday" value={closureForm.reason}
                        onChange={e => setClosureForm(f => ({ ...f, reason: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-red-400" />
                    </div>
                    <button onClick={handleAddClosure} disabled={addingClosure || !location || !closureForm.date}
                      className="flex items-center gap-2 px-4 py-1.5 bg-red-700 text-white text-sm font-bold rounded-lg hover:bg-red-800 transition-colors disabled:opacity-50">
                      {addingClosure ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                      Add
                    </button>
                  </div>
                </div>
                {/* Existing closures list */}
                <div className="px-5 py-3">
                  {closureDays.length === 0 ? (
                    <p className="text-xs text-gray-400 italic py-2">No closure days set for this location.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {closureDays.map(c => (
                        <div key={c.id} className="flex items-center justify-between gap-3 py-1.5 px-3 rounded-lg bg-red-50 hover:bg-red-100 transition-colors">
                          <span className="text-sm font-semibold text-red-900 tabular-nums">
                            {new Date(c.closure_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' })}
                          </span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            c.shift_type === 'all'    ? 'bg-red-200 text-red-800' :
                            c.shift_type === 'lunch'  ? 'bg-amber-100 text-amber-800' :
                                                        'bg-blue-100 text-blue-800'
                          }`}>
                            {c.shift_type === 'all' ? '🚫 All day' : c.shift_type === 'lunch' ? '☀️ Lunch' : '🌙 Dinner'}
                          </span>
                          {c.reason && <span className="text-xs text-red-600 flex-1 truncate">{c.reason}</span>}
                          <button onClick={() => handleDeleteClosure(c.id)}
                            className="text-red-400 hover:text-red-700 font-bold text-sm leading-none flex-shrink-0 transition-colors"
                            title="Remove closure">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Forecast settings panel ── */}
          {showForecastPanel && (
            <div className="mb-4 border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
              <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-600 uppercase tracking-wider flex items-center gap-2">
                  <SlidersHorizontal size={13} /> Forecast Settings{location ? ` — ${location.name}` : ''}
                </span>
                <button onClick={() => setShowForecastPanel(false)} className="text-gray-400 hover:text-gray-600 text-sm font-bold">✕</button>
              </div>
              <div className="grid grid-cols-2 divide-x divide-gray-100">
                {([
                  { label:'☀️  Lunch',  draft: lunchDraft,  setDraft: setLunchDraft  },
                  { label:'🌙  Dinner', draft: dinnerDraft, setDraft: setDinnerDraft },
                ] as const).map(({ label, draft, setDraft }) => {
                  const mon = parseFloat(draft.mon)||0, tue = parseFloat(draft.tue)||0,
                        wed = parseFloat(draft.wed)||0, thu = parseFloat(draft.thu)||0,
                        fri = parseFloat(draft.fri)||0, sat = parseFloat(draft.sat)||0;
                  const sun = Math.max(0, 100 - mon - tue - wed - thu - fri - sat);
                  const total = mon+tue+wed+thu+fri+sat+sun;
                  return (
                    <div key={label} className="p-5 space-y-4">
                      <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">{label}</p>
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-3">
                          <label className="text-xs text-gray-500 w-40">Weekly base net (€)</label>
                          <input type="number" min="0" value={draft.weekBaseNet}
                            onChange={e => setDraft(d => ({...d, weekBaseNet: e.target.value}))}
                            className="w-28 text-right text-sm font-semibold border border-gray-200 rounded-lg px-2 py-1.5 tabular-nums focus:outline-none focus:border-[#1B5E20]" />
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="text-xs text-gray-500 w-40">Growth / week (%)</label>
                          <input type="number" step="0.1" value={draft.growthRate}
                            onChange={e => setDraft(d => ({...d, growthRate: e.target.value}))}
                            className="w-28 text-right text-sm border border-gray-200 rounded-lg px-2 py-1.5 tabular-nums focus:outline-none focus:border-[#1B5E20]" />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Day-of-week split (%)</p>
                        <div className="grid grid-cols-7 gap-1 text-center">
                          {(['mon','tue','wed','thu','fri','sat'] as const).map(day => (
                            <div key={day}>
                              <p className="text-xs text-gray-400 mb-1">{day.charAt(0).toUpperCase()+day.slice(1)}</p>
                              <input type="number" step="0.1" min="0" max="100"
                                value={draft[day]}
                                onChange={e => setDraft(d => ({...d, [day]: e.target.value}))}
                                className="w-full text-center text-xs border border-gray-200 rounded px-0.5 py-1 tabular-nums focus:outline-none focus:border-[#1B5E20]" />
                            </div>
                          ))}
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Sun</p>
                            <div className="w-full text-center text-xs bg-gray-50 border border-gray-100 rounded px-0.5 py-1 text-gray-400 tabular-nums">
                              {sun.toFixed(1)}
                            </div>
                          </div>
                        </div>
                        <p className={`text-xs mt-1.5 text-right ${Math.abs(total - 100) < 0.2 ? 'text-green-600' : 'text-amber-600'}`}>
                          Total: {total.toFixed(1)}% {Math.abs(total - 100) < 0.2 ? '✓' : '⚠ Sun adjusted to balance'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between bg-gray-50">
                <p className="text-xs text-gray-400">Sun weight auto-computed · weights normalise to 100% on save</p>
                <button onClick={handleSaveForecast} disabled={savingForecast || !location}
                  className="flex items-center gap-2 px-5 py-2 bg-[#1B5E20] text-white text-sm font-bold rounded-lg hover:bg-[#2E7D32] transition-colors disabled:opacity-50">
                  {savingForecast ? <Loader2 size={14} className="animate-spin" /> : <DatabaseZap size={14} />}
                  {savingForecast ? 'Saving…' : 'Save forecast settings'}
                </button>
              </div>
            </div>
          )}

          {/* ── Daily P&L table ── */}
          {!location ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2 border border-dashed border-gray-200 rounded-xl">
            <MapPin size={36} className="text-gray-200" />
            <p className="text-sm">Select a location to view the daily P&amp;L</p>
          </div>
        ) : (() => {
          const totalCols = dailyCols.length + 2; // label + day/week cols + month total

          // Helper: render one P&L block (lunch / dinner / total) as a <tbody>
          const renderBlock = (
            map:      Record<string, DayAgg>,
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
                        const todayKey = `${todayYear}-${String(todayMonth).padStart(2,'0')}-${String(todayDay).padStart(2,'0')}`;
                        const isCurDay = col.dateKey === todayKey;
                        return (
                          <td key={ci} className={`py-2 text-right tabular-nums ${isBold ? 'font-bold' : ''}`}
                            style={{ paddingLeft:4, paddingRight:8, backgroundColor: isCurDay ? 'rgba(59,130,246,0.04)' : undefined }}>
                            {renderDayCell(row, map[col.dateKey] ?? null)}
                          </td>
                        );
                      } else {
                        const present = col.wDateKeys.filter(k => map[k]);
                        const wAgg = present.length > 0
                          ? present.reduce<DayAgg>((acc, k) => addAgg(acc, map[k]), { ...EMPTY_AGG })
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
                        METRIC / DAY · Q{quarter} {year}
                      </th>
                      {dailyCols.map((col, ci) => {
                        if (col.type === 'day') {
                          const todayKey   = `${todayYear}-${String(todayMonth).padStart(2,'0')}-${String(todayDay).padStart(2,'0')}`;
                          const hasData    = !!totalMap[col.dateKey];
                          const isCurDay   = col.dateKey === todayKey;
                          const isSun      = col.dow === 'Sun';
                          const isClosed   = closureSet.has(`lunch:${col.dateKey}`) && closureSet.has(`dinner:${col.dateKey}`);
                          return (
                            <th key={ci} className="py-2 text-right font-bold whitespace-nowrap tabular-nums"
                              style={{ minWidth:COL_W_D, width:COL_W_D, paddingLeft:4, paddingRight:8,
                                color: isClosed ? '#f87171' : isCurDay ? '#ffffff' : hasData ? '#93c5fd' : '#4b5563',
                                backgroundColor: isClosed ? 'rgba(239,68,68,0.12)' : undefined,
                                borderBottom: isCurDay ? '2px solid #3b82f6' : isSun ? '2px solid #7c3aed' : isClosed ? '2px solid #ef4444' : 'none',
                                borderLeft: col.day === 1 && col.month !== QUARTER_MONTHS[quarter-1][0] ? '2px solid #4b5563' : undefined,
                                borderRight: isSun ? '1px solid #374151' : undefined }}>
                              <div style={{ fontSize:9, fontWeight:400, opacity:0.55, marginBottom:1 }}>
                                {isClosed ? '🚫' : col.day === 1 ? MONTHS[col.month-1] : col.dow}
                              </div>
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
                        <div>Q{quarter}</div>
                      </th>
                    </tr>
                  </thead>

                  {/* ── Summary P&L ── */}
                  <tbody>
                    <tr>
                      <td colSpan={totalCols}
                        className="sticky left-0 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white"
                        style={{ backgroundColor: '#0f172a' }}>
                        Summary
                      </td>
                    </tr>
                    {[
                      { label:'☀️  Lunch · Net Revenue',  map: lunchMap,  qTotal: lunchQtrTotal,  fcastMap: lunchForecastMap,  field:'netTotal' as const, bold:false },
                      { label:'🌙  Dinner · Net Revenue', map: dinnerMap, qTotal: dinnerQtrTotal, fcastMap: dinnerForecastMap, field:'netTotal' as const, bold:false },
                      { label:'∑   Total · Net Revenue',  map: totalMap,  qTotal: totalQtrTotal,  fcastMap: totalForecastMap,  field:'netTotal' as const, bold:true  },
                    ].map((row, i) => {
                      const todayKey   = `${todayYear}-${String(todayMonth).padStart(2,'0')}-${String(todayDay).padStart(2,'0')}`;
                      const hasFcast   = Object.keys(row.fcastMap).length > 0;
                      const bg = row.bold ? '#f0fdf4' : '#ffffff';
                      // Quarter total: actuals to date + forecast for remaining days
                      const qActualSum = row.qTotal?.[row.field] ?? 0;
                      const qFcastRem  = hasFcast
                        ? dailyCols.filter((c): c is DayCol => c.type === 'day' && c.dateKey > todayKey && !row.map[c.dateKey])
                            .reduce((s, c) => s + (row.fcastMap[c.dateKey] ?? 0), 0)
                        : 0;
                      const qDisplayVal = qActualSum + qFcastRem;
                      const qHasMix     = qActualSum > 0 && qFcastRem > 0;
                      return (
                        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50/60 group" style={{ backgroundColor: bg }}>
                          <td className={`sticky left-0 z-10 px-4 py-2 whitespace-nowrap border-r border-gray-100 group-hover:bg-gray-50/60 transition-colors ${row.bold ? 'font-bold text-gray-900' : 'text-gray-700'}`}
                            style={{ backgroundColor: bg }}>
                            {row.label}
                          </td>
                          {dailyCols.map((col, ci) => {
                            if (col.type === 'day') {
                              const isCurDay  = col.dateKey === todayKey;
                              const isFuture  = col.dateKey > todayKey;
                              const actual    = (row.map[col.dateKey]?.[row.field] ?? 0);
                              const fcast     = row.fcastMap[col.dateKey] ?? null;
                              const hasActual = actual > 0;
                              const showFcast = !hasActual && isFuture && fcast !== null && fcast > 0;
                              return (
                                <td key={ci} className={`py-2 text-right tabular-nums ${row.bold ? 'font-bold' : ''}`}
                                  style={{ paddingLeft:4, paddingRight:8, backgroundColor: isCurDay ? 'rgba(59,130,246,0.04)' : undefined }}>
                                  {hasActual
                                    ? <span className={row.bold ? 'text-[#1B5E20]' : 'text-blue-700'}>{fmtNum(actual)}</span>
                                    : showFcast
                                      ? <span className="text-amber-500 italic text-[10px]">{fmtNum(fcast!)}</span>
                                      : <span className="text-gray-300">—</span>}
                                </td>
                              );
                            } else {
                              const present = col.wDateKeys.filter(k => (row.map[k]?.[row.field] ?? 0) > 0);
                              const wActual = present.length > 0
                                ? present.reduce((s, k) => s + (row.map[k][row.field] ?? 0), 0) : 0;
                              const wFcast  = hasFcast
                                ? col.wDateKeys.filter(k => !row.map[k] && k > todayKey)
                                    .reduce((s, k) => s + (row.fcastMap[k] ?? 0), 0) : 0;
                              const wTotal  = wActual + wFcast;
                              const wMix    = wActual > 0 && wFcast > 0;
                              return (
                                <td key={ci} className={`py-2 text-right tabular-nums ${row.bold ? 'font-bold' : ''}`}
                                  style={{ paddingLeft:4, paddingRight:6, backgroundColor:'#fffbeb', borderLeft:'1px solid #fde68a', borderRight:'1px solid #fde68a' }}>
                                  {wTotal > 0
                                    ? <span className={wMix ? 'text-amber-600' : row.bold ? 'text-gray-900' : 'text-blue-700'}>{fmtNum(wTotal)}</span>
                                    : <span className="text-gray-300">—</span>}
                                </td>
                              );
                            }
                          })}
                          <td className={`py-2 text-right tabular-nums border-l border-gray-200 ${row.bold ? 'font-bold' : ''}`}
                            style={{ paddingLeft:4, paddingRight:8 }}>
                            {qDisplayVal > 0
                              ? <span className={qHasMix ? 'text-amber-600' : row.bold ? 'text-[#1B5E20]' : 'text-blue-700'}>{fmtNum(qDisplayVal)}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>

                  <tbody><tr><td colSpan={totalCols} style={{ height: 12, backgroundColor:'#f9fafb' }} /></tr></tbody>

                  {renderBlock(lunchMap,  lunchQtrTotal,  '☀️  Lunch Shift',  '#92400E')}
                  {renderBlock(dinnerMap, dinnerQtrTotal, '🌙  Dinner Shift', '#1E3A5F')}
                  {renderBlock(totalMap,  totalQtrTotal,  '∑   Daily Total',  '#111827')}
                </table>
              </div>
              <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {shiftRows.length} shift report{shiftRows.length !== 1 ? 's' : ''} ·{' '}
                  {Object.keys(totalMap).length} day{Object.keys(totalMap).length !== 1 ? 's' : ''} with data
                </span>
                {totalQtrTotal && (
                  <span className="text-xs text-gray-400">
                    Q{quarter} gross: <span className="font-bold text-[#1B5E20]">{fmt(totalQtrTotal.grossTotal)}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })()}
        </>
        )}

        {/* ── Weekly P&L ───────────────────────────────────────────────── */}
        {subTab === 'weekly' && (!location ? (
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
                        const hasWeek = !!weekMap[kw];
                        const isCurWk = kw === cwk;
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
                  {/* ── Weekly summary (lunch / dinner / total net revenue) ── */}
                  <tbody>
                    <tr>
                      <td colSpan={TOTAL_WEEKS + 2}
                        className="sticky left-0 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white"
                        style={{ backgroundColor: '#0f172a' }}>
                        Summary
                      </td>
                    </tr>
                    {([
                      { label: '☀️  Lunch · Net Revenue',  wMap: lunchWeekMap,  fy: lunchFYNet,  bold: false },
                      { label: '🌙  Dinner · Net Revenue', wMap: dinnerWeekMap, fy: dinnerFYNet, bold: false },
                      { label: '∑   Total · Net Revenue',  wMap: totalWeekMap,  fy: totalFYNet,  bold: true  },
                    ]).map((row, i) => {
                      const bg = row.bold ? '#f0fdf4' : '#ffffff';
                      return (
                        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50/60 group" style={{ backgroundColor: bg }}>
                          <td className={`sticky left-0 z-10 px-4 py-2 whitespace-nowrap border-r border-gray-100 group-hover:bg-gray-50/60 transition-colors ${row.bold ? 'font-bold text-gray-900' : 'text-gray-700'}`}
                            style={{ backgroundColor: bg }}>
                            {row.label}
                          </td>
                          {Array.from({ length: TOTAL_WEEKS }, (_, j) => j + 1).map(kw => {
                            const isCurWk = kw === cwk;
                            const val = row.wMap[kw] ?? null;
                            return (
                              <td key={kw} className={`py-2 text-right tabular-nums ${row.bold ? 'font-bold' : ''}`}
                                style={{ paddingLeft:4, paddingRight:10, backgroundColor: isCurWk ? 'rgba(59,130,246,0.04)' : undefined }}>
                                {val !== null && val > 0
                                  ? <span className={row.bold ? 'text-[#1B5E20]' : 'text-blue-700'}>{fmtNum(val)}</span>
                                  : <span className="text-gray-300">—</span>}
                              </td>
                            );
                          })}
                          <td className={`py-2 text-right tabular-nums border-l border-gray-200 ${row.bold ? 'font-bold' : ''}`}
                            style={{ paddingLeft:4, paddingRight:10 }}>
                            {row.fy > 0
                              ? <span className={row.bold ? 'text-[#1B5E20]' : 'text-blue-700'}>{fmtNum(row.fy)}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>

                  {/* Spacer */}
                  <tbody><tr><td colSpan={TOTAL_WEEKS + 2} style={{ height: 12, backgroundColor:'#f9fafb' }} /></tr></tbody>

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
        ))}

        {/* ── Monthly P&L ──────────────────────────────────────────────── */}
        {subTab === 'monthly' && (!location ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2 border border-dashed border-gray-200 rounded-xl">
            <MapPin size={36} className="text-gray-200" />
            <p className="text-sm">Select a location to view the monthly P&amp;L</p>
          </div>
        ) : monthlyReports.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2 border border-dashed border-gray-200 rounded-xl">
                <TableProperties size={28} className="text-gray-200" />
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
                          const hasData  = !!monthMap[i+1];
                          const isCurMon = year === todayYear && i+1 === todayMonth;
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
        ))}
        </>
      )}
    </div>
  );
}
