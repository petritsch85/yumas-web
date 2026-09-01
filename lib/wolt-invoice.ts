/**
 * Parser for the Wolt "Rechnung (Selbstfakturierung)" — the merchant-to-Wolt
 * self-billing invoice that comes as file 2 of every Wolt document set.
 *
 * Wolt issues these for a five-day period, so one invoice never lines up with
 * a calendar week or month. This module only reads the period totals; the
 * per-day and per-shift split comes from the sales report, which carries an
 * order-level timestamp.
 *
 * Parsing is deterministic (regex over the extracted text) rather than
 * AI-driven: the layout is machine-generated and identical every time, and a
 * figure that silently drifts between runs is worse than one that fails loudly.
 */

/** Everything we take from one Wolt invoice. */
export interface WoltInvoiceData {
  /** Wolt's invoice number, e.g. "DEU/26/HRB96797/1/47". Unique per period. */
  invoiceNumber: string;
  /** Invoice date (ISO). Always the last day of the period in practice. */
  invoiceDate:   string;
  /** Leistungszeitraum — the five days this invoice covers (ISO). */
  periodStart:   string;
  periodEnd:     string;
  /** Restaurant as Wolt names it, e.g. "Yumas Westend". */
  restaurant:    string;

  /** (A) Zwischensumme aller verkauften Waren, net of VAT. */
  netSalesPreCommission: number;
  /** (B) Zwischensumme Wolt Vertrieb, net of VAT. Stored positive. */
  commission:            number;
  /** A − B, what we expect Wolt to pay before advertising. */
  netSalesPreAds:        number;

  /** Endbetrag as printed — the invoice's own A − B, used to check ours. */
  reportedEndbetrag: number;
  /** Whether our A − B matches the printed Endbetrag to the cent. */
  checkOk:           boolean;
}

/** Thrown when the invoice doesn't contain what we need. */
export class WoltParseError extends Error {}

/** "1.318,37" → 1318.37. Handles the leading minus Wolt puts on deductions. */
export function parseGermanNumber(raw: string): number {
  const cleaned = raw.trim().replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new WoltParseError(`Not a number: "${raw}"`);
  return n;
}

/** "25.08.2026" → "2026-08-25". */
export function parseGermanDate(raw: string): string {
  const m = raw.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) throw new WoltParseError(`Not a date: "${raw}"`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pull one capture group out, or fail with a message naming what was missing. */
function need(text: string, re: RegExp, what: string): string {
  const m = text.match(re);
  if (!m) throw new WoltParseError(`Could not find ${what} in the invoice.`);
  return m[1];
}

/** German amount: digits with optional thousands dots, comma decimals. */
const AMOUNT = String.raw`(-?[\d.]+,\d{2})`;

/**
 * Parse the extracted text of a Wolt self-billing invoice.
 *
 * @throws {WoltParseError} if the document isn't a Wolt self-billing invoice
 *   or a required figure is missing — better than returning a plausible zero.
 */
export function parseWoltInvoice(text: string): WoltInvoiceData {
  if (!/Rechnung\s*\(Selbstfakturierung\)/i.test(text)) {
    throw new WoltParseError(
      'This is not the Wolt self-billing invoice (Rechnung (Selbstfakturierung)).',
    );
  }

  const invoiceNumber = need(text, /Rechnungsnummer\s+(DEU\/\S+)/, 'the invoice number');
  const invoiceDate   = parseGermanDate(need(text, /Rechnungsdatum\s+(\d{2}\.\d{2}\.\d{4})/, 'the invoice date'));
  const restaurant    = need(text, /Restaurant\s+(.+)/, 'the restaurant name').trim();

  const period = text.match(/Leistungszeitraum\s+(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/);
  if (!period) throw new WoltParseError('Could not find the Leistungszeitraum (period) in the invoice.');

  // (A) and (B) are the subtotal lines; the first amount after each label is
  // the net-of-VAT column, which is the one we want.
  const netSalesPreCommission = parseGermanNumber(
    need(text, new RegExp(String.raw`Zwischensumme aller verkauften Waren \(A\)\s+` + AMOUNT), 'subtotal (A), the goods sold'),
  );
  // Wolt prints the commission as a negative; we hold it positive and subtract.
  const commission = Math.abs(parseGermanNumber(
    need(text, new RegExp(String.raw`Zwischensumme Wolt Vertrieb \(B\)\s+` + AMOUNT), 'subtotal (B), the Wolt commission'),
  ));
  const reportedEndbetrag = parseGermanNumber(
    need(text, new RegExp(String.raw`Endbetrag\s+` + AMOUNT), 'the Endbetrag'),
  );

  const netSalesPreAds = round2(netSalesPreCommission - commission);

  return {
    invoiceNumber,
    invoiceDate,
    periodStart: parseGermanDate(period[1]),
    periodEnd:   parseGermanDate(period[2]),
    restaurant,
    netSalesPreCommission,
    commission,
    netSalesPreAds,
    reportedEndbetrag,
    checkOk: Math.abs(netSalesPreAds - reportedEndbetrag) < 0.005,
  };
}
