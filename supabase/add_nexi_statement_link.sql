-- The Nexi fees are collected by direct debit a day or two after the
-- statement, so that debit points at the statement rather than at any one
-- transfer. Part of create_nexi.sql; kept separately for accounts that
-- already ran that script.
alter table public.cashflow_transactions
  add column if not exists nexi_statement_id uuid references public.nexi_statements(id) on delete set null;

create index if not exists cashflow_transactions_nexi_statement_idx
  on public.cashflow_transactions (nexi_statement_id);
