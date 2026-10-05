/**
 * Filing a bill that arrived by email — shared by the inbound webhook and by
 * "Import anyway" on a document the webhook set aside as not a bill.
 */
import { getSupabaseAdmin } from './supabase-admin';
import { resolveDueDate, addDaysTo, DEFAULT_DAYS } from './payment-terms';
import { isRemitter } from './remitters';
import { BILL_TYPES } from './document-types';

/* What a document is decides whether it becomes a bill. The inbox also
   receives Lieferscheine, order confirmations and the like; filing those
   would put payables in the ledger that nobody owes.
   Whether an extraction describes a bill — a missing type is read as one, the old behaviour. */
export const isBillDocument = (extracted: Record<string, unknown>) => {
  const type = String(extracted.document_type ?? 'invoice').toLowerCase();
  return (BILL_TYPES as readonly string[]).includes(type);
};

/* A bill forwarded twice — or a batch delivered again — must not appear
   twice. Same supplier, same number, same amount is the same bill. */
export async function findDuplicate(extracted: Record<string, unknown>): Promise<string | null> {
  const invoiceNumber = extracted.invoice_number as string | null;
  if (!invoiceNumber) return null;
  const { data } = await getSupabaseAdmin()
    .from('bills')
    .select('id, supplier_name, gross_amount')
    .eq('invoice_number', invoiceNumber)
    .limit(10);
  const gross = Number(extracted.gross_amount ?? 0);
  const supplier = String(extracted.supplier_name ?? '').toLowerCase();
  const hit = (data ?? []).find(b =>
    Math.abs(Number(b.gross_amount) - gross) < 0.01 &&
    String(b.supplier_name ?? '').toLowerCase() === supplier);
  return hit?.id ?? null;
}

/**
 * Creates the bill for a document already in the 'bills' bucket at `path`.
 * Returns the new bill's id, or null when the document was filed without one.
 * `isNew` puts it in Newly Received rather than straight into Pending.
 */
export async function fileBill(
  path: string,
  extracted: Record<string, unknown>,
  { isNew }: { isNew: boolean },
): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const invoiceDate = (extracted.invoice_date as string | null) ?? null;

  /* Skonto: only accepted when the three printed figures agree with the gross.
     A settlement read off the wrong line would quietly break bank matching,
     which is the one thing this field exists to fix. */
  const grossAmount = Number(extracted.gross_amount ?? 0);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  let settlementAmount = num(extracted.settlement_amount);
  let discountAmount = num(extracted.discount_amount);
  if (settlementAmount !== null && grossAmount > 0) {
    if (discountAmount === null) discountAmount = Math.round((grossAmount - settlementAmount) * 100) / 100;
    const agrees = Math.abs(grossAmount - discountAmount - settlementAmount) <= 0.02;
    const sane = settlementAmount > 0 && settlementAmount <= grossAmount + 0.01 && settlementAmount >= grossAmount * 0.85;
    if (!agrees || !sane) {
      console.warn(`[inbound-bills] ${path}: ignoring implausible Skonto ${settlementAmount} against gross ${grossAmount}`);
      settlementAmount = null;
      discountAmount = null;
    }
  } else {
    settlementAmount = null;
    discountAmount = null;
  }

  /* Every bill gets a deadline. A printed date wins; then the condition the
     invoice states ("Zahlbar sofort" is a condition, not a date); then the day
     the Skonto line says the debit falls; and failing all of that a fortnight,
     which is the commercial norm and keeps the bill inside the next payment
     run. due_date_source records which, so a date worked out never passes for
     one the supplier printed. */
  const printedDue = (extracted.due_date as string | null) ?? null;
  const terms = (extracted.payment_method as string | null) ?? null;
  let dueDate = resolveDueDate({ invoiceDate, dueDate: printedDue, terms });
  let dueSource: string | null =
    printedDue ? 'printed' : dueDate ? 'stated-term' : null;
  if (!dueDate && settlementAmount !== null && extracted.settlement_date) {
    dueDate = extracted.settlement_date as string;
    dueSource = 'settlement';
  }
  if (!dueDate && invoiceDate) {
    dueDate = addDaysTo(invoiceDate, DEFAULT_DAYS);
    dueSource = 'default';
  }

  /* Some counterparties only ever pay us. Their remittance advice carries an
     amount, a date and a reference, so it extracts cleanly as an invoice and
     lands in the ledger as a payable nobody owes. The file is kept — it is
     still a document the Steuerberater needs — but no bill is created. */
  if (isRemitter(extracted.supplier_name as string | null)) {
    console.log(`[inbound-bills] ${extracted.supplier_name} remits to us — stored at ${path}, no payable created`);
    return null;
  }

  const row: Record<string, unknown> = {
    supplier_name:  extracted.supplier_name  ?? 'Unknown',
    invoice_number: extracted.invoice_number ?? null,
    invoice_date:   invoiceDate,
    due_date:       dueDate,
    net_amount:     extracted.net_amount     ?? 0,
    vat_amount:     extracted.vat_amount     ?? 0,
    gross_amount:   extracted.gross_amount   ?? 0,
    currency:       extracted.currency       ?? 'EUR',
    category:       extracted.suggested_category ?? null,
    payment_method: extracted.payment_method ?? null,
    status:         'pending',
    file_path:      path,
    uploaded_by:    null,
    location_id:    null,
    location_label: null,
    period_type:    'single_date',
    period_start:   invoiceDate,
    period_end:     invoiceDate,
  };

  /* The gross stays the invoice total; this is what the bank will show. The
     columns arrive with supabase/add_bill_settlement.sql and is_new with
     supabase/add_bill_inbox.sql — until those have been run, a bill is still
     worth filing without them. */
  const optionalCols: Record<string, unknown> = {
    due_date_source:   dueSource,
    settlement_amount: settlementAmount,
    settlement_date:   settlementAmount !== null ? ((extracted.settlement_date as string | null) ?? null) : null,
    discount_amount:   discountAmount,
    discount_percent:  settlementAmount !== null ? num(extracted.discount_percent) : null,
    is_new:            isNew,
  };
  let { data: bill, error: billErr } = await admin.from('bills')
    .insert({ ...row, ...optionalCols }).select('id').single();
  if (billErr && /due_date_source|settlement_amount|discount_amount|discount_percent|settlement_date|is_new/.test(billErr.message)) {
    console.warn(`[inbound-bills] optional bill columns missing (${billErr.message}) — filing without them`);
    ({ data: bill, error: billErr } = await admin.from('bills').insert(row).select('id').single());
  }
  if (billErr) throw billErr;
  if (!bill) throw new Error('Bill insert returned no row');

  const lines = extracted.lines as Record<string, unknown>[] | undefined;
  if (lines?.length) {
    await admin.from('bill_lines').insert(
      lines.map((l) => ({
        bill_id:     bill.id,
        description: l.description,
        quantity:    l.quantity,
        unit_price:  l.unit_price,
        vat_rate:    l.vat_rate,
        line_total:  l.line_total,
        category:    extracted.suggested_category ?? null,
      }))
    );
  }

  return bill.id as string;
}
