/**
 * The monthly Umsatzsteuervoranmeldung, computed from the documents.
 *
 * Built deliberately from the sales and invoice records rather than from the
 * bank: VAT is owed on the supply, not on the payment (Soll-Versteuerung), and
 * a card settlement or a platform payout is the same revenue arriving later,
 * net of somebody's fee. Reading the bank would double-count the takings and
 * lose the fee's input VAT.
 *
 * Two rates apply to a restaurant:
 *
 *  - food at 7%, drinks at 19%. Since 1 January 2026 that holds for in-house
 *    as well as takeaway, which is why the split is food-against-drinks and
 *    not in-house-against-takeaway. Before that date the same rows cannot be
 *    split this way, and the caller is warned rather than given a figure that
 *    looks precise and is not.
 *  - delivery sales are food, so 7%. The platform's commission is a service
 *    it invoices to us at 19% and is input VAT, not a reduction of revenue —
 *    which is the one place the P&L and the VAT return part company.
 *
 * Nothing here is a filing. It is the figure to check against, drill into and
 * compare with what the Steuerberater files.
 */

export const VAT_FOOD  = 0.07;
export const VAT_DRINK = 0.19;

/** The date from which in-house food is taxed at 7% like takeaway. */
export const FOOD_7_FROM = '2026-01-01';

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ── What the computation reads ── */

export interface UstvaShift {
  report_date: string;
  location_id: string;
  gross_food: number;
  gross_beverages: number;
  gross_total: number;
  vat_total: number;
}
export interface UstvaWebshop {
  sale_date: string;
  net_cents: number;
  vat_cents: number;
}
/** A day of delivery sales, net of VAT at the food rate. */
export interface UstvaDeliveryDay {
  sale_date: string;
  /** Net sales before refunds. */
  net_sales: number;
  /** Refunds, stored negative. */
  refund_est: number;
  /** Lieferando only: stamp-card redemptions, stored negative. */
  stamp_card_est?: number | null;
}
export interface UstvaOutgoingBill {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  customer_name: string | null;
  net_food: number; vat_7: number;
  net_drinks: number; vat_19: number;
}
export interface UstvaBill {
  id: string;
  supplier_name: string;
  invoice_number: string | null;
  invoice_date: string;
  net_amount: number;
  vat_amount: number;
  gross_amount: number;
  status: string;
  category: string | null;
}
/** A platform's own invoice to us — commission, advertising, card fees. */
export interface UstvaFeeInvoice {
  source: string;
  reference: string;
  invoice_date: string;
  net: number;
  vat: number;
}

export interface UstvaInput {
  from: string;
  to: string;
  shifts:      UstvaShift[];
  webshop:     UstvaWebshop[];
  wolt:        UstvaDeliveryDay[];
  lieferando:  UstvaDeliveryDay[];
  outgoing:    UstvaOutgoingBill[];
  bills:       UstvaBill[];
  feeInvoices: UstvaFeeInvoice[];
}

/* ── What it produces ── */

/** One source of revenue or input VAT, at one rate. */
export interface UstvaLine {
  key:   string;
  label: string;
  rate:  number;
  net:   number;
  vat:   number;
  /** How many documents or days stand behind it. */
  count: number;
  note?: string;
}

/** Something a person has to look at before this could be filed. */
export interface UstvaCheck {
  level: 'warn' | 'info';
  text:  string;
}

export interface UstvaResult {
  from: string; to: string;
  /** Kz 81 — revenue at 19%. */
  net19: number; vat19: number;
  /** Kz 86 — revenue at 7%. */
  net7:  number; vat7:  number;
  /** Kz 66 — input VAT. */
  inputVat: number; inputNet: number;
  /** Kz 83 — what would be payable. */
  payable: number;
  revenueLines: UstvaLine[];
  inputLines:   UstvaLine[];
  checks:       UstvaCheck[];
}

const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

