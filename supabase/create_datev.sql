-- DATEV: the settings and the account mapping that make Vorkontierung possible.
--
-- The export format is the easy part. What decides whether a posting batch
-- imports cleanly is the mapping: every supplier and every revenue stream
-- needs an account in the client's own Kontenrahmen. That is agreed once with
-- the Steuerberater and then runs itself, so it lives in the database rather
-- than in code.

create table if not exists public.datev_settings (
  -- One row. The constraint keeps it that way.
  id smallint primary key default 1 check (id = 1),

  consultant_number text,          -- Beraternummer
  client_number     text,          -- Mandantennummer
  -- SKR03 or SKR04. Decides every default account below.
  chart             text not null default 'SKR03' check (chart in ('SKR03', 'SKR04')),
  -- Length of a Sachkonto. Personal accounts are one digit longer.
  account_length    smallint not null default 4,
  fiscal_year_start date not null default '2026-01-01',

  -- The accounts a posting needs that no supplier decides
  account_bank      text,          -- 1200 (SKR03) / 1800 (SKR04)
  account_cash      text,          -- 1000 / 1600
  account_revenue_7  text,         -- 8300 / 4300
  account_revenue_19 text,         -- 8400 / 4400
  account_goods_7    text,         -- 3300 / 5300
  account_goods_19   text,         -- 3400 / 5400
  -- Where a cost with no mapping of its own lands, so nothing is silently lost
  account_suspense  text,

  -- Written into the file's header, so the Steuerberater sees where it came from
  export_label text not null default 'Yumas GmbH',

  updated_at timestamptz not null default now()
);

alter table public.datev_settings enable row level security;
drop policy if exists datev_settings_all on public.datev_settings;
create policy datev_settings_all on public.datev_settings
  for all to authenticated using (true) with check (true);

insert into public.datev_settings (id) values (1) on conflict (id) do nothing;


-- One account per counterparty, and a fallback per bill category.
--
-- A supplier posts to its own creditor account (Personenkonto) and its costs
-- to an expense account. Both are the Steuerberater's to decide, so both are
-- stored rather than derived.
create table if not exists public.datev_accounts (
  id uuid primary key default gen_random_uuid(),

  -- 'counterparty' — matched by id; 'category' — matched by the bill's category
  scope text not null check (scope in ('counterparty', 'category')),
  -- The counterparty's id, or the category's name
  ref   text not null,

  -- Where the cost or revenue goes
  account text,
  -- The supplier's own creditor account, where it has one
  creditor_account text,
  -- Only where an Automatikkonto cannot carry the tax rate by itself
  bu_key text,
  -- Kostenstelle, for a cost that belongs to one restaurant
  cost_centre text,

  note text,
  updated_at timestamptz not null default now(),

  unique (scope, ref)
);

create index if not exists datev_accounts_scope_idx on public.datev_accounts (scope, ref);

alter table public.datev_accounts enable row level security;
drop policy if exists datev_accounts_all on public.datev_accounts;
create policy datev_accounts_all on public.datev_accounts
  for all to authenticated using (true) with check (true);


-- What was exported, and when. A posting batch already sent to the
-- Steuerberater must not be sent again as if it were new.
create table if not exists public.datev_exports (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end   date not null,
  kind         text not null check (kind in ('bookings', 'documents')),
  booking_count integer not null default 0,
  total_amount  numeric(14,2) not null default 0,
  filename      text,
  created_at    timestamptz not null default now(),
  created_by    uuid
);

alter table public.datev_exports enable row level security;
drop policy if exists datev_exports_all on public.datev_exports;
create policy datev_exports_all on public.datev_exports
  for all to authenticated using (true) with check (true);
