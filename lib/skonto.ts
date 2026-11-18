/**
 * Reading the Skonto settlement line off an invoice.
 *
 * A German supplier collecting by direct debit usually prints exactly what it
 * will take, and when:
 *
 *   "Der Rechnungsbetrag wird am 02.10.26 per Lastschrift abzüglich
 *    2.00 % / 14.46 EUR Skonto = 756.24 EUR abgebucht"
 *
 * That last figure is what turns up on the bank statement. The gross never
 * does, so a bill matched on its gross alone can never be found in the bank.
 *
 * The discount cannot be computed. Pfand and Leergut fall outside the
 * skontierfähiger Betrag, so against the gross the same "2%" lands anywhere
 * between 1,88% and 2,59% — sometimes on a base larger than the gross itself,
 * where deposits were credited back. Only the printed figure is right.
 */

export interface Settlement {
  /** What the supplier will actually collect. */
  amount: number;
  /** The discount in euros, as printed. */
  discount: number;
  /** The rate as printed — against the supplier's own base, not the gross. */
  percent: number;
  /** The date the invoice says the debit falls, ISO, when it is stated. */
  date: string | null;
}

/* German invoices write 1.234,56 and, like Leleithner, sometimes 1234.56.
   A comma is always the decimal mark; a dot is only one when no comma is
   present and it has exactly two digits behind it. */
function parseAmount(raw: string): number {
  const s = raw.trim();
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  return Number(s.replace(/\.(?=\d{3}\b)/g, ''));
}

const SKONTO =
  /abz(?:ü|ue|u)glich\s+([\d.,]+)\s*%\s*(?:\/|von|:)?\s*([\d.,]+)\s*(?:EUR|€)?\s*Skonto\s*=\s*([\d.,]+)\s*(?:EUR|€)/i;

/** "wird am 02.10.26 per Lastschrift" — when the money goes. */
const DEBIT_DATE = /\bam\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b[^.]{0,40}?(?:per\s+)?Lastschrift/i;

/**
 * Pulls the settlement out of an invoice's text, or null when it states none.
 *
 * `gross` is used only as a sanity check: a settlement must be a discount off
 * the invoice, never more than it and never wildly less, which keeps a figure
 * picked up from the wrong line out of the bank matching.
 */
export function parseSettlement(text: string, gross?: number | null): Settlement | null {
  const m = text.match(SKONTO);
  if (!m) return null;

  const percent = parseAmount(m[1]);
  const discount = parseAmount(m[2]);
  const amount = parseAmount(m[3]);
  if (![percent, discount, amount].every(n => Number.isFinite(n) && n >= 0)) return null;
  if (amount <= 0) return null;

  if (typeof gross === 'number' && gross > 0) {
    if (amount > gross + 0.01) return null;          // a discount cannot raise the bill
    if (amount < gross * 0.85) return null;          // 15% is not Skonto, it is a misread
    if (Math.abs(gross - discount - amount) > 0.02) return null;  // the three must agree
  }

  const d = text.match(DEBIT_DATE);
  let date: string | null = null;
  if (d) {
    const [, dd, mm, yy] = d;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    date = `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  return { amount, discount, percent, date };
}

/**
 * The amounts a bill can plausibly show up as in the bank: its gross, and the
 * discounted figure when the supplier takes Skonto. Used by matching, which
 * should accept either.
 */
/**
 * The Skonto a bill offers, as the payment lists show and use it.
 *
 * Two kinds reach the bills: a supplier who collects by direct debit and takes
 * the discount itself (Leleithner — nothing to do but know), and one who allows
 * it when we pay by a date (serviettengastro: "460,65 € bis 07.11.2026 mit
 * Skonto von 2 %"). For the second the printed reduced amount is used; where
 * the invoice gives only the rate, the amount is worked out from the gross and
 * says so, since a supplier's base can exclude Pfand.
 */
export interface SkontoOffer {
  percent: number | null;
  /** What to pay with the discount. */
  amount: number;
  /** Gross less amount. */
  saving: number;
  /** The last day the discount holds, ISO, when known. */
  until: string | null;
  /** The supplier collects and deducts it itself; nothing for us to act on. */
  auto: boolean;
  /** Worked out from the rate, not printed. */
  computed: boolean;
}

export function skontoOffer(bill: {
  gross_amount: number;
  settlement_amount?: number | null;
  settlement_date?: string | null;
  discount_percent?: number | null;
  payment_method?: string | null;
}, autoPayment: RegExp): SkontoOffer | null {
  const gross = Number(bill.gross_amount);
  const printed = typeof bill.settlement_amount === 'number' && bill.settlement_amount > 0
    && bill.settlement_amount < gross - 0.005 ? bill.settlement_amount : null;
  const pct = typeof bill.discount_percent === 'number' && bill.discount_percent > 0 && bill.discount_percent < 15
    ? bill.discount_percent : null;
  if (printed === null && pct === null) return null;
  const amount = printed ?? Math.round(gross * (1 - pct! / 100) * 100) / 100;
  return {
    percent: pct, amount, saving: Math.round((gross - amount) * 100) / 100,
    until: bill.settlement_date ?? null,
    auto: autoPayment.test(bill.payment_method ?? ''),
    computed: printed === null,
  };
}

export function payableAmounts(bill: { gross_amount: number; settlement_amount?: number | null; discount_percent?: number | null }): number[] {
  const out = [Number(bill.gross_amount)];
  const s = bill.settlement_amount;
  if (typeof s === 'number' && s > 0 && Math.abs(s - Number(bill.gross_amount)) > 0.005) out.push(s);
  /* A rate without a printed amount: the transfer paid with Skonto is the
     gross less that rate, which is what the Sammelüberweisung sends. */
  else if (typeof bill.discount_percent === 'number' && bill.discount_percent > 0 && bill.discount_percent < 15) {
    out.push(Math.round(Number(bill.gross_amount) * (1 - bill.discount_percent / 100) * 100) / 100);
  }
  return out;
}

/** "2% Skonto innerhalb von 10 Tagen": the last day, from the invoice date. */
export function skontoDeadline(invoiceDate: string | null, days: number | null): string | null {
  if (!invoiceDate || !days || days <= 0 || days > 60) return null;
  const t = new Date(invoiceDate + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + Math.round(days));
  return t.toISOString().slice(0, 10);
}
