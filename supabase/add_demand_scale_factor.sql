-- Add demand_scale_factor to delivery_targets
-- 1.0 = fully proportional to forecast (default)
-- 0.5 = half the swing (if demand is +100%, target goes up +50%)
-- 0.0 = same as scales_with_demand = false (fixed quantity)
-- Run this in Supabase SQL Editor

ALTER TABLE delivery_targets
  ADD COLUMN IF NOT EXISTS demand_scale_factor numeric DEFAULT 1.0;

-- Backfill existing rows
UPDATE delivery_targets
SET demand_scale_factor = 1.0
WHERE demand_scale_factor IS NULL;
