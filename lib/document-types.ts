/**
 * What kind of document an emailed attachment is. Only BILL_TYPES become
 * bills; the rest are set aside on the Bills page under "Not imported".
 *
 * No imports: this is used by client pages as well as server code.
 */
export const BILL_TYPES = ['invoice', 'credit_note'] as const;

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  invoice:            'Invoice',
  credit_note:        'Credit note',
  delivery_note:      'Lieferschein',
  order_confirmation: 'Order confirmation',
  quote:              'Quote',
  reminder:           'Payment reminder',
  statement:          'Statement',
  other:              'Other',
};
