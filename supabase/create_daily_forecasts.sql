-- Per-day forecast inputs: est_guests × spend_per_guest = net sales forecast per shift.
-- Run once in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS daily_forecasts (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     uuid         NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  forecast_date   date         NOT NULL,
  shift_type      text         NOT NULL CHECK (shift_type IN ('lunch', 'dinner')),
  est_guests      integer      DEFAULT NULL,
  spend_per_guest numeric(8,2) DEFAULT NULL,
  created_at      timestamptz  DEFAULT now(),
  updated_at      timestamptz  DEFAULT now(),
  UNIQUE(location_id, forecast_date, shift_type)
);

ALTER TABLE daily_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_rw_daily_forecasts"
  ON daily_forecasts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Add default spend per guest to the existing forecast_settings table
ALTER TABLE forecast_settings
  ADD COLUMN IF NOT EXISTS default_spend_per_guest numeric(8,2) DEFAULT NULL;

-- Add per-day-of-week default guest counts to forecast_settings
ALTER TABLE forecast_settings ADD COLUMN IF NOT EXISTS guests_mon integer DEFAULT NULL;
ALTER TABLE forecast_settings ADD COLUMN IF NOT EXISTS guests_tue integer DEFAULT NULL;
ALTER TABLE forecast_settings ADD COLUMN IF NOT EXISTS guests_wed integer DEFAULT NULL;
ALTER TABLE forecast_settings ADD COLUMN IF NOT EXISTS guests_thu integer DEFAULT NULL;
ALTER TABLE forecast_settings ADD COLUMN IF NOT EXISTS guests_fri integer DEFAULT NULL;
ALTER TABLE forecast_settings ADD COLUMN IF NOT EXISTS guests_sat integer DEFAULT NULL;
ALTER TABLE forecast_settings ADD COLUMN IF NOT EXISTS guests_sun integer DEFAULT NULL;
