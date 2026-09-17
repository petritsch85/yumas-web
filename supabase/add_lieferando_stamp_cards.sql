-- Stamp-card redemptions (Stempelkarte) — the part of an order the guest paid
-- with Lieferando's loyalty stamps. A discount the restaurant funds, so it
-- comes off net sales like a refund, but it is not one and is kept apart.
alter table public.lieferando_periods
  add column if not exists stamp_cards numeric(12,2) not null default 0;
alter table public.lieferando_orders
  add column if not exists stamp_card numeric(12,2) not null default 0;
alter table public.lieferando_shift_sales
  add column if not exists stamp_card_est numeric(12,2) not null default 0;
