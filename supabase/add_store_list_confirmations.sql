-- Add per-store list confirmation columns and day lock to delivery_runs
ALTER TABLE delivery_runs
  ADD COLUMN IF NOT EXISTS list_confirmed_eschborn_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS list_confirmed_taunus_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS list_confirmed_westend_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS day_locked_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS day_locked_by              UUID REFERENCES auth.users(id);
