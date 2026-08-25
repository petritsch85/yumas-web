-- Store the full BillData payload used to render an outgoing bill's PDF.
-- Without this the PDF cannot be regenerated faithfully after the fact: the row
-- keeps only customer_name and a flattened customer_address, while the document
-- also carries the extra/contact address lines, intro text and any catering or
-- ad-hoc line items.
ALTER TABLE outgoing_bills
  ADD COLUMN IF NOT EXISTS bill_data jsonb;

COMMENT ON COLUMN outgoing_bills.bill_data IS
  'Full BillData JSON as rendered into the stored PDF. Present only for bills created after this column was added, plus any deliberately backfilled rows. NULL means the PDF cannot be regenerated.';
