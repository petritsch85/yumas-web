/**
 * Parser for the Lieferando weekly statement — the delivery platform used in
 * Eschborn.
 *
 * Lieferando sends one PDF a week (Sunday to Saturday) that is three documents
 * in one: the invoice for its fees, the list of every order, and the payout.
 * The statement is read into the same shape Wolt periods use, so the P&L can
 * show both channels with one set of lines:
 *
 *   Net sales · pre refunds   order value net of VAT
 *   Refunds                   what Lieferando deducted for refunds
 *   Net sales · pre com, Ads
 *   Commission                service fee (14% of order value) + admin fee per order
 *   Net sales · pre Ads
 *   Advertising               TopRank — the paid ranking
 *   Net sales
 *
 * Fees are billed net with 19% VAT on top; we reclaim the VAT, so the net fee
 * is the cost. The order value is gross — what the customer paid — and the
 * statement gives no VAT split, so net sales assume one rate. Delivered food
 * is 7%, and that is also the rate Wolt reports on Eschborn's whole order
 * value, so 7% is the working assumption.
 *
 * The check is the payout: order value plus tips less the invoice must equal
 * what Lieferando transferred.
 */

import { LUNCH_END_MINUTES } from './wolt-sales-report';

export class LieferandoParseError extends Error {}

/** The VAT rate assumed on the order value. See the header note. */
export const LIEFERANDO_VAT_RATE = 0.07;
/** VAT Lieferando adds to its fees. */
const FEE_VAT_RATE = 0.19;

const round2 = (n: number) => Math.round(n * 100) / 100;
const AMOUNT = String.raw`(-?[\d.]+,\d{2})`;

export interface LieferandoOrder {
  orderNumber: string;
  /** ISO local time, e.g. "2026-09-07T10:25:58". */
  orderedAt:   string;
  saleDate:    string;
  shift:       'lunch' | 'dinner';
  gross:       number;
  tip:         number;
  /** A Rückbuchung on this order — gross, held positive. */
  refund:      number;
  onlinePaid:  boolean;
}

export interface LieferandoStatement {
  invoiceNumber:  string;
  invoiceDate:    string;
  periodStart:    string;
  periodEnd:      string;
  restaurant:     string;
  customerNumber: string;

  orderCount:      number;
  orderValueGross: number;
  netSalesPreCommission: number;
  vatRateAssumed:  number;

  serviceFeeRate: number | null;
  serviceFee:     number;
  adminFee:       number;
  topRank:        number;
  otherFees:      number;
  refunds:        number;

  commission:     number;
  netSalesPreAds: number;
  advertising:    number;
  netSalesFinal:  number;

  feesNet:      number;
  feesVat:      number;
  invoiceGross: number;
  tips:         number;
  payout:       number | null;
  checkOk:      boolean;

  orders:   LieferandoOrder[];
  warnings: string[];
}

/** One statement, read and checked, as the upload card shows it. */
export interface LieferandoSetResult {
  source:        string;
  locationId?:   string;
  locationName?: string;
  data?:         LieferandoStatement;
  breakdown?:    LieferandoShiftRow[];
  warnings:      string[];
  error?:        string;
}

export interface LieferandoShiftRow {
  date:  string;
  shift: 'lunch' | 'dinner';
  orders: number;
  gross:  number;
  netSales:       number;
  refundEst:      number;
  commission:     number;
  netPreAds:      number;
  advertisingEst: number;
  netFinal:       number;
}

const num  = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.'));
/** "13-09-2026" → "2026-09-13". */
const isoDate = (s: string) => { const [d, m, y] = s.split('-'); return `${y}-${m}-${d}`; };

function need(text: string, re: RegExp, what: string): RegExpMatchArray {
  const m = text.match(re);
  if (!m) throw new LieferandoParseError(`Could not find ${what}.`);
  return m;
}
const optional = (text: string, re: RegExp): number => {
  const m = text.match(re);
  return m ? num(m[1]) : 0;
};

/** True when this document is a Lieferando statement. */
export const isLieferandoStatement = (text: string) =>
  /Lieferando\.de|yd\.yourdelivery|takeaway\.com/i.test(text);

