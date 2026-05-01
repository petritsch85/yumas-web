-- Create location_shifts table
create table if not exists public.location_shifts (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name        text not null,                          -- e.g. 'Lunch', 'Dinner'
  days        text[] not null default '{}',           -- ['monday','tuesday',...]
  start_time  time not null,                          -- e.g. '11:30:00'
  end_time    time not null,                          -- e.g. '14:30:00'
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- RLS
alter table public.location_shifts enable row level security;
create policy "Admins manage shifts" on public.location_shifts
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );
create policy "All authenticated users read shifts" on public.location_shifts
  for select using (auth.role() = 'authenticated');

-- Seed: Eschborn
insert into public.location_shifts (location_id, name, days, start_time, end_time)
select l.id, 'Lunch', array['monday','tuesday','wednesday','thursday','friday'], '11:30', '16:00'
from public.locations l where l.name = 'Eschborn';

insert into public.location_shifts (location_id, name, days, start_time, end_time)
select l.id, 'Dinner', array['monday','tuesday','wednesday','thursday','friday'], '17:00', '22:30'
from public.locations l where l.name = 'Eschborn';

insert into public.location_shifts (location_id, name, days, start_time, end_time)
select l.id, 'Dinner (Saturday)', array['saturday'], '13:00', '22:30'
from public.locations l where l.name = 'Eschborn';

-- Seed: Taunus
insert into public.location_shifts (location_id, name, days, start_time, end_time)
select l.id, 'Lunch', array['monday','tuesday','wednesday','thursday','friday'], '11:30', '14:30'
from public.locations l where l.name = 'Taunus';

insert into public.location_shifts (location_id, name, days, start_time, end_time)
select l.id, 'Dinner', array['tuesday','wednesday','thursday','friday','saturday'], '17:30', '22:30'
from public.locations l where l.name = 'Taunus';

-- Seed: Westend
insert into public.location_shifts (location_id, name, days, start_time, end_time)
select l.id, 'Lunch', array['monday','tuesday','wednesday','thursday','friday'], '11:30', '14:30'
from public.locations l where l.name = 'Westend';

insert into public.location_shifts (location_id, name, days, start_time, end_time)
select l.id, 'Dinner', array['tuesday','wednesday','thursday','friday','saturday','sunday'], '17:30', '22:30'
from public.locations l where l.name = 'Westend';
