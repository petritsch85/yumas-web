-- Cash Flow tables
-- Run this in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS cashflow_uploads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename       text NOT NULL,
  period_label   text NOT NULL,
  uploaded_at    timestamptz DEFAULT now(),
  transaction_count integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cashflow_transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id    uuid REFERENCES cashflow_uploads(id) ON DELETE CASCADE,
  date         date NOT NULL,
  description  text,
  counterparty text,
  amount_cents integer NOT NULL,          -- always positive
  direction    text NOT NULL CHECK (direction IN ('in','out')),
  category     text NOT NULL DEFAULT 'Other',   -- outgoing cost bucket
  location     text NOT NULL DEFAULT 'Other',   -- internal allocation
  sales_type   text NOT NULL DEFAULT 'Other',   -- incoming revenue type
  notes        text NOT NULL DEFAULT '',
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE cashflow_uploads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashflow_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access cashflow_uploads" ON cashflow_uploads
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin full access cashflow_transactions" ON cashflow_transactions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
