-- The figures read off a monthly statement, kept with the document.
--
-- Two numbers on the PayPal Monatsübersicht exist nowhere else. The Working
-- Capital loan repays itself out of every sale — 163 deductions in September —
-- so it never appears as an instalment and never reaches the bank. The fees are
-- netted off before the payout for the same reason. Together they were about
-- 1.650 € a month that the books could not see.
--
-- They sit beside the opening and closing balances the Kontoauszug already
-- carries, because they are the same kind of thing: what a statement says,
-- stored once so nothing has to re-read the PDF to find out.

alter table month_documents add column if not exists working_capital numeric;
alter table month_documents add column if not exists fees numeric;

comment on column month_documents.working_capital is
  'Loan repaid inside the account during the month, never visible on the bank. PayPal Working Capital; the Wolt equivalent lives on wolt_periods.';
comment on column month_documents.fees is
  'Payment fees deducted inside the account before anything reached the bank.';
