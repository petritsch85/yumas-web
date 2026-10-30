-- Forecast total net sales per restaurant, day and shift — all channels together.
--
-- The daily, weekly and monthly sheets show it in orange for days not yet
-- reported, and switch to the reported figures once the day has passed.
-- Written by the forecast run (scripts/forecast-sales.mjs); `source` names it.

create table if not exists sales_forecasts (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null references locations (id) on delete cascade,
  forecast_date date not null,
  shift_type    text not null check (shift_type in ('lunch', 'dinner')),
  net_total     numeric(12, 2) not null,
  source        text,
  created_at    timestamptz not null default now(),
  unique (location_id, forecast_date, shift_type)
);

create index if not exists sales_forecasts_date on sales_forecasts (forecast_date);

alter table sales_forecasts enable row level security;
drop policy if exists sales_forecasts_all on sales_forecasts;
create policy sales_forecasts_all on sales_forecasts
  for all to authenticated using (true) with check (true);

comment on table sales_forecasts is
  'Forecast net sales (all channels) per location, date and shift. Shown for days not yet reported.';
