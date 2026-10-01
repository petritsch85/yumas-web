-- How much of a bill a payment settles.
--
-- A link used to mean "this payment settles this bill", whole. That covers a
-- collected payment — one transfer, many invoices — but not its inverse: one
-- invoice paid in instalments. Perola's invoice 161077 prints its own terms,
--
--   "Zahlung 4.250€ nach 30 Tagen, 4.250€ nach 60 Tagen, 4.309,16€ nach 90 Tagen"
--
-- and the bank did exactly that: 12.809,16 € settled by three payments. Linking
-- all three without an amount would have each of them claiming the whole
-- invoice, so every one would read as massively overpaid.
--
-- Null keeps the old meaning — the whole bill — so nothing already saved
-- changes.

alter table transaction_bill_links add column if not exists amount numeric;

comment on column transaction_bill_links.amount is
  'The part of the bill this payment settles, where it settles only a part. Null means the whole bill, which is what every link meant before this column existed.';
