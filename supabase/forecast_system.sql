-- store_day_standards: baseline €sales each day's targets are calibrated to
CREATE TABLE IF NOT EXISTS store_day_standards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_name text NOT NULL,
  day_of_week text NOT NULL CHECK (day_of_week IN ('mon','tue','wed','fri')),
  standard_sales_eur numeric NOT NULL,
  UNIQUE(location_name, day_of_week)
);

-- Pre-populate with the standard values
INSERT INTO store_day_standards (location_name, day_of_week, standard_sales_eur) VALUES
  ('Eschborn','mon',3000),('Eschborn','tue',5000),('Eschborn','wed',4000),('Eschborn','fri',2000),
  ('Taunus','mon',1500),('Taunus','tue',2500),('Taunus','wed',2500),('Taunus','fri',2500),
  ('Westend','mon',1500),('Westend','tue',2500),('Westend','wed',2500),('Westend','fri',2500)
ON CONFLICT (location_name, day_of_week) DO NOTHING;

-- weekly_sales_forecasts: editable per store per date
CREATE TABLE IF NOT EXISTS weekly_sales_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_name text NOT NULL,
  forecast_date date NOT NULL,
  forecasted_sales_eur numeric NOT NULL,
  is_locked boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(location_name, forecast_date)
);

-- Add scales_with_demand to delivery_targets
ALTER TABLE delivery_targets ADD COLUMN IF NOT EXISTS scales_with_demand boolean NOT NULL DEFAULT true;

-- RLS
ALTER TABLE store_day_standards ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_sales_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read standards" ON store_day_standards FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth update standards" ON store_day_standards FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth read forecasts" ON weekly_sales_forecasts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert forecasts" ON weekly_sales_forecasts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update forecasts" ON weekly_sales_forecasts FOR UPDATE TO authenticated USING (true);
