-- Snapshot of inventory state captured when driver hits "Finish Delivery"
-- Run this in Supabase SQL Editor

ALTER TABLE delivery_runs
  ADD COLUMN IF NOT EXISTS delivery_snapshot jsonb;
