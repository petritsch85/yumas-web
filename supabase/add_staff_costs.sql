-- Staff costs per month, from the payroll's FiBu-Journal.
--
-- Payroll leaves the bank as dozens of transfers — wages, the Krankenkassen,
-- the Finanzamt — and none of them is an invoice, so the P&L has carried a
-- typed placeholder for the month instead. The FiBu-Journal from Sage HR is
-- the one document that states the whole cost: page 2 reconciles the wage
-- clearing account 3790, Soll against Haben, and both sides equal the total.
--
-- One row per month. Uploading a corrected journal replaces it — the file
-- name says "nach Korrekturen" for a reason.

create table if not exists staff_costs (
  month        date primary key,           -- first of the month
  total        numeric not null,           -- Soll of account 3790
  -- Haben of the same account. Kept so a journal that does not reconcile can
  -- never be mistaken for one that does.
  total_haben  numeric,
  filename     text,
  file_path    text,
  uploaded_at  timestamptz not null default now()
);

alter table staff_costs enable row level security;
drop policy if exists staff_costs_all on staff_costs;
create policy staff_costs_all on staff_costs
  for all to authenticated using (true) with check (true);

comment on table staff_costs is
  'Monthly staff cost from the Sage HR FiBu-Journal (reconciliation of account 3790). Replaces the P&L placeholder for its month.';
