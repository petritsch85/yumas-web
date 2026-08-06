-- Counterparties: named entities matched against raw bank counterparty strings
CREATE TABLE IF NOT EXISTS counterparties (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  category          text,
  default_vat_rate  integer,
  notes             text,
  keywords          text[]      DEFAULT '{}',
  created_at        timestamptz DEFAULT now()
);

-- Manual override: lets user pin a specific counterparty to a transaction
ALTER TABLE cashflow_transactions
  ADD COLUMN IF NOT EXISTS counterparty_id uuid REFERENCES counterparties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cashflow_transactions_counterparty_id_idx
  ON cashflow_transactions(counterparty_id);
