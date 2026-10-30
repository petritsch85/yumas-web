-- Too Good To Go bag sales, per restaurant, day and shift.
--
-- TGTG reports a month per store and bag type; the import spreads each line
-- evenly over the days that shift was open, so the daily, weekly and monthly
-- sheets add up to each other. Net at 7 % (food to take away).

create table if not exists tgtg_sales (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references locations (id) on delete cascade,
  sale_date    date not null,
  shift        text not null check (shift in ('lunch', 'dinner')),
  bags         numeric(10, 3) not null default 0,
  gross        numeric(12, 2) not null,
  net          numeric(12, 2) not null,
  month        date not null,
  source       text,
  created_at   timestamptz not null default now()
);

create index if not exists tgtg_sales_date on tgtg_sales (sale_date);
create index if not exists tgtg_sales_month on tgtg_sales (month);

alter table tgtg_sales enable row level security;
drop policy if exists tgtg_sales_all on tgtg_sales;
create policy tgtg_sales_all on tgtg_sales
  for all to authenticated using (true) with check (true);

comment on table tgtg_sales is
  'Too Good To Go bag sales from the monthly statement, spread evenly over the open days of each shift.';
