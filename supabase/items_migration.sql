CREATE TABLE IF NOT EXISTS items (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name                  text NOT NULL,
  keywords              text[]  NOT NULL DEFAULT '{}',
  primary_supplier_id   uuid    REFERENCES counterparties(id) ON DELETE SET NULL,
  secondary_supplier_ids uuid[] NOT NULL DEFAULT '{}',
  kg_per_unit           numeric,          -- how many kg or L in one purchased unit; NULL = 1:1
  created_at            timestamptz NOT NULL DEFAULT now()
);
