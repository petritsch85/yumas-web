-- Gmail auto-import: "Newly Received" bills and documents set aside as not a bill.
-- Run in Supabase SQL Editor. Safe to run more than once.

-- A bill that arrived by email sits in Newly Received until it is moved to Pending.
-- Its status is 'pending' throughout, so DATEV, VAT and cash flow matching see it at once.
ALTER TABLE bills ADD COLUMN IF NOT EXISTS is_new boolean NOT NULL DEFAULT false;

-- Lieferscheine, order confirmations etc. that arrived with the bills.
CREATE TABLE IF NOT EXISTS inbound_skipped (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at    timestamptz NOT NULL DEFAULT now(),
  file_name      text,
  file_path      text NOT NULL,
  document_type  text,
  supplier_name  text,
  gross_amount   numeric,
  email_from     text,
  email_subject  text,
  extracted      jsonb,
  status         text NOT NULL DEFAULT 'skipped' CHECK (status IN ('skipped', 'imported', 'dismissed')),
  bill_id        uuid REFERENCES bills(id) ON DELETE SET NULL
);

ALTER TABLE inbound_skipped ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can read inbound_skipped" ON inbound_skipped;
CREATE POLICY "Auth users can read inbound_skipped"
  ON inbound_skipped FOR SELECT TO authenticated USING (true);
