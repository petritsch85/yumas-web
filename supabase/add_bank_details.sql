-- Bank details, so approved invoices can be paid as a SEPA Sammelüberweisung.
--
-- The account belongs to the counterparty, not to the invoice: a supplier is
-- paid to the same account every month, and holding it once means it is
-- entered once and can be checked. The invoice still carries whatever account
-- it printed, so a supplier changing bank is visible rather than silent.

alter table public.counterparties
  add column if not exists iban text,
  add column if not exists bic text,
  -- The account holder, where it differs from the counterparty's own name
  add column if not exists account_holder text;

comment on column public.counterparties.iban is
  'Where this counterparty is paid. Used to build the SEPA credit transfer file.';

-- What the invoice itself printed, read out of the document. Kept apart from
-- the master record so the two can be compared.
alter table public.bills
  add column if not exists creditor_iban text,
  add column if not exists creditor_bic text,
  add column if not exists creditor_name text;

comment on column public.bills.creditor_iban is
  'The account printed on this invoice, as extracted. Compared against the counterparty''s own before paying.';
