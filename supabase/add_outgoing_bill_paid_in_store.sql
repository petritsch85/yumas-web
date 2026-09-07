-- Bills that were settled through the till.
--
-- An outgoing bill is normally money the P&L would otherwise not see: an event
-- invoiced and paid by transfer, which never passes through a Z-report. Those
-- belong on the Bills row.
--
-- Sometimes the guest pays in the restaurant instead, so the same money is also
-- in the Z-report. Counting both double-counts the evening. Marking the bill
-- "paid in store" keeps the document and its PDF exactly as they are, and takes
-- only the P&L row out.
--
-- The case this was written for: Trinseo, invoice 128-26, event 13.08.2026 at
-- Eschborn, 3.612,07 gross — the same amount as Z-report 2908, which the guest
-- settled at the till the following morning.

alter table public.outgoing_bills
  add column if not exists paid_in_store boolean not null default false;

comment on column public.outgoing_bills.paid_in_store is
  'Settled through the till, so the amount is already in a Z-report. Excluded from the P&L Bills row.';

update public.outgoing_bills
   set paid_in_store = true
 where invoice_number   = '128-26'
   and issuing_location = 'Eschborn';
