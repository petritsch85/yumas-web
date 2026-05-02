-- Add shift_type column to delivery_reports
ALTER TABLE delivery_reports
  ADD COLUMN IF NOT EXISTS shift_type text
  CHECK (shift_type IN ('lunch', 'dinner'));

-- Drop old unique constraint (date-only)
ALTER TABLE delivery_reports
  DROP CONSTRAINT IF EXISTS delivery_reports_location_id_report_date_key;

-- New unique constraint: date + shift (allows one lunch and one dinner per day)
ALTER TABLE delivery_reports
  DROP CONSTRAINT IF EXISTS delivery_reports_location_id_report_date_shift_type_key;

ALTER TABLE delivery_reports
  ADD CONSTRAINT delivery_reports_location_id_report_date_shift_type_key
  UNIQUE (location_id, report_date, shift_type);
