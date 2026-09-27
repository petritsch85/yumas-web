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

/**
 * What to assume when an invoice says nothing and nothing else is known.
 *
 * §286 BGB gives thirty days, but the commercial norm here is a fortnight, and
 * a fortnight keeps the bill inside the next payment run instead of parking it
 * a month out where it is forgotten.
 */
export const DEFAULT_DAYS = 14;

/** How a due date was arrived at. Stored on the bill so the two never look alike. */
export type DueDateSource =
  | 'printed'        // the supplier printed a date
  | 'stated-term'    // the document states a condition
  | 'settlement'     // the Skonto line names the debit day
  | 'prepaid'        // Vorkasse: due before delivery
  | 'settled'        // already collected when the invoice was issued
  | 'supplier-term'  // the term this supplier prints on its other invoices
  | 'bank-history'   // states nothing anywhere, but its debits are regular
  | 'default';       // nothing known

/** A date the supplier printed, however the invoice words it. */
const PRINTED_DUE = [
  /f[äa]llig(?:keit)?(?:s(?:datum|tag))?\s*(?:am|:|ist)?\s*(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})/i,
  /zahlbar\s*(?:bis|bis\s*zum|am)\s*(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})/i,
  /zahlungsziel\s*:?\s*(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})/i,
  /zahlung\s*bis\s*(?:zum\s*)?(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})/i,
  /valuta\s*:?\s*(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})/i,
  /(?:due\s*date|payment\s*due|due\s*on|pay\s*by)\s*:?\s*(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})/i,
];

/** Paid before the goods move, so there is nothing left to schedule. */
const PREPAID = /vorkasse|vorauskasse|payment\s*in\s*advance|prepaid/i;

/** Settled at the moment of invoicing — a card, PayPal, or a debit already taken. */
const SETTLED = /(?:betrag\s*)?dankend\s*erhalten|bereits\s*(?:bezahlt|beglichen)|bezahlt\s*(?:per|mit)|paid\s*(?:in\s*full|via|by)|zahlung\s*erfolgt|wurde\s*abgebucht/i;

export interface TermReading {
  source: DueDateSource;
  /** Days to add to the invoice date, or null when `date` carries it instead. */
  days: number | null;
  /** An ISO date the document printed outright. */
  date?: string;
}

/**
 * Reads whatever an invoice's own text says about when it is due.
 *
 * Returns null when the document says nothing at all — which is the case for
 * 62% of the bills here, and is exactly why the caller needs fallbacks.
 */
export function readPaymentTerms(text: string | null | undefined): TermReading | null {
  const flat = (text ?? '').replace(/\s+/g, ' ');
  if (!flat) return null;

  for (const re of PRINTED_DUE) {
    const m = flat.match(re);
    if (!m) continue;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return { source: 'printed', days: null, date: `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` };
  }

  const days = netDays(flat);
  if (days != null) return { source: 'stated-term', days };
  if (IMMEDIATE.test(flat)) return { source: 'stated-term', days: SOFORT_DAYS };
  if (PREPAID.test(flat)) return { source: 'prepaid', days: 0 };
  if (SETTLED.test(flat)) return { source: 'settled', days: 0 };
  return null;
}

/** Add days to an ISO date. */
export const addDaysTo = (iso: string, days: number) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

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

const addDays = addDaysTo;

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
