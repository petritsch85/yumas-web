-- Wolt advertising / services charge.
--
-- Wolt bills its own services back to us on the netting report as a single
-- "Wolt Dienstleistungen und Produkte" line. That figure is what the P&L books
-- as advertising.
--
-- The Wolt-to-merchant invoice itemises it, and in practice the total is not
-- purely advertising — one real period broke down as an ad campaign (72,50),
-- a weekly sim-card fee (1,50) and a late-delivery charge (1,85). The
-- ad-campaign part and the full item list are stored alongside the total so the
-- P&L can be pointed at either figure without re-uploading anything.

alter table public.wolt_periods
  add column if not exists advertising     numeric(12,2) not null default 0,
  add column if not exists ad_campaign     numeric(12,2),
  add column if not exists services        jsonb,
  -- net_sales_pre_ads - advertising
  add column if not exists net_sales_final numeric(12,2) not null default 0;

alter table public.wolt_shift_sales
  -- Pro-rata share of the period's advertising. An estimate at shift level.
  add column if not exists advertising_est numeric(12,2) not null default 0,
  -- net_pre_ads - advertising_est
  add column if not exists net_final       numeric(12,2) not null default 0;
