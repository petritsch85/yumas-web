-- Add 'pending_approval' to the purchase_orders status check constraint
-- Run in Supabase SQL Editor

ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN (
    'draft',
    'pending_approval',
    'approved',
    'sent',
    'confirmed',
    'partial',
    'received',
    'cancelled'
  ));
