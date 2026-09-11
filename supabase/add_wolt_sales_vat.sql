-- The VAT on our own sales in a Wolt settlement period.
--
-- A Wolt payout nets three things into one transfer: our sales including
-- VAT, Wolt's fees including their VAT, and any Wolt Capital repayment with
-- none. The cash-flow ledger books the payout as the sales it settles, so it
-- needs the VAT on those sales specifically - not a rate guessed from the
-- category, and not the blend embedded in the transfer.
--
-- Self-billing contract: printed on the netting report against our invoice.
-- Self-delivery contract: our sales gross minus net, from the payout report.
--
-- Run once in the Supabase SQL Editor.

alter table public.wolt_periods
  add column if not exists sales_vat numeric(12,2);

comment on column public.wolt_periods.sales_vat is
  'VAT on our net sales for the period, as the settlement documents state it.';
