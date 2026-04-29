-- Store delivery receipt confirmations
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS store_delivery_receipts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                uuid NOT NULL REFERENCES delivery_runs(id) ON DELETE CASCADE,
  location_name         text NOT NULL,
  received_at           timestamptz NOT NULL DEFAULT now(),
  received_by           uuid REFERENCES auth.users(id),
  notes                 text,
  items_confirmed_count int,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, location_name)
);

-- RLS: allow authenticated users to read/insert/update
ALTER TABLE store_delivery_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_receipts_select" ON store_delivery_receipts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "store_receipts_insert" ON store_delivery_receipts
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "store_receipts_update" ON store_delivery_receipts
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
