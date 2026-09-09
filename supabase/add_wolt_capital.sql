-- Wolt Capital repayment, and the transfer Wolt actually makes.
--
-- Wolt lends against future sales ("Wolt Capital") and recovers the advance by
-- withholding a slice of each payout. The netting report shows it under
-- "Finanzierung Rückzahlungen & Gebühren" and then states the Nettoauszahlung:
--
--   Umsatz brutto (incl. MwSt) − Wolt Dienstleistungen brutto − Wolt capital
--
-- Without these two figures a payout can never be tied back to the invoice: the
-- bank receives a gross amount net of a repayment, while the invoice states a
-- net figure before both. Verified across 29 netting reports, every one of which
-- reconciles to the cent.
--
-- The repayment is NOT a cost — it repays a loan, so it belongs to financing,
-- not the P&L. It is stored here only so the cash can be reconciled.
--
-- Run once in the Supabase SQL Editor.

alter table public.wolt_periods
  add column if not exists wolt_capital numeric(12,2) not null default 0,
  add column if not exists payout_net   numeric(12,2);

comment on column public.wolt_periods.wolt_capital is
  'Wolt Capital advance repayment withheld from this period''s transfer. Financing, not a cost.';
comment on column public.wolt_periods.payout_net is
  'Nettoauszahlung as printed on the netting report — the amount that reaches the bank.';

-- A bank credit can be evidenced by the Wolt period that produced it, rather
-- than by an incoming bill. Wolt sends no invoice we file under bills; the
-- settlement documents in Sales Reports are the evidence.
alter table public.cashflow_transactions
  add column if not exists wolt_period_id uuid references public.wolt_periods(id) on delete set null;

comment on column public.cashflow_transactions.wolt_period_id is
  'The Wolt settlement period whose Nettoauszahlung this transaction is, in place of a bill.';

create index if not exists cashflow_transactions_wolt_period_idx
  on public.cashflow_transactions (wolt_period_id);
