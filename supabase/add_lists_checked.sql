-- Manager confirmation that the suggested packing list has been reviewed
-- Run this in Supabase SQL Editor

ALTER TABLE delivery_runs
  ADD COLUMN IF NOT EXISTS lists_checked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS lists_checked_by  uuid REFERENCES auth.users(id);
