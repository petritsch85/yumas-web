-- The balances the Kontoauszug itself states.
--
-- The cash flow statement opens and closes on the bank's own figures, not on
-- anything the ledger computes, so that the two can disagree and be seen to.
-- They are read when the statement is applied and kept with the document.
--
-- Without this the check is circular: a closing balance derived from the same
-- transactions that make up the movements always ties, and proves nothing.

alter table month_documents add column if not exists opening_balance numeric;
alter table month_documents add column if not exists closing_balance numeric;

comment on column month_documents.opening_balance is
  'Kontostand at the start of the month, as printed on the Kontoauszug.';
comment on column month_documents.closing_balance is
  'Kontostand at the end of the month, as printed on the Kontoauszug. The cash flow statement must reach exactly this.';
