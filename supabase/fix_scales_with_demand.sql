-- Fix all existing delivery_targets rows to scale with demand
-- Run this in Supabase SQL Editor

UPDATE delivery_targets
SET scales_with_demand = true
WHERE scales_with_demand IS FALSE OR scales_with_demand IS NULL;

-- Also update the column default so future inserts default to true
ALTER TABLE delivery_targets
  ALTER COLUMN scales_with_demand SET DEFAULT true;
