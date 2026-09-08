-- Reservations exported from OpenTable GuestCenter.
--
-- One row per reservation, stored raw so a figure in the Sales Report can
-- always be traced back to the bookings behind it. Party size ("Größe") is the
-- covers the reservation is worth.
--
-- The export carries no reservation id, so identity is rebuilt from the fields
-- that make a booking distinct to someone reading the list — date, time, guest,
-- phone and party size. Re-importing an overlapping export therefore updates
-- the reservations it already knows rather than duplicating them, which matters
-- because GuestCenter exports are cumulative from the day you run them.
--
-- Run once in the Supabase SQL Editor.

create table if not exists public.opentable_bookings (
  id            uuid        primary key default gen_random_uuid(),
  location_id   uuid        not null references locations(id) on delete cascade,
  external_key  text        not null,
  visit_date    date        not null,
  visit_time    text,
  shift         text        not null check (shift in ('lunch', 'dinner')),
  guest_name    text,
  phone         text,
  party_size    integer     not null default 0,
  status        text,
  -- False for a cancellation or no-show: kept for the record, excluded from totals.
  counts        boolean     not null default true,
  "table"       text,
  source        text,
  requests      text,
  notes         text,
  tags          text,
  completed_visits numeric,
  file_name     text,
  imported_by   uuid,
  created_at    timestamptz default now(),
  unique (location_id, external_key)
);

create index if not exists opentable_bookings_date_idx
  on public.opentable_bookings (location_id, visit_date);

alter table public.opentable_bookings enable row level security;

drop policy if exists "auth_rw_opentable_bookings" on public.opentable_bookings;
create policy "auth_rw_opentable_bookings"
  on public.opentable_bookings for all to authenticated
  using (true) with check (true);
