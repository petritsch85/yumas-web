/**
 * Deposit invoices that a final invoice has already accounted for.
 *
 * An event is often billed twice: an Anzahlungsrechnung weeks ahead, and the
 * final invoice after the night, which carries the whole event and deducts the
 * deposit only from what is left to pay. Counted as sales, the two together
 * say the evening took the deposit twice — Heraeus, 12.11.2026: 750,00 € on
 * 139-26 plus 5.147,73 € on 167-26, against a real 5.147,73 €.
 *
 * So once a final invoice names its deposit, the deposit invoice drops out of
 * sales. Until then it counts, on the event date, as the only record of the
 * event there is.
 */

/** The columns the rule needs, read from bill_data without fetching all of it. */
export const DEPOSIT_COLUMNS =
  'id,invoice_number,customer_name,event_date,net_total,depRef:bill_data->>anzahlungRef,depNet:bill_data->>anzahlungNetto';

export type DepositRow = {
  id: string;
  invoice_number?: string | null;
  customer_name?: string | null;
  event_date?: string | null;
  net_total?: number | null;
  depRef?: string | null;
  depNet?: string | number | null;
};

const fold = (s: string | null | undefined) => String(s ?? '').toLowerCase()
  .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');

/** Ids of deposit invoices to leave out of sales, because a final invoice includes them. */
export function supersededDeposits(rows: DepositRow[]): Set<string> {
  const out = new Set<string>();
  for (const f of rows) {
    const depNet = Number(f.depNet ?? 0);
    if (!(depNet > 0)) continue;
    /* The deposit the final invoice names by number; failing that, the one
       for the same customer and evening at the deducted net. */
    const byRef = f.depRef ? rows.find(d => d.id !== f.id && d.invoice_number === f.depRef) : undefined;
    const byMatch = byRef ?? rows.find(d =>
      d.id !== f.id && !out.has(d.id) &&
      d.event_date === f.event_date && fold(d.customer_name) === fold(f.customer_name) &&
      Math.abs(Number(d.net_total ?? 0) - depNet) < 0.02);
    if (byMatch) out.add(byMatch.id);
  }
  return out;
}
