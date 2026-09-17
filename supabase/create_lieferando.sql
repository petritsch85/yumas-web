-- Lieferando weekly statements — the delivery platform used in Eschborn.
--
-- Lieferando settles once a week (Sunday to Saturday) and sends one PDF that
-- is invoice, order list and payout in one. Fees are billed net with 19% VAT
-- on top, and the invoice is settled against the online payments Lieferando
-- holds, so the payout is order value plus tips less the invoice.
--
-- Same three-table shape as Wolt: the period as stated, its orders, and the
-- day/shift split the P&L reads.

create table if not exists public.lieferando_periods (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references public.locations(id) on delete cascade,

  invoice_number  text not null,
  invoice_date    date not null,
  period_start    date not null,
  period_end      date not null,
  restaurant      text,
  customer_number text,

  -- Orders and their value as the statement states them, gross incl. VAT
  order_count      integer       not null default 0,
  order_value_gross numeric(12,2) not null default 0,
  -- Order value net of VAT, at the rate the split assumed
  net_sales_pre_commission numeric(12,2) not null,
  vat_rate_assumed  numeric(5,4)  not null default 0.07,

  -- Fees, each net of VAT, held positive
  service_fee_rate numeric(6,4),
  service_fee      numeric(12,2) not null default 0,   -- "Servicegebühr: 14,00% von …"
  admin_fee        numeric(12,2) not null default 0,   -- "Verwaltungsgebühr (Online-Zahlungen)"
  top_rank         numeric(12,2) not null default 0,   -- "TopRank" — paid ranking, i.e. advertising
  other_fees       numeric(12,2) not null default 0,   -- anything else on the invoice
  refunds          numeric(12,2) not null default 0,   -- refunds Lieferando deducted, net, held positive

  -- Commission = service fee + admin fee (+ other); advertising = TopRank
  commission        numeric(12,2) not null,
  net_sales_pre_ads numeric(12,2) not null,
  advertising       numeric(12,2) not null default 0,
  net_sales_final   numeric(12,2) not null,

  -- The invoice's own totals, so the arithmetic stays checkable
  fees_net      numeric(12,2) not null,   -- Zwischensumme
  fees_vat      numeric(12,2) not null,   -- MwSt. 19%
  invoice_gross numeric(12,2) not null,   -- Gesamtbetrag dieser Rechnung
  tips          numeric(12,2) not null default 0,
  payout        numeric(12,2),            -- Auszahlung auf das Bankkonto
  check_ok      boolean not null default false,

  source_file text,
  created_at  timestamptz not null default now(),

  unique (location_id, invoice_number)
);

create index if not exists lieferando_periods_location_period_idx
  on public.lieferando_periods (location_id, period_start);

alter table public.lieferando_periods enable row level security;
drop policy if exists lieferando_periods_all on public.lieferando_periods;
create policy lieferando_periods_all on public.lieferando_periods
  for all to authenticated using (true) with check (true);


-- Every order on the statement, so a period can be checked line by line.
create table if not exists public.lieferando_orders (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null references public.lieferando_periods(id) on delete cascade,
  location_id  uuid not null references public.locations(id) on delete cascade,
  order_number text not null,
  ordered_at   timestamptz not null,
  sale_date    date not null,
  shift        text not null check (shift in ('lunch', 'dinner')),
  gross        numeric(12,2) not null,
  tip          numeric(12,2) not null default 0,
  -- A Rückbuchung on this order, gross, held positive
  refund       numeric(12,2) not null default 0,
  online_paid  boolean not null default true,

  unique (location_id, order_number)
);

create index if not exists lieferando_orders_period_idx on public.lieferando_orders (period_id);

alter table public.lieferando_orders enable row level security;
drop policy if exists lieferando_orders_all on public.lieferando_orders;
create policy lieferando_orders_all on public.lieferando_orders
  for all to authenticated using (true) with check (true);


-- The statement cut into days and shifts — the rows the P&L reads.
-- Same columns as wolt_shift_sales so the two channels share one renderer.
create table if not exists public.lieferando_shift_sales (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references public.lieferando_periods(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,

  sale_date date not null,
  shift     text not null check (shift in ('lunch', 'dinner')),

  orders          integer       not null default 0,
  gross           numeric(12,2) not null default 0,
  net_sales       numeric(12,2) not null default 0,
  refund_est      numeric(12,2) not null default 0,   -- negative
  commission      numeric(12,2) not null default 0,
  net_pre_ads     numeric(12,2) not null default 0,
  advertising_est numeric(12,2) not null default 0,
  net_final       numeric(12,2) not null default 0,

  created_at timestamptz not null default now(),

  unique (location_id, sale_date, shift)
);

create index if not exists lieferando_shift_sales_location_date_idx
  on public.lieferando_shift_sales (location_id, sale_date);

alter table public.lieferando_shift_sales enable row level security;
drop policy if exists lieferando_shift_sales_all on public.lieferando_shift_sales;
create policy lieferando_shift_sales_all on public.lieferando_shift_sales
  for all to authenticated using (true) with check (true);
