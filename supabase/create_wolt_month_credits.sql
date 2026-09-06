-- Monthly credits Wolt settles on a later invoice.
--
-- The Wolt+ delivery-fee refund is the case this exists for: a Wolt+ subscriber
-- gets delivery free, the restaurant delivers anyway, and Wolt reimburses the
-- fee — one line per calendar month, landing on whichever five-day invoice
-- comes next. In July 2026 that was exactly 10 Wolt+ orders at 3,00 gross.
--
-- It is kept out of wolt_periods deliberately. A period's figures tie to its own
-- invoice to the cent, and a credit for a different month would break that. It
-- belongs to the month it names, and the P&L spreads it across that month's
-- trading days when it reads.

create table if not exists public.wolt_month_credits (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,

  -- First day of the month the credit relates to, not the period it arrived in
  month date not null,
  -- What Wolt called it, e.g. "Wolt+ Delivery Fee Refund - July 2026"
  label text not null,
  -- Positive: income to us, net of VAT
  net numeric(12,2) not null,

  -- The invoice it arrived on, so it can be traced back
  source_invoice text,

  created_at timestamptz not null default now(),

  -- One credit of a kind per month; re-importing updates it
  unique (location_id, month, label)
);

create index if not exists wolt_month_credits_location_month_idx
  on public.wolt_month_credits (location_id, month);

alter table public.wolt_month_credits enable row level security;

drop policy if exists wolt_month_credits_all on public.wolt_month_credits;
create policy wolt_month_credits_all on public.wolt_month_credits
  for all to authenticated using (true) with check (true);
