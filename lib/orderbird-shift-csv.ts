/**
 * Reading an Orderbird Z-report CSV ("Z Report: 603", sections separated by
 * blank lines). Shared by the manual upload on the Sales Reports page and the
 * nightly MY orderbird import.
 *
 * No imports: this is used by client pages as well as server code.
 */

export type ShiftCat = {
  name:            string;
  isMain:          boolean;
  quantity:        number;
  revenue:         number;
  inhouseRevenue:  number;
  takeawayRevenue: number;
};

export type ShiftProduct = {
  name:        string;
  quantity:    number;
  gross_sales: number;
};

export type ShiftParseResult = {
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
  products:           ShiftProduct[];
  error?:             string;
};

export function parseNum(s: string): number {
  if (!s) return 0;
  const c = s.trim().replace(/[€$\s%]/g, '');
  if (!c) return 0;
  if (c.includes(',') && c.includes('.')) return parseFloat(c.replace(/\./g, '').replace(',', '.')) || 0;
  if (c.includes(',')) return parseFloat(c.replace(',', '.')) || 0;
  return parseFloat(c) || 0;
}

export function parseDate(s: string): string | null {
  if (!s) return null;
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (de) return `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return null;
}

export const SECTION_NAMES = new Set([
  'turnover','gross turnover','net turnover','taxes',
  'types of payment','taxes by payment method','revenue breakdown',
  'cancellations','discounts','tables','guests',
  'main categories','categories','products',
]);

export function parseShiftCSV(raw: string): ShiftParseResult {
  const empty: ShiftParseResult = { date:'', zReportNumber:'', grossTotal:0, grossFood:0, grossDrinks:0, netTotal:0, vatTotal:0, tips:0, inhouseTotal:0, takeawayTotal:0, cancellationsCount:0, cancellationsTotal:0, categories:[], products:[] };

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
  const products: ShiftProduct[] = [];

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
      case 'products': {
        if (!cols[0] || first === 'total') break;
        const qty = parseNum(cols[2]);
        const rev = parseNum(cols[3]);
        if (cols[0] && (qty > 0 || rev > 0)) products.push({ name:cols[0], quantity:qty, gross_sales:rev });
        break;
      }
    }
  }

  if (grossTotal === 0 && date === '')
    return { ...empty, error:'Could not parse this file as an Orderbird shift report.' };

  return { date, zReportNumber, grossTotal, grossFood, grossDrinks, netTotal, vatTotal, tips, inhouseTotal, takeawayTotal, cancellationsCount, cancellationsTotal, categories, products };
}
