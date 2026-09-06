-- Service fee that passes straight through us (Wolt's self-delivery contract).
--
-- On that contract the customer pays a service fee on top of the food, and Wolt
-- invoices the identical net amount straight back. It is not our revenue, Wolt
-- charges no commission on it, and it changes no margin — so it is kept out of
-- every reported line.
--
-- It is stored anyway because it is NOT neutral for VAT: we collect it at 7%
-- and are charged it back at 19%, so each period carries a small input-tax
-- benefit that the P&L never shows.

alter table public.wolt_periods
  add column if not exists service_fee_pass_through numeric(12,2) not null default 0;
