-- Stores manual bookings and walk-in inputs per shift/date/location.
-- Walk-ins for past dates are auto-calculated in the UI (actual guests − bookings).
-- Walk-ins for future dates are manual inputs; Est. Guests = bookings + walk_ins.
-- Run once in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS shift_bookings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  booking_date date        NOT NULL,
  shift_type   text        NOT NULL CHECK (shift_type IN ('lunch', 'dinner')),
  bookings     integer     NOT NULL DEFAULT 0,
  walk_ins     integer     DEFAULT NULL,  -- NULL = auto-calculated for historic dates
  created_at   timestamptz DEFAULT now(),
  UNIQUE(location_id, booking_date, shift_type)
);

ALTER TABLE shift_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_rw_shift_bookings"
  ON shift_bookings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
