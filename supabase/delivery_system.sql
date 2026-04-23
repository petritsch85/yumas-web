-- ============================================================
-- Delivery System Tables
-- ============================================================

-- 1. delivery_targets: target stock levels per store per day
CREATE TABLE IF NOT EXISTS delivery_targets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_name text    NOT NULL,
  section       text    NOT NULL,
  item_name     text    NOT NULL,
  unit          text    NOT NULL DEFAULT '',
  mon_target    numeric NOT NULL DEFAULT 0,
  tue_target    numeric NOT NULL DEFAULT 0,
  wed_target    numeric NOT NULL DEFAULT 0,
  fri_target    numeric NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_name, item_name)
);

-- 2. delivery_runs: one row per delivery date
CREATE TABLE IF NOT EXISTS delivery_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_date date NOT NULL UNIQUE,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'ready', 'in_progress', 'completed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 3. delivery_run_lines: one row per (run, location, item)
CREATE TABLE IF NOT EXISTS delivery_run_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES delivery_runs(id) ON DELETE CASCADE,
  location_name text    NOT NULL,
  section       text    NOT NULL,
  item_name     text    NOT NULL,
  unit          text    NOT NULL DEFAULT '',
  target_qty    numeric NOT NULL DEFAULT 0,
  reported_qty  numeric NOT NULL DEFAULT 0,
  delivery_qty  numeric NOT NULL DEFAULT 0,
  is_packed     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE delivery_targets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_run_lines  ENABLE ROW LEVEL SECURITY;

-- delivery_targets policies
CREATE POLICY "Authenticated users can read delivery_targets"
  ON delivery_targets FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert delivery_targets"
  ON delivery_targets FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update delivery_targets"
  ON delivery_targets FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete delivery_targets"
  ON delivery_targets FOR DELETE
  TO authenticated USING (true);

-- delivery_runs policies
CREATE POLICY "Authenticated users can read delivery_runs"
  ON delivery_runs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert delivery_runs"
  ON delivery_runs FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update delivery_runs"
  ON delivery_runs FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete delivery_runs"
  ON delivery_runs FOR DELETE
  TO authenticated USING (true);

-- delivery_run_lines policies
CREATE POLICY "Authenticated users can read delivery_run_lines"
  ON delivery_run_lines FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert delivery_run_lines"
  ON delivery_run_lines FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update delivery_run_lines"
  ON delivery_run_lines FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete delivery_run_lines"
  ON delivery_run_lines FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_delivery_targets_location
  ON delivery_targets (location_name);

CREATE INDEX IF NOT EXISTS idx_delivery_run_lines_run_id
  ON delivery_run_lines (run_id);

CREATE INDEX IF NOT EXISTS idx_delivery_run_lines_location
  ON delivery_run_lines (run_id, location_name);
