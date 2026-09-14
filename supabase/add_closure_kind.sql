-- Opening a shift the weekly pattern shuts.
--
-- closure_days has only ever closed a shift on a date. The opposite case is
-- just as real: an event on a Sunday at a store that is otherwise shut on
-- Sundays. Rather than a second table for the same shape of fact, each row
-- now says which way it goes. An 'open' row wins over the recurring pattern
-- and over any 'closed' row for the same date, which is the only order that
-- makes sense - it is the more deliberate statement.
--
-- Run once in the Supabase SQL Editor.

alter table public.closure_days
  add column if not exists kind text not null default 'closed'
  check (kind in ('closed', 'open'));

comment on column public.closure_days.kind is
  '''closed'' shuts the shift on this date; ''open'' opens a shift the weekly pattern would shut.';
