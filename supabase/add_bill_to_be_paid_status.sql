-- Adds the 'to_be_paid' bill status (between Approved and Paid).
-- Run in Supabase SQL Editor. Safe whether or not a status check existed before.

ALTER TABLE bills DROP CONSTRAINT IF EXISTS bills_status_check;

ALTER TABLE bills
  ADD CONSTRAINT bills_status_check
  CHECK (status IN ('pending', 'approved', 'to_be_paid', 'paid'));
