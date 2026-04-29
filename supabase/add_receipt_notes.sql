-- Add notes column to store_delivery_receipts
-- Run this in Supabase SQL Editor

ALTER TABLE store_delivery_receipts
  ADD COLUMN IF NOT EXISTS notes text;
