-- Replace location_shifts with per-day time structure
-- day_times JSONB: { "monday": { "start": "11:30", "end": "22:30" }, ... }
-- Only days present in the object are active for that shift.

drop table if exists public.location_shifts cascade;

create table public.location_shifts (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name        text not null,
  day_times   jsonb not null default '{}',  -- keyed by day name, value: {start, end}
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.location_shifts enable row level security;

create policy "Admins manage shifts" on public.location_shifts
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "All authenticated users read shifts" on public.location_shifts
  for select using (auth.role() = 'authenticated');

-- ── Seed data ──────────────────────────────────────────────────────────────

-- Eschborn: Lunch Mon–Fri 11:30–16:00
insert into public.location_shifts (location_id, name, day_times)
select l.id, 'Lunch', '{
  "monday":    {"start":"11:30","end":"16:00"},
  "tuesday":   {"start":"11:30","end":"16:00"},
  "wednesday": {"start":"11:30","end":"16:00"},
  "thursday":  {"start":"11:30","end":"16:00"},
  "friday":    {"start":"11:30","end":"16:00"}
}'::jsonb
from public.locations l where l.name = 'Eschborn';

-- Eschborn: Dinner Mon–Fri 17:00–22:30
insert into public.location_shifts (location_id, name, day_times)
select l.id, 'Dinner', '{
  "monday":    {"start":"17:00","end":"22:30"},
  "tuesday":   {"start":"17:00","end":"22:30"},
  "wednesday": {"start":"17:00","end":"22:30"},
  "thursday":  {"start":"17:00","end":"22:30"},
  "friday":    {"start":"17:00","end":"22:30"}
}'::jsonb
from public.locations l where l.name = 'Eschborn';

-- Eschborn: Dinner Saturday 13:00–22:30
insert into public.location_shifts (location_id, name, day_times)
select l.id, 'Dinner (Saturday)', '{
  "saturday": {"start":"13:00","end":"22:30"}
}'::jsonb
from public.locations l where l.name = 'Eschborn';

-- Taunus: Lunch Mon–Fri 11:30–14:30
insert into public.location_shifts (location_id, name, day_times)
select l.id, 'Lunch', '{
  "monday":    {"start":"11:30","end":"14:30"},
  "tuesday":   {"start":"11:30","end":"14:30"},
  "wednesday": {"start":"11:30","end":"14:30"},
  "thursday":  {"start":"11:30","end":"14:30"},
  "friday":    {"start":"11:30","end":"14:30"}
}'::jsonb
from public.locations l where l.name = 'Taunus';

-- Taunus: Dinner Tue–Sat 17:30–22:30
insert into public.location_shifts (location_id, name, day_times)
select l.id, 'Dinner', '{
  "tuesday":   {"start":"17:30","end":"22:30"},
  "wednesday": {"start":"17:30","end":"22:30"},
  "thursday":  {"start":"17:30","end":"22:30"},
  "friday":    {"start":"17:30","end":"22:30"},
  "saturday":  {"start":"17:30","end":"22:30"}
}'::jsonb
from public.locations l where l.name = 'Taunus';

-- Westend: Lunch Mon–Fri 11:30–14:30
insert into public.location_shifts (location_id, name, day_times)
select l.id, 'Lunch', '{
  "monday":    {"start":"11:30","end":"14:30"},
  "tuesday":   {"start":"11:30","end":"14:30"},
  "wednesday": {"start":"11:30","end":"14:30"},
  "thursday":  {"start":"11:30","end":"14:30"},
  "friday":    {"start":"11:30","end":"14:30"}
}'::jsonb
from public.locations l where l.name = 'Westend';

-- Westend: Dinner Tue–Sun 17:30–22:30
insert into public.location_shifts (location_id, name, day_times)
select l.id, 'Dinner', '{
  "tuesday":   {"start":"17:30","end":"22:30"},
  "wednesday": {"start":"17:30","end":"22:30"},
  "thursday":  {"start":"17:30","end":"22:30"},
  "friday":    {"start":"17:30","end":"22:30"},
  "saturday":  {"start":"17:30","end":"22:30"},
  "sunday":    {"start":"17:30","end":"22:30"}
}'::jsonb
from public.locations l where l.name = 'Westend';
