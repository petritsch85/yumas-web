CREATE TABLE IF NOT EXISTS outgoing_bills (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz DEFAULT now(),
  invoice_number   text,
  invoice_date     date,
  event_date       date,
  customer_name    text NOT NULL,
  customer_address text,
  issuing_location text,        -- which Yumas branch issued the invoice
  net_food         numeric DEFAULT 0,
  net_drinks       numeric DEFAULT 0,
  net_total        numeric DEFAULT 0,
  vat_7            numeric DEFAULT 0,
  vat_19           numeric DEFAULT 0,
  gross_total      numeric DEFAULT 0,
  tips             numeric DEFAULT 0,
  total_payable    numeric DEFAULT 0,
  status           text DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  file_path        text,
  uploaded_by      uuid REFERENCES auth.users(id),
  notes            text
);

-- RLS
ALTER TABLE outgoing_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage outgoing_bills"
  ON outgoing_bills FOR ALL TO authenticated USING (true) WITH CHECK (true);
