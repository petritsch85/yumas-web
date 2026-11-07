/**
 * Bringing a bill's lines to the net of the bill.
 *
 * Lines are what the product figures add up, and they are meant to be net and
 * after discount. Invoices do not all print them so: some print every amount
 * with VAT, some take a Rabatt off the whole invoice below the lines, and METRO
 * lists a Leergut coupon among them, which is a way of paying, not a cost.
 *
 * The figures are only moved when the result reaches the bill's own net. A line
 * that was misread is not spread over the others to make the sum come right: it
 * stays as read, so the difference to the bill shows up on the COGS page.
 */

type Line = Record<string, unknown>;

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const sum = (ls: Line[]) => ls.reduce((t, l) => t + num(l.line_total), 0);

/** A voucher for returned empties, redeemed against the amount to pay. */
const PAYMENT_LINE = /leergutc\b|leergutc\.|leergutcoupon|leergutbon/i;
const DEPOSIT_LINE = /leergut|pfand|klappkiste|mehrwegkiste|europalette/i;

/** Rounding on each line can leave a few cents between their sum and the net. */
const tolerance = (n: number) => Math.max(0.05, n * 0.01);

export function settleLines(d: Record<string, unknown>): void {
  if (!Array.isArray(d.lines) || !d.lines.length) return;
  const net = Number(d.net_amount), gross = Number(d.gross_amount);
  if (!Number.isFinite(net) || !Number.isFinite(gross)) return;

  const read = d.lines as Line[];
  /* Worked on a copy, so a bill that will not tie keeps its lines as read. */
  const lines = read.filter(l => !PAYMENT_LINE.test(String(l.description ?? ''))).map(l => ({ ...l }));
  const tol = tolerance(lines.length);

  const hasVat = Math.abs(gross - net) > 0.05;
  const inclVat = hasVat && (d.prices_include_vat === true || Math.abs(sum(lines) - gross) <= tol);
  const reported = num(d.invoice_discount_amount);

  /* A discount comes off in the terms the lines are printed in, so before any
     VAT is removed. Empties earn none: FFD's 10% runs on the goods alone. */
  const target = inclVat ? gross : net;
  const discount = sum(lines) - target;
  if (reported > 0 && Math.abs(discount - reported) <= tol) {
    const goods = lines.filter(l => num(l.line_total) > 0 && l.is_deposit !== true && !DEPOSIT_LINE.test(String(l.description ?? '')));
    const base = sum(goods);
    if (base > 0 && discount < base) {
      const f = 1 - discount / base;
      for (const l of goods) l.line_total = r2(num(l.line_total) * f);
    }
  }

  if (inclVat) {
    for (const l of lines) {
      const rate = 1 + num(l.vat_rate) / 100;
      const printedAsProduct = Math.abs(num(l.quantity) * num(l.unit_price) - num(l.line_total)) < 0.02;
      if (printedAsProduct) l.unit_price = r2(num(l.unit_price) / rate);
      l.line_total = r2(num(l.line_total) / rate);
    }
  }

  const left = r2(net - sum(lines));
  if (Math.abs(left) > tol) {
    console.warn(`[bill-lines] lines do not reach the net by ${left}; kept as read`, d.invoice_number);
    return;
  }
  if (left) {
    const big = lines.reduce((a, l) => Math.abs(num(l.line_total)) > Math.abs(num(a.line_total)) ? l : a);
    big.line_total = r2(num(big.line_total) + left);
  }
  d.lines = lines;
}
