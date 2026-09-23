-- Nexi monthly settlements — the card acquirer.
--
-- Nexi bundles a day's card payments into one transfer, so the bank shows a
-- stream of credits with no invoice behind any of them. The monthly statement
-- is the evidence: it lists every transfer with its Zahlungsnummer, and closes
-- with the transaction fees, collected separately by direct debit.

create table if not exists public.nexi_statements (
  id uuid primary key default gen_random_uuid(),

  invoice_number  text not null unique,
  invoice_date    date not null,
  period_start    date not null,
  period_end      date not null,
  merchant_number text not null,
  account_iban    text,

  payouts_total numeric(12,2) not null,

  -- Transaction fees for the month
  fees_net   numeric(12,2) not null default 0,
  fees_vat   numeric(12,2) not null default 0,
  fees_gross numeric(12,2) not null default 0,
  -- Turnover, count and fee per card brand, as stated
  brands jsonb,

  -- The direct debit that collects the fees
  debit_date   date,
  debit_amount numeric(12,2),

  source_file text,
  created_at  timestamptz not null default now()
);

create index if not exists nexi_statements_period_idx on public.nexi_statements (period_start);

alter table public.nexi_statements enable row level security;
drop policy if exists nexi_statements_all on public.nexi_statements;
create policy nexi_statements_all on public.nexi_statements
  for all to authenticated using (true) with check (true);


-- One transfer. The Zahlungsnummer is unique per merchant account, so a
-- re-uploaded statement updates its rows instead of duplicating them.
create table if not exists public.nexi_payouts (
  id           uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.nexi_statements(id) on delete cascade,

  merchant_number text not null,
  payment_number  text not null,
  payout_date     date not null,
  transaction_amount numeric(12,2) not null,
  amount             numeric(12,2) not null,

  created_at timestamptz not null default now(),

  unique (merchant_number, payment_number)
);

create index if not exists nexi_payouts_date_idx on public.nexi_payouts (payout_date);

alter table public.nexi_payouts enable row level security;
drop policy if exists nexi_payouts_all on public.nexi_payouts;
create policy nexi_payouts_all on public.nexi_payouts
  for all to authenticated using (true) with check (true);


-- The credit in the bank, tied to the transfer the statement lists. Standing
-- in for a bill, exactly as a Wolt or Lieferando settlement does.
alter table public.cashflow_transactions
  add column if not exists nexi_payout_id uuid references public.nexi_payouts(id) on delete set null;

comment on column public.cashflow_transactions.nexi_payout_id is
  'The Nexi transfer this credit is, evidenced by the monthly settlement.';

create index if not exists cashflow_transactions_nexi_payout_idx
  on public.cashflow_transactions (nexi_payout_id);

-- The fees are collected by direct debit a day or two after the statement, so
-- that debit points at the statement rather than at any one transfer.
alter table public.cashflow_transactions
  add column if not exists nexi_statement_id uuid references public.nexi_statements(id) on delete set null;

comment on column public.cashflow_transactions.nexi_statement_id is
  'The Nexi settlement whose transaction fees this debit collects.';

create index if not exists cashflow_transactions_nexi_statement_idx
  on public.cashflow_transactions (nexi_statement_id);
