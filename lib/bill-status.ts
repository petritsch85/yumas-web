/**
 * What each bill status is called on screen.
 *
 * The stored values stay as they are. 'approved' is what the UStVA and the
 * DATEV export read to decide whether a bill's input VAT may be claimed, so
 * renaming it in the database would mean touching both for no gain — only the
 * wording the user reads needs to change. These are the bills a supplier will
 * collect by direct debit, which is what "Upcoming SEPA" says and "Approved"
 * did not.
 *
 * No imports: this is used by client pages as well as server code.
 */
export type BillStatus = 'pending' | 'approved' | 'to_be_paid' | 'paid';

export const STATUS_LABELS: Record<string, string> = {
  pending:    'Pending',
  approved:   'Upcoming SEPA',
  to_be_paid: 'To Be Paid',
  paid:       'Paid',
};

/** The label for a status, falling back to the raw value for anything unknown. */
export const statusLabel = (status: string | null | undefined) =>
  STATUS_LABELS[status ?? ''] ?? (status ?? '—');