export function parseLieferandoStatement(text: string): LieferandoStatement {
  if (!isLieferandoStatement(text)) {
    throw new LieferandoParseError('This is not a Lieferando statement.');
  }
  const warnings: string[] = [];

  if (!/Bestellungen im Wert von/.test(text)) {
    const item = text.match(/Folgende Leistungen stellen wir Ihnen in Rechnung:\s*\n([^\n]+)/);
    throw new LieferandoParseError(
      `Not a weekly statement — this is a Lieferando invoice for "${item?.[1]?.trim() ?? 'something else'}". It carries no orders, so it belongs in Bills, not here.`,
    );
  }
  const invoiceNumber = need(text, /Rechnungsnummer:\s*(\d+)/, 'the invoice number')[1];
  const invoiceDate   = isoDate(need(text, /Datum:\s*(\d{2}-\d{2}-\d{4})/, 'the invoice date')[1]);
  const customerNumber = need(text, /Kundennummer:\s*(\d+)/, 'the customer number')[1];
  const restaurant = need(text, /z\.Hd\.\s*(.+)|Restaurant:\s*([^(\n]+)\(/, 'the restaurant');
  const restaurantName = (restaurant[1] ?? restaurant[2]).trim();

  // "Lieferando.de (06-09-2026 bis einschließlich 12-09-2026): 15 Bestellungen im Wert von € 570,66"
  const head = need(text,
    new RegExp(String.raw`Lieferando\.de\s*\((\d{2}-\d{2}-\d{4}) bis einschl(?:ießlich|\.) (\d{2}-\d{2}-\d{4})\):\s*(\d+) Bestellungen im Wert von €\s*` + AMOUNT),
    'the period and order value');
  const periodStart = isoDate(head[1]);
  const periodEnd   = isoDate(head[2]);
  const orderCount  = parseInt(head[3], 10);
  const orderValueGross = num(head[4]);

  // Fee lines. Each is net; VAT is added once, on the Zwischensumme.
  const service = text.match(new RegExp(String.raw`Servicegebühr:\s*([\d,]+)% von €\s*[\d.,]+\s*€\s*` + AMOUNT));
  const serviceFeeRate = service ? num(service[1]) / 100 : null;
  const serviceFee = service ? num(service[2]) : 0;
  const topRank  = optional(text, new RegExp(String.raw`TopRank:[^\n]*€\s*` + AMOUNT));
  // "Servicegebühr: € 0,64 x 15 € 9,60" — the per-order admin fee for online payments
  const adminFee = optional(text, new RegExp(String.raw`Servicegebühr:\s*€\s*[\d,]+ x \d+\s*€\s*` + AMOUNT));
  // "Rückbuchung 1 Bestellungen im Wert von € -8,00" — the summary of refunds;
  // the order list carries each one as a negative line.
  const refundsStated = Math.abs(optional(text, new RegExp(String.raw`Rückbuchung(?:en)?\s+\d+ Bestellungen im Wert von €\s*` + AMOUNT)));

  const feesNet      = num(need(text, new RegExp(String.raw`Zwischensumme\s*€\s*` + AMOUNT), 'the Zwischensumme')[1]);
  const feesVat      = num(need(text, new RegExp(String.raw`MwSt\.\s*\(19% von €\s*[\d.,]+\)\s*€\s*` + AMOUNT), 'the fee VAT')[1]);
  const invoiceGross = num(need(text, new RegExp(String.raw`Gesamtbetrag dieser Rechnung\s*€\s*` + AMOUNT), 'the invoice total')[1]);
  const tips   = optional(text, new RegExp(String.raw`Trinkgelder\s+\d+ Bestellungen im Wert von €\s*` + AMOUNT));
  const payoutM = text.match(new RegExp(String.raw`Auszahlung auf das Bankkonto[^\n]*€\s*` + AMOUNT));
  const payout = payoutM ? num(payoutM[1]) : null;

  // Whatever the known fee lines do not explain is "other" — reported, and
  // counted as commission, since it is a cost of the order either way.
  const otherFees = round2(feesNet - serviceFee - topRank - adminFee);
  if (Math.abs(otherFees) >= 0.01) {
    warnings.push(`${otherFees.toFixed(2).replace('.', ',')} € of fees on the invoice are not the service fee, TopRank or admin fee — counted as commission.`);
  }
  if (Math.abs(round2(feesNet * (1 + FEE_VAT_RATE)) - invoiceGross) > 0.011) {
    warnings.push('Fee VAT does not add up to the invoice total.');
  }

  // ── Orders ──
  // "07-09-2026, 10:25:58 GHH4HV 29,50 *" — the star marks online payment.
  // A busy week is printed two orders to a line, so the pattern is not
  // anchored to line ends. A refund is a negative line under the order's own
  // number, dated when it was booked.
  const orders: LieferandoOrder[] = [];
  const refundLines: { orderNumber: string; saleDate: string; time: string; amount: number }[] = [];
  const orderRe = new RegExp(String.raw`(\d{2}-\d{2}-\d{4}), (\d{2}:\d{2}:\d{2}) ([A-Z0-9]{5,8}) ` + AMOUNT + String.raw`( \*)?`, 'g');
  // The tips section lists orders again with the tip amount; it comes after
  // "Trinkgelder erhalten", so split there.
  const [orderPart, tipPart] = text.split(/Trinkgelder erhalten von/);
  let m: RegExpExecArray | null;
  while ((m = orderRe.exec(orderPart)) !== null) {
    const saleDate = isoDate(m[1]);
    const amount = num(m[4]);
    if (amount < 0) { refundLines.push({ orderNumber: m[3], saleDate, time: m[2], amount: -amount }); continue; }
    const [hh, mm] = m[2].split(':').map(Number);
    orders.push({
      orderNumber: m[3],
      orderedAt:   `${saleDate}T${m[2]}`,
      saleDate,
      shift:       hh * 60 + mm <= LUNCH_END_MINUTES ? 'lunch' : 'dinner',
      gross:       amount,
      tip:         0,
      refund:      0,
      onlinePaid:  !!m[5],
    });
  }
  for (const r of refundLines) {
    const o = orders.find(x => x.orderNumber === r.orderNumber);
    if (o) { o.refund = round2(o.refund + r.amount); continue; }
    // A refund for an order from an earlier week: keep it, with no sale behind it.
    const [hh, mm] = r.time.split(':').map(Number);
    orders.push({
      orderNumber: r.orderNumber, orderedAt: `${r.saleDate}T${r.time}`, saleDate: r.saleDate,
      shift: hh * 60 + mm <= LUNCH_END_MINUTES ? 'lunch' : 'dinner',
      gross: 0, tip: 0, refund: r.amount, onlinePaid: true,
    });
  }
  const refundsGross = round2(refundLines.reduce((t, r) => t + r.amount, 0));
  if (Math.abs(refundsGross - refundsStated) > 0.011) {
    warnings.push(`Refund lines add to ${refundsGross.toFixed(2)} but the statement says ${refundsStated.toFixed(2)}.`);
  }
  if (tipPart) {
    const tipRe = new RegExp(String.raw`^(\d{2}-\d{2}-\d{4}), \d{2}:\d{2}:\d{2} ([A-Z0-9]{5,8}) ` + AMOUNT + String.raw`\s*$`, 'gm');
    while ((m = tipRe.exec(tipPart)) !== null) {
      const o = orders.find(x => x.orderNumber === m![2]);
      if (o) o.tip = num(m[3]);
    }
  }

  const sold = orders.filter(o => o.gross > 0);
  const listedGross = round2(sold.reduce((t, o) => t + o.gross, 0));
  if (sold.length !== orderCount || Math.abs(listedGross - orderValueGross) > 0.011) {
    throw new LieferandoParseError(
      `The order list (${sold.length} orders, ${listedGross.toFixed(2)}) does not match the invoice header (${orderCount} orders, ${orderValueGross.toFixed(2)}).`,
    );
  }
  const outside = orders.filter(o => o.saleDate < periodStart || o.saleDate > periodEnd);
  if (outside.length) warnings.push(`${outside.length} order(s) fall outside the stated period.`);

  // ── The P&L figures ──
  const netSalesPreCommission = round2(orderValueGross / (1 + LIEFERANDO_VAT_RATE));
  const refundsNet     = round2(refundsGross / (1 + LIEFERANDO_VAT_RATE));
  const commission     = round2(serviceFee + adminFee + otherFees);
  const netSalesPreAds = round2(netSalesPreCommission - refundsNet - commission);
  const advertising    = topRank;
  const netSalesFinal  = round2(netSalesPreAds - advertising);

  // Order value and tips are held by Lieferando; the invoice is taken out of
  // them and the rest is transferred.
  const expectedPayout = round2(orderValueGross + tips - refundsGross - invoiceGross);
  const checkOk = payout === null ? false : Math.abs(expectedPayout - payout) < 0.011;

  return {
    invoiceNumber, invoiceDate, periodStart, periodEnd,
    restaurant: restaurantName, customerNumber,
    orderCount, orderValueGross, netSalesPreCommission, vatRateAssumed: LIEFERANDO_VAT_RATE,
    serviceFeeRate, serviceFee, adminFee, topRank, otherFees, refunds: refundsNet,
    commission, netSalesPreAds, advertising, netSalesFinal,
    feesNet, feesVat, invoiceGross, tips, payout, checkOk,
    orders, warnings,
  };
}

/**
 * Cuts the statement into days and shifts.
 *
 * Commission is allocated per order from the rate and the per-order admin
 * fee; TopRank is a flat amount per order; refunds and anything unexplained
 * are spread by gross. Each column is then reconciled to the statement total
 * so the shifts add up to the period to the cent.
 */
export function buildLieferandoBreakdown(st: LieferandoStatement): LieferandoShiftRow[] {
  const byKey = new Map<string, LieferandoShiftRow>();
  const totalGross = st.orderValueGross || 1;
  const perOrderAdmin = st.orderCount ? st.adminFee / st.orderCount : 0;
  const perOrderAds   = st.orderCount ? st.topRank  / st.orderCount : 0;

  for (const o of st.orders) {
    const k = `${o.saleDate}|${o.shift}`;
    const r = byKey.get(k) ?? {
      date: o.saleDate, shift: o.shift, orders: 0, gross: 0, netSales: 0,
      refundEst: 0, commission: 0, netPreAds: 0, advertisingEst: 0, netFinal: 0,
    };
    const share = o.gross / totalGross;
    if (o.gross > 0) {
      r.orders     += 1;
      r.commission += perOrderAdmin;
      r.advertisingEst += perOrderAds;
    }
    r.gross      += o.gross;
    r.netSales   += o.gross / (1 + st.vatRateAssumed);
    // Refunds are dated on the statement, so they land on their own day.
    r.refundEst  -= o.refund / (1 + st.vatRateAssumed);
    r.commission += o.gross * (st.serviceFeeRate ?? 0) + st.otherFees * share;
    byKey.set(k, r);
  }

  const rows = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));

  // Round, then push any cent of drift onto the largest shift so the columns
  // tie to the statement.
  const tie = (field: 'netSales' | 'refundEst' | 'commission' | 'advertisingEst', target: number) => {
    for (const r of rows) r[field] = round2(r[field]);
    const drift = round2(target - rows.reduce((t, r) => t + r[field], 0));
    if (drift !== 0 && rows.length) {
      const big = rows.reduce((a, b) => (b.gross > a.gross ? b : a));
      big[field] = round2(big[field] + drift);
    }
  };
  tie('netSales',       st.netSalesPreCommission);
  tie('refundEst',     -st.refunds);
  tie('commission',     st.commission);
  tie('advertisingEst', st.advertising);

  for (const r of rows) {
    r.gross     = round2(r.gross);
    r.netPreAds = round2(r.netSales + r.refundEst - r.commission);
    r.netFinal  = round2(r.netPreAds - r.advertisingEst);
  }
  return rows;
}
