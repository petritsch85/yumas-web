-- Add driver tracking fields to delivery_runs
-- Run this in Supabase SQL Editor

ALTER TABLE delivery_runs
  ADD COLUMN IF NOT EXISTS delivery_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_finished_by uuid REFERENCES auth.users(id);
