-- A category a person chose for one row, as against the one its counterparty
-- gives it. Nexi's daily transfers are in-house card takings; the monthly fee
-- debit is a cost, and that correction has to survive the next upload.
alter table public.cashflow_transactions
  add column if not exists category_manual boolean not null default false;

comment on column public.cashflow_transactions.category_manual is
  'True when a person set this row''s category, so the counterparty''s category no longer overrides it.';
