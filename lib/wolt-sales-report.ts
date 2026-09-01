/**
 * Parser and shift allocator for the Wolt "Umsatzbericht" — the order-level
 * sales report that comes as file 4 of every Wolt document set.
 *
 * The self-billing invoice only reports the five-day period as a whole. This
 * report carries a timestamp per order, which is what lets the period be cut
 * into days and shifts.
 *
 * Two facts about Wolt's numbers drive the design here, both verified against
 * a real document set:
 *
 *  - Commission is charged on the GROSS order value, at a rate set by whether
 *    the order was a Wolt+ order. Non-Wolt+ gross matched the invoice's 24%
 *    base exactly, and Wolt+ gross its 27% bases. So commission is attributed
 *    per order rather than smeared across the period.
 *
 *  - Order net sums to slightly more than the invoice's subtotal (A): the
 *    difference is the period's refunds (Summe Vergütungen), which Wolt reports
 *    only at period level. Those are spread pro-rata and kept on their own line
 *    so a shift figure is never quietly adjusted.
 */

import type { WoltInvoiceData } from './wolt-invoice';

/** Lunch runs until 14:30; dinner starts at 17:30. */
export const LUNCH_END_MINUTES   = 14 * 60 + 30;
export const DINNER_START_MINUTES = 17 * 60 + 30;

export type WoltShift = 'lunch' | 'dinner';

export interface WoltOrder {
  /** ISO date. */
  date:       string;
  /** Minutes since midnight, for the shift cut. */
  minutes:    number;
  /** Wolt's order number. */
  orderNo:    string;
  /** Was this a Wolt+ order? Sets the commission rate. */
  woltPlus:   boolean;
  /** Order value including VAT — what commission is charged on. */
  gross:      number;
  /** Order value excluding VAT — what we book as sales. */
  net:        number;
  shift:      WoltShift;
  /** True when the order fell between the two shifts and had to be assigned. */
  offShift:   boolean;
}

export interface WoltShiftRow {
  date:       string;
  shift:      WoltShift;
  orders:     number;
  gross:      number;
  /** Order net, before the refund share. */
  netSales:   number;
  /** This shift's pro-rata share of the period's refunds. Negative. */
  refundEst:  number;
  /** Commission attributed to this shift. Positive. */
  commission: number;
  /** netSales + refundEst − commission. */
  netPreAds:  number;
}

export interface WoltShiftBreakdown {
  rows: WoltShiftRow[];
  /** Orders that fell between the shifts and were assigned to the nearer one. */
  offShiftOrders: number;
  /** Total refunds spread across the shifts. Negative. */
  refundTotal: number;
  /**
   * Difference between commission from the per-order rates and the invoice's
   * subtotal (B), spread pro-rata so the rows always tie to the invoice.
   * A few cents in normal use — Wolt zero-rates the odd order.
   */
  commissionResidual: number;
}

export class WoltSalesParseError extends Error {}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

/** Commission rates, confirmed against the invoice's own bases. */
const RATE_WOLT_PLUS = 0.27;
const RATE_STANDARD  = 0.24;

/**
 * Wolt separates the parts of a timestamp with NUL bytes rather than colons,
 * so whitespace classes have to allow for them.
 */
const SEP = '[\\s\\u0000]+';

const ORDER_RE = new RegExp(
  `(\\d{2}\\.\\d{2}\\.\\d{4})${SEP}` +      // date
  `(\\d{1,2})${SEP}(\\d{2})${SEP}(\\d{2})${SEP}` + // hh mm ss
  `(\\d+)${SEP}` +                          // running index
  `(Ja|Nein)${SEP}` +                       // Wolt+
  `(\\d+)${SEP}` +                          // order number
  `([\\d.]+,\\d{2})${SEP}` +                // gross
  `([\\d.]+,\\d{2})`,                       // net
  'g',
);

/** Assigns an order to a shift; orders between the two go to the nearer one. */
function classify(minutes: number): { shift: WoltShift; offShift: boolean } {
  if (minutes <= LUNCH_END_MINUTES)    return { shift: 'lunch',  offShift: false };
  if (minutes >= DINNER_START_MINUTES) return { shift: 'dinner', offShift: false };
  const midpoint = (LUNCH_END_MINUTES + DINNER_START_MINUTES) / 2;
  return { shift: minutes < midpoint ? 'lunch' : 'dinner', offShift: true };
}

