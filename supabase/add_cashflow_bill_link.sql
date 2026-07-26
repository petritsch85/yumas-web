-- Add bill link column to cashflow_transactions
ALTER TABLE cashflow_transactions
  ADD COLUMN IF NOT EXISTS bill_id UUID REFERENCES bills(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cashflow_transactions_bill_id
  ON cashflow_transactions(bill_id);
