/**
 * Does a bundle of bills actually account for the payment it is linked to?
 *
 * A collected payment (Fruveg, Metro, …) is linked to the invoices named in the
 * bank's own reference. Often some of those invoices were never ingested, so the
 * link is real but *partial*: the bills we hold are genuinely part of that
 * payment, yet the payment as a whole is not fully evidenced. Those two facts
 * must be shown differently — a green tick means "this cash flow is settled and
 * documented", and it must not appear while invoices are still missing.
 */

export interface CoverageLink {
  bill?: { gross_amount?: number | null } | null;
}

export interface Coverage {
  /** How many links carry a bill we hold. */
  count: number;
  /** Gross sum of those bills, in euros. */
  sum: number;
  /** The payment itself, in euros, always positive. */
  amount: number;
  /** amount − sum: what the linked bills do not explain. Positive = still missing. */
  shortfall: number;
  /** Every cent of the payment is covered by a bill we hold. */
  complete: boolean;
  /** False when a bill's gross is not loaded, so completeness cannot be judged. */
  known: boolean;
}

/** One cent of slack — gross amounts are rounded, sums of many bills drift. */
const TOLERANCE = 0.01;

export function linkCoverage(amountCents: number, links: CoverageLink[] | null | undefined): Coverage {
  const withBill = (links ?? []).filter(l => !!l?.bill);
  const amount = Math.abs(amountCents) / 100;
  const known = withBill.length > 0 && withBill.every(l => typeof l.bill!.gross_amount === 'number');
  const sum = withBill.reduce((s, l) => s + (l.bill!.gross_amount ?? 0), 0);
  const shortfall = amount - sum;
  return {
    count: withBill.length,
    sum,
    amount,
    shortfall,
    complete: known && Math.abs(shortfall) < TOLERANCE,
    known,
  };
}

/** "17 bills · 63,93 € missing" — what the pill says when the link is short. */
export function coverageLabel(c: Coverage): string {
  const bills = `${c.count} bill${c.count !== 1 ? 's' : ''}`;
  if (!c.known || c.complete) return bills;
  const gap = Math.abs(c.shortfall).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${bills} · ${c.shortfall > 0 ? '' : '+'}${gap} €`;
}

/** The tooltip explaining why the link is not a full match. */
export function coverageTitle(c: Coverage, notes: (string | null)[] = []): string {
  const eur = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const lines: string[] = [];
  if (!c.known) {
    lines.push('Linked bills — amounts not loaded, so the payment cannot be reconciled here.');
  } else if (c.complete) {
    lines.push(`Fully documented: ${eur(c.sum)} of ${eur(c.amount)}.`);
  } else if (c.shortfall > 0) {
    lines.push(`Only ${eur(c.sum)} of ${eur(c.amount)} is documented — ${eur(c.shortfall)} of invoices is still missing.`);
    lines.push('The bills below are genuinely part of this payment, but the payment is not a complete match yet.');
  } else {
    lines.push(`The linked bills add up to ${eur(c.sum)}, more than the ${eur(c.amount)} paid — check for a duplicate or a credit note.`);
  }
  for (const n of notes) if (n) lines.push(n);
  return lines.join('\n');
}
