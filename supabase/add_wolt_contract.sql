-- Which Wolt contract a period came from.
--
-- Two are in use and they publish different documents:
--   self_billing   Wolt delivers (Westend, Taunus). A self-billing invoice
--                  states goods (A) and commission (B), and the check figure is
--                  its Endbetrag.
--   self_delivery  The restaurant delivers (Eschborn). There is no self-billing
--                  invoice; a payout report states what was sold and Wolt
--                  invoices its fees separately. The check figure is the
--                  Zahlungsbetrag — what Wolt actually paid out.
--
-- Stored so the Wolt page can label the check column honestly, since the two
-- contracts check against different things.

alter table public.wolt_periods
  add column if not exists contract text not null default 'self_billing';

alter table public.wolt_periods
  drop constraint if exists wolt_periods_contract_check;
alter table public.wolt_periods
  add constraint wolt_periods_contract_check
  check (contract in ('self_billing', 'self_delivery'));
