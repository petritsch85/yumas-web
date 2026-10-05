-- More than one document per position per month.
--
-- The table started with one row per kind per month, which suits a Kontoauszug
-- or a Nexi statement: there is exactly one, and uploading it again replaces
-- it. Wolt does not work that way. September had 18 five-day periods, each
-- arriving as four or five PDFs — the Selbstfakturierung, the counter-invoice,
-- the netting report, the sales report — so one row per month cannot hold them.
--
-- Uniqueness moves to the filename. A position that genuinely has one document
-- still replaces, because the upload route clears the position first for those
-- kinds; one that has many simply accumulates, and re-uploading the same file
-- overwrites itself rather than doubling.

drop index if exists month_documents_kind_month;

create unique index if not exists month_documents_kind_month_file
  on month_documents (kind, month, filename);

comment on index month_documents_kind_month_file is
  'One row per document. Positions that hold a single document are kept single by the upload route, not by this index.';
