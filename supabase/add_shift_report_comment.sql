-- A note on a shift: an event, a problem, why the number looks odd. Written
-- in the day pop-up on Sales Reports, flagged on the summary table.
alter table public.shift_reports
  add column if not exists comment text;
