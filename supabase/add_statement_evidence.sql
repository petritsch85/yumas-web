-- Which monthly statement evidences a bank payment.
--
-- A card acquirer's payout has no bill behind it: the evidence is the
-- acquirer's monthly statement, which lists every payout with its date and
-- amount. Nexi has its own tables for this; Amex, Stripe and the rest only
-- have the statement filed in month_documents. Without a link the payouts
-- read "No Bill" on the Cash Flow page although their document is on file —
-- 33 Amex payouts in September alone.
--
-- One nullable column. Deleting the statement leaves the payment unlinked
-- rather than removing it.

alter table cashflow_transactions
  add column if not exists statement_document_id uuid
  references month_documents (id) on delete set null;

create index if not exists cashflow_transactions_statement_document
  on cashflow_transactions (statement_document_id);

comment on column cashflow_transactions.statement_document_id is
  'The monthly statement (month_documents) that evidences this payment — e.g. the Amex Abrechnung listing this payout.';
