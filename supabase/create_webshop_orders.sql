-- Webshop orders — one row per order from the shop's analytics export.
--
-- Take-away at every restaurant, and delivery at Eschborn. Amounts are stored
-- in cents exactly as exported, so nothing is lost to rounding on the way in;
-- the app divides when it displays.
--
-- Customer name, e-mail, phone and delivery address are deliberately NOT
-- stored: the reporting never needs them, and not holding them is the simplest
-- way to keep them safe.

create table if not exists public.webshop_orders (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,

  order_number text not null,
  -- Venue as the webshop names it, kept for traceability
  venue        text,

  -- The day and shift the order was handed over on, which is what the P&L uses
  sale_date    date not null,
  shift        text not null check (shift in ('lunch', 'dinner')),
  fulfilled_at timestamptz,
  created_at_shop timestamptz,

  order_type text not null check (order_type in ('pickup', 'delivery')),
  status         text,
  payment_status text,
  -- completed and paid: an unpaid order is an abandoned checkout, not a sale
  counts boolean not null default false,

  items text,

  net_cents          integer not null default 0,
  vat_cents          integer not null default 0,
  gross_cents        integer not null default 0,
  tip_cents          integer not null default 0,
  delivery_fee_cents integer not null default 0,
  discount_cents     integer not null default 0,

  created_at timestamptz not null default now(),

  -- Re-importing an export updates each order rather than duplicating it
  unique (order_number)
);

create index if not exists webshop_orders_location_date_idx
  on public.webshop_orders (location_id, sale_date);

alter table public.webshop_orders enable row level security;

drop policy if exists webshop_orders_all on public.webshop_orders;
create policy webshop_orders_all on public.webshop_orders
  for all to authenticated using (true) with check (true);