export function computeUstva(input: UstvaInput): UstvaResult {
  const { from, to } = input;
  const checks: UstvaCheck[] = [];
  const revenueLines: UstvaLine[] = [];
  const inputLines: UstvaLine[] = [];

  /* ── Orderbird: the till ── */
  const shifts = input.shifts.filter(s => inRange(s.report_date, from, to));
  const foodGross  = shifts.reduce((t, s) => t + Number(s.gross_food ?? 0), 0);
  const drinkGross = shifts.reduce((t, s) => t + Number(s.gross_beverages ?? 0), 0);
  const tillFoodNet  = round2(foodGross  / (1 + VAT_FOOD));
  const tillDrinkNet = round2(drinkGross / (1 + VAT_DRINK));
  const tillFoodVat  = round2(foodGross  - tillFoodNet);
  const tillDrinkVat = round2(drinkGross - tillDrinkNet);
  const tillDays = new Set(shifts.map(s => s.report_date)).size;

  if (shifts.length > 0) {
    revenueLines.push({ key: 'till-7',  label: 'Orderbird · food',   rate: 7,  net: tillFoodNet,  vat: tillFoodVat,  count: tillDays });
    revenueLines.push({ key: 'till-19', label: 'Orderbird · drinks', rate: 19, net: tillDrinkNet, vat: tillDrinkVat, count: tillDays });
  }

  /* The till states its own VAT total. Splitting food from drinks should
     reproduce it; where it does not, the split is wrong and the return would
     be too. A few cents a shift is rounding. */
  const reportedVat = round2(shifts.reduce((t, s) => t + Number(s.vat_total ?? 0), 0));
  const computedVat = round2(tillFoodVat + tillDrinkVat);
  const vatDelta    = round2(computedVat - reportedVat);
  if (shifts.length > 0 && Math.abs(vatDelta) > Math.max(1, shifts.length * 0.05)) {
    checks.push({
      level: 'warn',
      text: `The food/drinks split gives ${computedVat.toFixed(2)} € of VAT on till sales, but the Z-reports state ${reportedVat.toFixed(2)} € — a difference of ${vatDelta.toFixed(2)} €. Check the food and drinks columns before relying on Kz 81 and 86.`,
    });
  }
  if (from < FOOD_7_FROM) {
    checks.push({
      level: 'warn',
      text: 'This period is before 01.01.2026, when in-house food was still taxed at 19%. The split below treats all food as 7% and is therefore wrong for in-house sales.',
    });
  }

  /* ── Webshop: states its own VAT, so it is taken as stated ── */
  const web = input.webshop.filter(w => inRange(w.sale_date, from, to));
  if (web.length > 0) {
    const net = round2(web.reduce((t, w) => t + w.net_cents, 0) / 100);
    const vat = round2(web.reduce((t, w) => t + w.vat_cents, 0) / 100);
    // Split by the rate each order actually carries rather than by assumption.
    const at19 = web.filter(w => w.net_cents > 0 && w.vat_cents / w.net_cents > 0.12);
    const n19 = round2(at19.reduce((t, w) => t + w.net_cents, 0) / 100);
    const v19 = round2(at19.reduce((t, w) => t + w.vat_cents, 0) / 100);
    if (n19 > 0) revenueLines.push({ key: 'web-19', label: 'Webshop · 19%', rate: 19, net: n19, vat: v19, count: at19.length });
    if (round2(net - n19) > 0) {
      revenueLines.push({ key: 'web-7', label: 'Webshop · 7%', rate: 7, net: round2(net - n19), vat: round2(vat - v19), count: web.length - at19.length });
    }
  }

  /* ── Delivery platforms: the customer's order value, at the food rate ──
     The commission is the platform's own service to us and appears below as
     input VAT; netting it off here would understate the revenue and lose the
     deduction. */
  const deliveryLine = (key: string, label: string, days: UstvaDeliveryDay[]) => {
    const rows = days.filter(d => inRange(d.sale_date, from, to));
    if (rows.length === 0) return;
    const net = round2(rows.reduce((t, d) =>
      t + Number(d.net_sales) + Number(d.refund_est ?? 0) + Number(d.stamp_card_est ?? 0), 0));
    if (net === 0) return;
    revenueLines.push({
      key, label, rate: 7, net, vat: round2(net * VAT_FOOD),
      count: new Set(rows.map(d => d.sale_date)).size,
      note: 'Order value net of VAT, before the platform’s commission',
    });
  };
  deliveryLine('wolt-7', 'Wolt · food', input.wolt);
  deliveryLine('lieferando-7', 'Lieferando · food', input.lieferando);

  /* ── Our own outgoing invoices: they state both bases ── */
  const out = input.outgoing.filter(b => inRange(b.invoice_date, from, to));
  if (out.length > 0) {
    const n7  = round2(out.reduce((t, b) => t + Number(b.net_food   ?? 0), 0));
    const v7  = round2(out.reduce((t, b) => t + Number(b.vat_7      ?? 0), 0));
    const n19 = round2(out.reduce((t, b) => t + Number(b.net_drinks ?? 0), 0));
    const v19 = round2(out.reduce((t, b) => t + Number(b.vat_19     ?? 0), 0));
    if (n7  !== 0) revenueLines.push({ key: 'bills-7',  label: 'Outgoing invoices · 7%',  rate: 7,  net: n7,  vat: v7,  count: out.length });
    if (n19 !== 0) revenueLines.push({ key: 'bills-19', label: 'Outgoing invoices · 19%', rate: 19, net: n19, vat: v19, count: out.length });
  }

  /* ── Input VAT ── */
  const bills = input.bills.filter(b => inRange(b.invoice_date, from, to));
  const approved = bills.filter(b => b.status === 'approved');
  const pending  = bills.filter(b => b.status !== 'approved');
  if (approved.length > 0) {
    inputLines.push({
      key: 'bills-in', label: 'Supplier invoices', rate: 0,
      net: round2(approved.reduce((t, b) => t + Number(b.net_amount ?? 0), 0)),
      vat: round2(approved.reduce((t, b) => t + Number(b.vat_amount ?? 0), 0)),
      count: approved.length,
    });
  }
  for (const fee of input.feeInvoices.filter(f => inRange(f.invoice_date, from, to))) {
    const existing = inputLines.find(l => l.key === `fee-${fee.source}`);
    if (existing) {
      existing.net = round2(existing.net + fee.net);
      existing.vat = round2(existing.vat + fee.vat);
      existing.count += 1;
    } else {
      inputLines.push({ key: `fee-${fee.source}`, label: `${fee.source} · fees`, rate: 19, net: round2(fee.net), vat: round2(fee.vat), count: 1 });
    }
  }

  /* ── The checks that decide whether this could be filed ── */
  if (pending.length > 0) {
    checks.push({
      level: 'warn',
      text: `${pending.length} supplier invoice${pending.length === 1 ? '' : 's'} dated in this period ${pending.length === 1 ? 'is' : 'are'} not approved, so ${pending.length === 1 ? 'its' : 'their'} input VAT of ${round2(pending.reduce((t, b) => t + Number(b.vat_amount ?? 0), 0)).toFixed(2)} € is not claimed here.`,
    });
  }
  const oddVat = approved.filter(b => {
    const gross = Number(b.gross_amount), vat = Number(b.vat_amount);
    if (!gross) return false;
    const share = vat / gross;
    return share < -0.001 || share > 0.20;
  });
  if (oddVat.length > 0) {
    checks.push({
      level: 'warn',
      text: `${oddVat.length} approved invoice${oddVat.length === 1 ? '' : 's'} carr${oddVat.length === 1 ? 'ies' : 'y'} a VAT rate no German invoice can have (${oddVat.slice(0, 3).map(b => b.supplier_name).join(', ')}${oddVat.length > 3 ? '…' : ''}). Claiming that input VAT would be wrong.`,
    });
  }
  const noVat = approved.filter(b => !Number(b.vat_amount));
  if (noVat.length > 0) {
    checks.push({
      level: 'info',
      text: `${noVat.length} approved invoice${noVat.length === 1 ? '' : 's'} show${noVat.length === 1 ? 's' : ''} no VAT — correct for rent or insurance, but check for a reverse-charge supply (§13b) among them.`,
    });
  }
  checks.push({
    level: 'info',
    text: 'Reverse charge (§13b), intra-Community acquisitions and any Dauerfristverlängerung are not computed here. If the company has them, this figure is incomplete.',
  });

  const net19 = round2(revenueLines.filter(l => l.rate === 19).reduce((t, l) => t + l.net, 0));
  const vat19 = round2(revenueLines.filter(l => l.rate === 19).reduce((t, l) => t + l.vat, 0));
  const net7  = round2(revenueLines.filter(l => l.rate === 7 ).reduce((t, l) => t + l.net, 0));
  const vat7  = round2(revenueLines.filter(l => l.rate === 7 ).reduce((t, l) => t + l.vat, 0));
  const inputVat = round2(inputLines.reduce((t, l) => t + l.vat, 0));
  const inputNet = round2(inputLines.reduce((t, l) => t + l.net, 0));

  return {
    from, to,
    net19, vat19, net7, vat7,
    inputVat, inputNet,
    payable: round2(vat19 + vat7 - inputVat),
    revenueLines, inputLines, checks,
  };
}
