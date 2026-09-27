-- Where a bill's due date came from.
--
-- 42% of bills had no due date at all, so they carried no deadline and fell
-- out of every payment run. Most can be worked out — from the term printed on
-- the document, from the term the same supplier prints on its other invoices,
-- or from its own collection schedule in the bank — but a date worked out is
-- not a date the supplier printed, and the two must not look alike.
--
--   printed        the supplier printed a date; nothing was inferred
--   stated-term    the document states a condition: "14 Tage netto", "Zahlbar sofort"
--   settlement     the Skonto line names the day the debit falls
--   prepaid        Vorkasse or Vorauskasse: due before delivery
--   settled        already collected or paid when the invoice was issued
--   supplier-term  the term this supplier prints on its other invoices
--   bank-history   this supplier states nothing anywhere, but its debits are regular
--   default        nothing known: invoice date + 14 days

alter table bills add column if not exists due_date_source text;

comment on column bills.due_date_source is
  'How due_date was arrived at: printed | stated-term | settlement | prepaid | settled | supplier-term | bank-history | default. Null on rows written before this column existed.';

-- Everything already holding a due date got it from the document itself.
update bills set due_date_source = 'printed'
where due_date is not null and due_date_source is null;
