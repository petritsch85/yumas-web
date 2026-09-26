/**
 * When a bill is actually due.
 *
 * Most invoices print a date. Many do not — they print a condition instead:
 * "Zahlbar sofort ohne Abzüge", "14 Tage netto", "zahlbar innerhalb von 30
 * Tagen". Those left the due date empty, so the bill showed no deadline at all
 * and dropped out of every payment run.
 *
 * "Sofort" is read as **a week from the invoice date** rather than the same
 * day. A supplier asking to be paid immediately is stating a preference, not a
 * deadline; invoices arrive days after they are written, and paying the day a
 * scan lands would mean a payment run every morning. A week is the interval
 * the payment run actually works on.
 */

/** A week, for an invoice that asks to be paid at once. */
export const SOFORT_DAYS = 7;

/** "Zahlbar sofort", "payable immediately", "netto Kasse". */
const IMMEDIATE = /\bsofort\b|sofort(?:ige|iger)?\s*(?:zahlung|f[äa]llig)|netto\s*kasse|ohne\s*abzug|immediate|upon\s*receipt|due\s*on\s*receipt|payable\s*(?:immediately|on\s*receipt)/i;

/** Collected by the supplier: nothing to pay, so nothing to schedule. */
const AUTO_COLLECTED = /lastschrift|einzug|direct\s*debit|sepa[- ]?(?:dd|lastschrift|einzug|direct)|paypal|kreditkarte|credit\s*card|mastercard|visa|amex|girocard|ec-?karte/i;

/**
 * "14 Tage netto", "zahlbar innerhalb von 30 Tagen", "Zahlungsziel 21 Tage".
 * Returns the number of days, or null where the text states none.
 */
export function netDays(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(?:innerhalb\s*(?:von\s*)?)?(\d{1,3})\s*(?:kalender)?tage?n?\b|\bnetto\s*(\d{1,3})\b|\bnet\s*(\d{1,3})\b/i);
  const n = m ? Number(m[1] ?? m[2] ?? m[3]) : NaN;
  // A "3 % innerhalb 8 Tagen" discount line is not the payment term itself,
  // but taking the number is still closer than having no date at all.
  return Number.isFinite(n) && n > 0 && n <= 180 ? n : null;
}

const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export interface DueDateInput {
  invoiceDate: string | null | undefined;
  /** The date printed on the invoice, where it printed one. */
  dueDate: string | null | undefined;
  /** The payment condition as printed — "Zahlbar sofort ohne Abzüge". */
  terms: string | null | undefined;
}

/**
 * The due date to store.
 *
 * A printed date always wins: it is what the supplier asked for. Otherwise the
 * condition is read, and where that says nothing the date stays empty rather
 * than being invented.
 */
export function resolveDueDate({ invoiceDate, dueDate, terms }: DueDateInput): string | null {
  if (dueDate) return dueDate;
  if (!invoiceDate) return null;

  const days = netDays(terms);
  if (days != null) return addDays(invoiceDate, days);
  if (IMMEDIATE.test(terms ?? '')) return addDays(invoiceDate, SOFORT_DAYS);
  return null;
}

/** True when the supplier collects the money itself, so nothing needs paying. */
export const isAutoCollected = (terms: string | null | undefined) => AUTO_COLLECTED.test(terms ?? '');
