-- Wolt sales cut into days and shifts.
--
-- Derived from the order timestamps in the Wolt sales report, then reconciled
-- to the self-billing invoice: net sales plus refunds equals subtotal (A), and
-- commission equals subtotal (B), to the cent.
--
-- Rows belong to the period they were derived from, so re-uploading a document
-- set can replace them wholesale rather than merging into stale rows.

create table if not exists public.wolt_shift_sales (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references public.wolt_periods(id) on delete cascade,
  location_id uuid not null references public.locations(id)    on delete cascade,

  sale_date date not null,
  shift     text not null check (shift in ('lunch', 'dinner')),

  orders     integer       not null default 0,
  -- Order value including VAT — what Wolt charges commission on
  gross      numeric(12,2) not null default 0,
  -- Order value excluding VAT, before the refund share
  net_sales  numeric(12,2) not null default 0,
  -- This shift's pro-rata share of the period's refunds. Negative.
  -- An estimate at shift level: Wolt only reports refunds per period.
  refund_est numeric(12,2) not null default 0,
  -- Commission from the per-order rates, reconciled to the invoice
  commission numeric(12,2) not null default 0,
  -- net_sales + refund_est - commission
  net_pre_ads numeric(12,2) not null default 0,

  created_at timestamptz not null default now(),

  unique (location_id, sale_date, shift)
);

create index if not exists wolt_shift_sales_location_date_idx
  on public.wolt_shift_sales (location_id, sale_date);
create index if not exists wolt_shift_sales_period_idx
  on public.wolt_shift_sales (period_id);

alter table public.wolt_shift_sales enable row level security;

drop policy if exists wolt_shift_sales_all on public.wolt_shift_sales;
create policy wolt_shift_sales_all on public.wolt_shift_sales
  for all to authenticated using (true) with check (true);
