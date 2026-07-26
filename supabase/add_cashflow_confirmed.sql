-- Add confirmed flag to cashflow_transactions
ALTER TABLE cashflow_transactions
  ADD COLUMN IF NOT EXISTS confirmed BOOLEAN NOT NULL DEFAULT FALSE;
