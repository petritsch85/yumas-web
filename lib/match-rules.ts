/**
 * When a payment may be tied to a bill on the strength of its amount alone.
 *
 * An amount is a weak key. A wine merchant delivering the same case every
 * fortnight invoices 317,73 € six times a year; a phone bill is 34,99 € every
 * month. Matching on the amount alone picks whichever of those happens to be
 * unclaimed, and it picks wrong often enough to matter: it is how a payment of
 * 02.02. that plainly says "RE 65221" ended up holding invoice 65794, which was
 * not written until 04.03.
 *
 * Two facts the bank gives us are far stronger than the amount, and both are
 * used here as vetoes rather than as evidence — they cannot create a match,
 * only forbid one:
 *
 *   1. the invoice number in the reference. If the bank names an invoice, a
 *      bill carrying a different number is not that payment, whatever it costs.
 *   2. the direction of time. An invoice written after the money left cannot be
 *      what that money paid.
 *
 * The same two rules read backwards find links already in the database that
 * should never have been made, which is what `linkObjection` is for.
 */

import { referenceTokens, normaliseRef } from './payment-reference';

/**
 * An invoice may be dated a little after the payment and still be that
 * payment's: FERRAND is paid against an Auftragsbestätigung and invoices four
 * or five days later, and the same holds wherever an order is settled up
 * front. A week covers every such case in this book. Past that the two really
 * are different documents — the wrong links found here sat 24 and 25 days out.
 */
export const LEAD_DAYS = 7;

const dayDiff = (a: string, b: string) =>
  (new Date(a).getTime() - new Date(b).getTime()) / 86400000;

/** An invoice dated more than LEAD_DAYS after the money left is not this payment's. */
export function postdatesPayment(invoiceDate: string | null, txDate: string): boolean {
  if (!invoiceDate) return false;
  return dayDiff(invoiceDate, txDate) > LEAD_DAYS;
}

/**
 * Does the bank's reference name an invoice that this bill is not?
 *
 * Only numbers shaped like this bill's own number are weighed. A supplier's
 * invoice numbers have a house format — five digits, or "RE" and seven — and a
 * customer number, a contract number or a mandate reference in the same text
 * is not a rival invoice number. Comparing only same-length numbers is what
 * keeps this from vetoing every payment that happens to quote a Kundennummer.
 *
 * Returns the number the bank named, or null when there is no contradiction.
 */
export function contradictingNumber(text: string, invoiceNumber: string | null): string | null {
  const mine = normaliseRef(invoiceNumber);
  if (mine.length < 4) return null;

  const digitsOf = (s: string) => s.replace(/\D/g, '');
  const myDigits = digitsOf(mine);

  for (const raw of referenceTokens(text)) {
    const t = normaliseRef(raw);
    if (t === mine) return null;                      // the bank names this very bill
    if (digitsOf(t) === myDigits) return null;        // same number, written differently
  }

  /* Nothing matched. Now: did the bank name anything that could have been an
     invoice of this supplier — a number of the same length as this one? */
  for (const raw of referenceTokens(text)) {
    const t = normaliseRef(raw);
    if (digitsOf(t).length === myDigits.length) return raw;
  }
  return null;
}

export interface Objection {
  /** Short machine-readable reason, for grouping. */
  code: 'names-another-invoice' | 'invoice-postdates-payment';
  /** One sentence a person can act on. */
  reason: string;
}

/**
 * Why this bill should not be tied to this payment — or null when nothing
 * objects. Used both to stop a bad link being made and to find bad links
 * already in the database.
 */
export function linkObjection(
  tx: { date: string; description: string | null; counterparty: string | null },
  bill: { invoice_number: string | null; invoice_date: string | null },
): Objection | null {
  const text = `${tx.description ?? ''} ${tx.counterparty ?? ''}`;

  const named = contradictingNumber(text, bill.invoice_number);
  if (named) {
    return {
      code: 'names-another-invoice',
      reason: `The bank names invoice ${named}, but this bill is ${bill.invoice_number}.`,
    };
  }

  if (postdatesPayment(bill.invoice_date, tx.date)) {
    const days = Math.round(dayDiff(bill.invoice_date!, tx.date));
    return {
      code: 'invoice-postdates-payment',
      reason: `The invoice is dated ${days} day${days === 1 ? '' : 's'} after the payment, so it cannot be what was paid.`,
    };
  }

  return null;
}
