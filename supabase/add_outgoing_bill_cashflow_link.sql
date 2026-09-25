-- The credit that paid one of our own invoices.
--
-- An outgoing bill is settled by a transfer from the customer, and until now
-- nothing tied the two together: the bill sat "pending" however long ago the
-- money arrived. The link is kept on the transaction, like every other piece
-- of evidence, so a credit can only ever pay one invoice.
alter table public.cashflow_transactions
  add column if not exists outgoing_bill_id uuid references public.outgoing_bills(id) on delete set null;

comment on column public.cashflow_transactions.outgoing_bill_id is
  'The outgoing invoice this credit pays. Set when a payment is confirmed on the Outgoing Bills page.';

create index if not exists cashflow_transactions_outgoing_bill_idx
  on public.cashflow_transactions (outgoing_bill_id);
