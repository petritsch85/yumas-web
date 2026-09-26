-- Skonto: what the supplier actually collects, as printed on the invoice.
--
-- Bier-Zentrale Leleithner ends every invoice with
--   "Der Rechnungsbetrag wird am 02.10.26 per Lastschrift abzüglich
--    2.00 % / 14.46 EUR Skonto = 756.24 EUR abgebucht"
-- and that 756,24 € is what appears on the bank statement, never the 770,70 €
-- gross. The discount is not 2% of the gross — Pfand and Leergut are outside
-- the skontierfähiger Betrag, so the effective rate runs anywhere from 1,88%
-- to 2,59% — which is why the figure has to be read off the invoice rather
-- than calculated.
--
-- gross_amount stays the invoice total: it is what the supplier billed, what
-- the VAT was charged on, and what the Steuerberater posts. settlement_amount
-- sits beside it as the figure the bank will show.

alter table bills add column if not exists settlement_amount numeric;
alter table bills add column if not exists settlement_date   date;
alter table bills add column if not exists discount_amount   numeric;
alter table bills add column if not exists discount_percent  numeric;

comment on column bills.settlement_amount is
  'What the supplier actually collects after Skonto, as printed on the invoice. Null when the invoice states no discount.';
comment on column bills.settlement_date is
  'The date the invoice says the direct debit will be taken.';
comment on column bills.discount_amount is
  'The Skonto in euros, as printed. gross_amount - discount_amount = settlement_amount.';
comment on column bills.discount_percent is
  'The Skonto rate as printed (e.g. 2.00). Not the rate against gross_amount.';
