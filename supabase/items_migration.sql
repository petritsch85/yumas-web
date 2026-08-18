-- Run this in the Supabase SQL Editor.
-- Creates the purchased_goods table (separate from the existing 'items' product catalogue).

CREATE TABLE IF NOT EXISTS purchased_goods (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name                  text NOT NULL,
  keywords              text[]  NOT NULL DEFAULT '{}',
  primary_supplier_id   uuid    REFERENCES counterparties(id) ON DELETE SET NULL,
  secondary_supplier_ids uuid[] NOT NULL DEFAULT '{}',
  kg_per_unit           numeric,
  created_at            timestamptz NOT NULL DEFAULT now()
);
