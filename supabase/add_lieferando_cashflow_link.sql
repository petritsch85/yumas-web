-- A Lieferando payout, like a Wolt one, has no incoming bill: the weekly
-- statement in Sales Reports is the evidence. The transaction points at the
-- week whose statement carried the Auszahlung; weeks with no payout of their
-- own roll into the next one and are read back from the chain of statements.
alter table public.cashflow_transactions
  add column if not exists lieferando_period_id uuid references public.lieferando_periods(id) on delete set null;

comment on column public.cashflow_transactions.lieferando_period_id is
  'The Lieferando week whose statement carried this payout. Earlier weeks without a payout of their own are covered by the same transfer.';

create index if not exists cashflow_transactions_lieferando_period_idx
  on public.cashflow_transactions (lieferando_period_id);
