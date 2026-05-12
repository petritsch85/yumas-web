-- Product-level sales data extracted from Orderbird shift CSV reports
-- Run once in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS shift_report_products (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_report_id uuid        NOT NULL REFERENCES shift_reports(id) ON DELETE CASCADE,
  product_name    text        NOT NULL,
  quantity        numeric     NOT NULL DEFAULT 0,
  gross_sales     numeric     NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS srp_shift_report_idx ON shift_report_products(shift_report_id);
CREATE INDEX IF NOT EXISTS srp_product_name_idx ON shift_report_products(product_name);

-- RLS: same pattern as shift_report_categories
ALTER TABLE shift_report_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read shift_report_products"
  ON shift_report_products FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert shift_report_products"
  ON shift_report_products FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can delete shift_report_products"
  ON shift_report_products FOR DELETE TO authenticated USING (true);
