-- Wolt order items — what was actually sold, line by line.
--
-- The five-day document set gives totals per order but never the products.
-- Wolt's purchases export does, and this table holds it one row per item line,
-- so Wolt products can eventually be counted alongside the webshop's and
-- Orderbird's for a single "everything sold this shift" list.
--
-- The sale is dated by DELIVERY, not by when the order was placed: attributing
-- by delivery reproduced Wolt's own daily totals on every day of a real
-- two-month export, while order time was wrong on the four days where a
-- late-evening order arrived the next day.

create table if not exists public.wolt_order_items (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,

  order_number text not null,
  venue        text,

  sale_date    date not null,
  shift        text not null check (shift in ('lunch', 'dinner')),
  placed_at    timestamptz,
  delivered_at timestamptz,

  status text,
  -- Rejected orders are kept but do not count as sales
  counts boolean not null default true,

  -- Position within the order, so a re-import updates rather than duplicates
  line_no      integer not null,
  product_name text not null,
  -- Wolt's short POS code, when the export's columns line up
  pos_id       text,

  quantity         integer not null default 1,
  unit_price_cents integer not null default 0,
  line_gross_cents integer not null default 0,

  created_at timestamptz not null default now(),

  -- Order numbers restart per venue, so the location belongs in the key
  unique (location_id, order_number, line_no)
);

create index if not exists wolt_order_items_location_date_idx
  on public.wolt_order_items (location_id, sale_date);
create index if not exists wolt_order_items_product_idx
  on public.wolt_order_items (product_name);

alter table public.wolt_order_items enable row level security;

drop policy if exists wolt_order_items_all on public.wolt_order_items;
create policy wolt_order_items_all on public.wolt_order_items
  for all to authenticated using (true) with check (true);
