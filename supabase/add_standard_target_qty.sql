-- Add standard_target_qty column to delivery_run_lines
-- Run this in Supabase SQL Editor

ALTER TABLE delivery_run_lines
  ADD COLUMN IF NOT EXISTS standard_target_qty numeric DEFAULT 0;
