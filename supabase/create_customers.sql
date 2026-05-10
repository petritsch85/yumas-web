-- CRM: saved customers for the Outgoing Bills "Create Bill" form
-- Run once in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS customers (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text        NOT NULL UNIQUE,
  extra_line   text,
  contact_name text,
  street       text,
  postcode     text,
  city         text,
  po_number    text,
  att          text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- Index for fast case-insensitive name search
CREATE INDEX IF NOT EXISTS customers_company_name_idx ON customers USING gin (company_name gin_trgm_ops);

-- Enable pg_trgm extension if not already active (needed for the gin index above)
-- Run this first if the index creation fails:
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
