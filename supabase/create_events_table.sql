-- Run this in Supabase Dashboard → SQL Editor

create table if not exists events (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  location      text not null,
  event_date    date not null,
  event_time    time,
  num_guests    integer not null default 1,
  contact_name  text not null,
  contact_email text,
  contact_phone text,
  menu_package  text,
  budget        numeric(10, 2),
  deposit_paid  numeric(10, 2),
  notes         text,
  status        text not null default 'tentative'
                  check (status in ('tentative', 'confirmed', 'cancelled')),
  created_at    timestamptz default now(),
  created_by    uuid references auth.users(id)
);

-- Allow authenticated users to read/insert/update
alter table events enable row level security;

create policy "Authenticated users can read events"
  on events for select using (auth.role() = 'authenticated');

create policy "Authenticated users can insert events"
  on events for insert with check (auth.role() = 'authenticated');

create policy "Authenticated users can update events"
  on events for update using (auth.role() = 'authenticated');