/** Parses every order line out of the sales report. */
export function parseWoltSalesReport(text: string): WoltOrder[] {
  if (!/Umsatzbericht/i.test(text)) {
    throw new WoltSalesParseError('This is not the Wolt sales report (Umsatzbericht).');
  }

  const orders: WoltOrder[] = [];
  let m: RegExpExecArray | null;
  ORDER_RE.lastIndex = 0;
  while ((m = ORDER_RE.exec(text)) !== null) {
    const [, dmy, hh, mm, , , woltPlus, orderNo, gross, net] = m;
    const [d, mo, y] = dmy.split('.');
    const minutes = Number(hh) * 60 + Number(mm);
    orders.push({
      date:     `${y}-${mo}-${d}`,
      minutes,
      orderNo,
      woltPlus: woltPlus === 'Ja',
      gross:    num(gross),
      net:      num(net),
      ...classify(minutes),
    });
  }

  if (orders.length === 0) {
    throw new WoltSalesParseError('No orders could be read from the Wolt sales report.');
  }
  return orders;
}

/**
 * Turns orders into one row per day and shift, reconciled to the invoice.
 *
 * Commission comes from the per-order rates and is then nudged pro-rata so the
 * rows sum to the invoice's subtotal (B) exactly; refunds are the gap between
 * order net and subtotal (A), spread the same way. Both adjustments are
 * reported so nothing is silently absorbed.
 */
export function aggregateWoltShifts(
  orders:  WoltOrder[],
  invoice: WoltInvoiceData,
): WoltShiftBreakdown {
  // Raw per-order commission, before reconciling to the invoice.
  const rawCommission = (o: WoltOrder) => o.gross * (o.woltPlus ? RATE_WOLT_PLUS : RATE_STANDARD);

  const buckets = new Map<string, WoltShiftRow & { rawCommission: number }>();
  for (const o of orders) {
    const key = `${o.date}|${o.shift}`;
    const row = buckets.get(key) ?? {
      date: o.date, shift: o.shift, orders: 0,
      gross: 0, netSales: 0, refundEst: 0, commission: 0, netPreAds: 0,
      rawCommission: 0,
    };
    row.orders        += 1;
    row.gross         += o.gross;
    row.netSales      += o.net;
    row.rawCommission += rawCommission(o);
    buckets.set(key, row);
  }

  const netTotal = orders.reduce((s, o) => s + o.net, 0);
  const rawComTotal = orders.reduce((s, o) => s + rawCommission(o), 0);

  // Refunds: what the invoice says we sold, less what the orders add up to.
  const refundTotal        = round2(invoice.netSalesPreCommission - netTotal);
  const commissionResidual = round2(invoice.commission - rawComTotal);

  const rows = [...buckets.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.shift === 'lunch' ? -1 : 1));

  // Spread both adjustments in proportion to each row's net sales. Rounding each
  // row would leave the totals a cent or two off the invoice, so the largest row
  // is derived from the invoice total minus every other row — that ties exactly
  // whichever way the individual roundings fall.
  const biggest = rows.reduce((best, r) => (r.netSales > best.netSales ? r : best), rows[0]);

  for (const row of rows) {
    if (row === biggest) continue;   // settled below, from what the others leave
    const share = netTotal === 0 ? 0 : row.netSales / netTotal;
    row.refundEst  = round2(refundTotal * share);
    row.commission = round2(row.rawCommission + commissionResidual * share);
  }

  const others = rows.filter(r => r !== biggest);
  biggest.refundEst  = round2(refundTotal        - others.reduce((s, r) => s + r.refundEst,  0));
  biggest.commission = round2(invoice.commission - others.reduce((s, r) => s + r.commission, 0));

  for (const row of rows) {
    row.gross     = round2(row.gross);
    row.netSales  = round2(row.netSales);
    row.netPreAds = round2(row.netSales + row.refundEst - row.commission);
  }

  return {
    rows: rows.map(({ rawCommission: _drop, ...r }) => r),
    offShiftOrders: orders.filter(o => o.offShift).length,
    refundTotal,
    commissionResidual,
  };
}
