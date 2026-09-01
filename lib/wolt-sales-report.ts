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

/** Lunch runs until 14:30. Everything after it counts as dinner; 17:30 is only
 *  used to tell an evening pre-order from an order placed during service. */
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
  /** Placed after lunch closed but before dinner opens — an evening pre-order. */
  preOrder:   boolean;
  /** Moved to the other shift because this one was closed that day. */
  reassigned?: boolean;
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
  /**
   * This shift's pro-rata share of what Wolt charged for services and
   * advertising. An estimate at shift level: Wolt bills it per period.
   */
  advertisingEst: number;
  /** netPreAds − advertisingEst. */
  netFinal: number;
}

export interface WoltShiftBreakdown {
  rows: WoltShiftRow[];
  /** Evening pre-orders: placed in the afternoon gap, counted as dinner. */
  preOrders: number;
  /** Orders moved because the shift their time implies was closed that day. */
  reassigned: number;
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
/** The timestamp itself: NUL-separated on one contract, colon-separated on the other. */
const TIME = '[\\s\\u0000:]+';

const ORDER_RE = new RegExp(
  `(\\d{2}\\.\\d{2}\\.\\d{4})${SEP}` +      // date
  `(\\d{1,2})${TIME}(\\d{2})${TIME}(\\d{2})${SEP}` + // hh mm ss
  `(\\d+)${SEP}` +                          // running index
  `(?:(Ja|Nein)${SEP})?` +                  // Wolt+, a column Wolt omits when no order used it
  `(\\d+)${SEP}` +                          // order number
  `([\\d.]+,\\d{2})${SEP}` +                // gross
  `([\\d.]+,\\d{2})`,                       // net
  'g',
);

/**
 * Assigns an order to a shift.
 *
 * Anything after lunch closes counts as dinner, including orders placed in the
 * afternoon gap: those are pre-orders for the evening, which on Wolt can be
 * placed hours ahead, so they belong to the dinner shift that fulfils them.
 */
function classify(minutes: number): { shift: WoltShift; preOrder: boolean } {
  if (minutes <= LUNCH_END_MINUTES) return { shift: 'lunch', preOrder: false };
  return { shift: 'dinner', preOrder: minutes < DINNER_START_MINUTES };
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
      woltPlus: woltPlus === 'Ja',   // absent column means no Wolt+ orders
      gross:    num(gross),
      net:      num(net),
      ...classify(minutes),
    });
  }

  // A period with no orders is legitimate — a closed week reports none — but so
  // is a layout this parser no longer understands. They are told apart by the
  // report's own total line.
  if (orders.length === 0 && !/Summes+0,00/.test(text)) {
    throw new WoltSalesParseError(
      'No orders could be read from the Wolt sales report, and it does not report an empty period.',
    );
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
  /** Total Wolt services & advertising for the period, net of VAT. */
  advertising = 0,
  /** Whether the restaurant was shut for that shift — see reassignment below. */
  isShiftClosed?: (date: string, shift: WoltShift) => boolean,
  /**
   * Commission rate for an order, on its gross value.
   *
   * Where Wolt delivers, commission is charged per order at a rate set by the
   * Wolt+ flag, and those rates reproduce the invoice exactly. On the
   * self-delivery contract Wolt charges its fees at period level instead, so a
   * rate of zero leaves the whole amount to be spread pro-rata on net sales.
   */
  rateFor: (order: WoltOrder) => number = (o) => (o.woltPlus ? RATE_WOLT_PLUS : RATE_STANDARD),
): WoltShiftBreakdown {
  /*
   * An order timed to a shift the restaurant was closed for was fulfilled by
   * the shift that was open — Westend takes no dinner covers on a Monday, yet
   * Wolt orders still arrive and get cooked at lunch. Booking them to a closed
   * shift would invent trade on a day the kitchen was shut.
   *
   * Only moved when exactly one of the two shifts was open; if the whole day
   * was closed there is nowhere better to put it, so it stays where it fell.
   */
  const placed = !isShiftClosed ? orders : orders.map(o => {
    const other: WoltShift = o.shift === 'lunch' ? 'dinner' : 'lunch';
    return isShiftClosed(o.date, o.shift) && !isShiftClosed(o.date, other)
      ? { ...o, shift: other, reassigned: true }
      : o;
  });
  orders = placed;
  // Raw per-order commission, before reconciling to the invoice.
  const rawCommission = (o: WoltOrder) => o.gross * rateFor(o);

  const buckets = new Map<string, WoltShiftRow & { rawCommission: number }>();
  for (const o of orders) {
    const key = `${o.date}|${o.shift}`;
    const row = buckets.get(key) ?? {
      date: o.date, shift: o.shift, orders: 0,
      gross: 0, netSales: 0, refundEst: 0, commission: 0, netPreAds: 0,
      advertisingEst: 0, netFinal: 0,
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

  if (rows.length === 0) {
    return { rows: [], preOrders: 0, reassigned: 0, refundTotal: 0, commissionResidual: 0 };
  }

  // Spread both adjustments in proportion to each row's net sales. Rounding each
  // row would leave the totals a cent or two off the invoice, so the largest row
  // is derived from the invoice total minus every other row — that ties exactly
  // whichever way the individual roundings fall.
  const biggest = rows.reduce((best, r) => (r.netSales > best.netSales ? r : best), rows[0]);

  for (const row of rows) {
    if (row === biggest) continue;   // settled below, from what the others leave
    const share = netTotal === 0 ? 0 : row.netSales / netTotal;
    row.refundEst      = round2(refundTotal * share);
    row.commission     = round2(row.rawCommission + commissionResidual * share);
    row.advertisingEst = round2(advertising * share);
  }

  const others = rows.filter(r => r !== biggest);
  biggest.refundEst      = round2(refundTotal        - others.reduce((s, r) => s + r.refundEst,      0));
  biggest.commission     = round2(invoice.commission - others.reduce((s, r) => s + r.commission,     0));
  biggest.advertisingEst = round2(advertising        - others.reduce((s, r) => s + r.advertisingEst, 0));

  for (const row of rows) {
    row.gross     = round2(row.gross);
    row.netSales  = round2(row.netSales);
    row.netPreAds = round2(row.netSales + row.refundEst - row.commission);
    row.netFinal  = round2(row.netPreAds - row.advertisingEst);
  }

  return {
    rows: rows.map(({ rawCommission: _drop, ...r }) => r),
    preOrders:  orders.filter(o => o.preOrder).length,
    reassigned: orders.filter(o => o.reassigned).length,
    refundTotal,
    commissionResidual,
  };
}
