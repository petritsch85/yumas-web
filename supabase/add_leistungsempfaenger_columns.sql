-- Add Leistungsempfänger address columns to customers table
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS leist_street   TEXT,
  ADD COLUMN IF NOT EXISTS leist_postcode TEXT,
  ADD COLUMN IF NOT EXISTS leist_city     TEXT;
