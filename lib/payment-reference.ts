/**
 * Reading the invoice numbers a supplier quotes in its payment reference.
 *
 * A supplier collecting a fortnight of deliveries by direct debit writes every
 * invoice number into the Verwendungszweck:
 *
 *   "Rechnungsnummern 149592+149671+149734+149733+149767+... DATUM 17.08.2026"
 *
 * That is a better key than any amount. It says which invoices the payment
 * covers, in the supplier's own words, and it works where amount matching
 * cannot: one debit against sixteen bills has no single amount to match.
 *
 * It also reads the other way. Numbers quoted that we hold no invoice for are
 * invoices that never reached us — the bank becomes a completeness check on
 * the inbox, which is how sixteen missing Fruveg invoices went unnoticed for
 * a month.
 */

/** Words that carry digits but never an invoice number. */
const NOISE = /\b(?:datum|uhr|ref)\b/gi;

/**
 * A number introduced as something other than an invoice.
 *
 * "Kd.1059374738", "KndNr: 16137", "Auftragsbestätigung Nr. 167021" — a
 * customer number, an order confirmation, a contract or a mandate all look
 * exactly like an invoice number once the words around them are dropped, and
 * a ten-digit customer number will happily "contradict" a ten-digit invoice.
 * So the label is stripped together with the number it introduces, rather
 * than the label alone.
 */
const LABELLED_NON_INVOICE =
  /\b(?:kd|knd|kunden?|kundennummer|auftrag|auftrags?best(?:ä|ae)tigung|order|vertrag|mandat|gl(?:ä|ae)ubiger|iban|bic|ust|steuer)\.?(?:\s*-?\s*(?:nr|nummer|id)\.?)?\s*[:#-]?\s*[A-Za-z]{0,3}[-/]?\d{4,12}/gi;

/**
 * Every token in a reference that could be an invoice number.
 *
 * Deliberately loose — a candidate costs nothing, since it is only ever used
 * to look up a bill that must also belong to the same supplier. Dates and
 * times are stripped first so "17.08.2026, 18.32 UHR" contributes nothing.
 */
export function referenceTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const cleaned = (text ?? '')
    // Dates in any common shape, and the time that follows them.
    .replace(/\b\d{1,2}[.\/-]\s?\d{1,2}[.\/-]\s?\d{2,4}\b/g, ' ')
    .replace(/\b\d{1,2}[.:]\d{2}\s*uhr\b/gi, ' ')
    // Labelled non-invoice numbers go before the bare-word noise, so the
    // label is still there to identify them.
    .replace(LABELLED_NON_INVOICE, ' ')
    .replace(NOISE, ' ');
  const out = new Set<string>();
  for (const m of cleaned.matchAll(/[A-Za-z]{0,3}[-\/]?\d{4,12}(?:[-\/]\d{1,4})?/g)) {
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 4 || digits.length > 12) continue;
    out.add(raw.toUpperCase());
    out.add(digits);
  }
  return [...out];
}

/** How an invoice number is compared: case and punctuation do not count. */
export const normaliseRef = (raw: string | null | undefined) =>
  (raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

export interface RefBill {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  gross_amount: number;
  supplier_name: string;
}

/** An invoice the reference names that we hold, but another payment already claims. */
export interface TakenBill {
  invoiceNumber: string | null;
  gross: number;
  /** The payment holding it, so the wrong link can be found and undone. */
  heldBy: { date: string; description: string | null } | null;
}

export interface ReferenceMatch {
  bills: RefBill[];
  /** Numbers the reference quotes that no bill in the system carries. */
  missing: string[];
  /**
   * Numbers the reference quotes that we do hold, but that are linked to some
   * other payment. Almost always the other link is the wrong one: the bank
   * naming an invoice is better evidence than an amount that happened to
   * agree. Reporting these apart from `missing` is what stops "ask the
   * supplier to resend" being said about an invoice already in the building.
   */
  taken: TakenBill[];
  /** What the found bills add up to. */
  sum: number;
  /** The transaction's own amount, for the comparison. */
  amount: number;
  /** True when the found bills account for the payment to the cent. */
  complete: boolean;
}

/**
 * Matches a payment to the bills its reference names.
 *
 * Only bills of the same supplier are considered, and only ones nothing else
 * has claimed: a reference number is a strong signal but a short one, and
 * "150465" would otherwise match a stray figure in another supplier's text.
 *
 * A single matched number is accepted only when it accounts for the whole
 * payment. Two or more together are accepted regardless — a supplier quoting
 * several of its own invoice numbers is not a coincidence, and the gap is
 * worth reporting precisely because it is a gap.
 */
export function matchByReference(
  tx: { description: string | null; counterparty: string | null; amount_cents: number },
  candidateBills: RefBill[],
  /** Bills of the same supplier that another payment already holds. */
  claimedBills: (RefBill & { heldBy?: { date: string; description: string | null } | null })[] = [],
): ReferenceMatch | null {
  const tokens = referenceTokens(`${tx.description ?? ''} ${tx.counterparty ?? ''}`);
  if (tokens.length === 0) return null;

  const wanted = new Set(tokens.map(normaliseRef).filter(t => t.length >= 4));
  const byRef = new Map<string, RefBill>();
  for (const b of candidateBills) {
    const key = normaliseRef(b.invoice_number);
    if (key.length >= 4) byRef.set(key, b);
  }
  const byRefClaimed = new Map<string, (typeof claimedBills)[number]>();
  for (const b of claimedBills) {
    const key = normaliseRef(b.invoice_number);
    if (key.length >= 4) byRefClaimed.set(key, b);
  }

  const bills: RefBill[] = [];
  const missing: string[] = [];
  const taken: TakenBill[] = [];
  const seen = new Set<string>();
  for (const t of wanted) {
    if (seen.has(t)) continue;
    seen.add(t);
    const hit = byRef.get(t);
    if (hit) { if (!bills.includes(hit)) bills.push(hit); continue; }
    const held = byRefClaimed.get(t);
    if (held) taken.push({ invoiceNumber: held.invoice_number, gross: Number(held.gross_amount), heldBy: held.heldBy ?? null });
    else missing.push(t);
  }
  if (bills.length === 0) return null;

  const amount = Math.abs(tx.amount_cents) / 100;
  const sum = Math.round(bills.reduce((t, b) => t + Number(b.gross_amount), 0) * 100) / 100;
  const complete = Math.abs(sum - amount) < 0.01;

  // One number alone is only convincing when it explains the whole payment.
  if (bills.length === 1 && !complete) return null;

  /* Numbers that look nothing like this supplier's are not missing invoices,
     they are noise in the reference. Only report gaps that share the shape of
     the numbers that did match. */
  const shapes = new Set(bills.map(b => normaliseRef(b.invoice_number).length));
  return {
    bills, sum, amount, complete, taken,
    missing: missing.filter(m => shapes.has(m.length)),
  };
}
