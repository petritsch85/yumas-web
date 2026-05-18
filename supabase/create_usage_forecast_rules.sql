-- Usage forecast rules: quantity per item per net-sales tier per shift type
CREATE TABLE IF NOT EXISTS usage_forecast_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_name text    NOT NULL,
  shift_type    text    NOT NULL,  -- 'lunch' | 'dinner'
  item_name     text    NOT NULL,
  net_sales_from numeric NOT NULL, -- inclusive lower bound
  net_sales_to   numeric NOT NULL, -- inclusive upper bound
  quantity       numeric NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_name, shift_type, item_name, net_sales_from, net_sales_to)
);

ALTER TABLE usage_forecast_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read usage_forecast_rules"
  ON usage_forecast_rules FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert usage_forecast_rules"
  ON usage_forecast_rules FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update usage_forecast_rules"
  ON usage_forecast_rules FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete usage_forecast_rules"
  ON usage_forecast_rules FOR DELETE
  TO authenticated
  USING (true);
