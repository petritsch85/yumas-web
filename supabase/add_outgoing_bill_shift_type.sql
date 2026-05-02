-- Add shift_type to outgoing_bills
ALTER TABLE outgoing_bills
  ADD COLUMN IF NOT EXISTS shift_type text CHECK (shift_type IN ('lunch', 'dinner'));
