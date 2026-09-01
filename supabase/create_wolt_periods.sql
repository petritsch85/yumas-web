-- Wolt five-day settlement periods.
--
-- Wolt bills in five-day blocks that line up with no calendar week or month,
-- so the raw period is stored as its own row and the daily/shift split is
-- derived from it later rather than being forced at import time.
--
-- One row per Wolt self-billing invoice (file 2 of each document set).

create table if not exists public.wolt_periods (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references public.locations(id) on delete cascade,

  -- Straight off the invoice
  invoice_number text not null,
  invoice_date   date not null,
  period_start   date not null,
  period_end     date not null,
  restaurant     text,

  -- (A) Zwischensumme aller verkauften Waren, net of VAT
  net_sales_pre_commission numeric(12,2) not null,
  -- (B) Zwischensumme Wolt Vertrieb, net of VAT, held positive
  commission               numeric(12,2) not null,
  -- A - B, calculated by us
  net_sales_pre_ads        numeric(12,2) not null,

  -- The invoice's own Endbetrag, kept so the arithmetic stays checkable
  reported_endbetrag numeric(12,2) not null,
  check_ok           boolean not null default false,

  -- Names of the files this row came from, for traceability
  source_files jsonb,

  created_at timestamptz not null default now(),

  -- Re-uploading the same set updates the row instead of duplicating it
  unique (location_id, invoice_number)
);

create index if not exists wolt_periods_location_period_idx
  on public.wolt_periods (location_id, period_start);

alter table public.wolt_periods enable row level security;

-- Same access model as the other sales tables: any signed-in user.
drop policy if exists wolt_periods_all on public.wolt_periods;
create policy wolt_periods_all on public.wolt_periods
  for all to authenticated using (true) with check (true);
