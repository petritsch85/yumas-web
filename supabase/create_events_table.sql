-- Run this in Supabase Dashboard → SQL Editor
-- If you already ran the previous version, use the ALTER statements at the bottom instead.

create table if not exists events (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  location         text not null,
  event_date       date not null,
  event_time_from  time,
  event_time_until time,
  num_guests       integer not null default 1,
  contact_name     text not null,
  contact_email    text,
  contact_phone    text,
  menu_package     text,
  budget           numeric(10, 2),
  deposit_paid     numeric(10, 2),
  notes            text,
  status           text not null default 'tentative'
                     check (status in ('tentative', 'confirmed', 'cancelled')),
  confidence       integer check (confidence between 1 and 3),  -- 1=low,2=med,3=high; tentative only
  created_at       timestamptz default now(),
  created_by       uuid references auth.users(id)
);

alter table events enable row level security;

create policy "Authenticated users can read events"
  on events for select using (auth.role() = 'authenticated');

create policy "Authenticated users can insert events"
  on events for insert with check (auth.role() = 'authenticated');

create policy "Authenticated users can update events"
  on events for update using (auth.role() = 'authenticated');


-- ─── IF YOU ALREADY CREATED THE TABLE WITH THE OLD SCHEMA ────────────────
-- Run these ALTER statements instead of the CREATE TABLE above:
--
-- alter table events rename column event_time to event_time_from;
-- alter table events add column if not exists event_time_until time;
-- alter table events add column if not exists confidence integer check (confidence between 1 and 3);
