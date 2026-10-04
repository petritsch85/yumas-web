-- The monthly statements that reach us as a PDF and nothing else.
--
-- Most of what the Steuerberater needs is already in the system as a record:
-- the bills, the invoices we write, the delivery notes. A handful arrives only
-- as a document — the Kontoauszug, and the monthly overviews from Nexi, Amex,
-- PayPal and Too Good To Go. Those had no home at all, so each month they were
-- found again by hand.
--
-- `kind` says what the document is and `month` which month it belongs to, so a
-- month can be asked whether it is complete rather than inspected. The pair is
-- unique: uploading September's Nexi twice replaces it instead of quietly
-- giving the Steuerberater two copies.

create table if not exists month_documents (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  -- The first of the month it covers, so it sorts and compares as a date.
  month       date not null,
  filename    text not null,
  file_path   text not null,
  bucket      text not null default 'cashflow-files',
  byte_size   bigint,
  notes       text,
  uploaded_by uuid,
  created_at  timestamptz not null default now()
);

create unique index if not exists month_documents_kind_month
  on month_documents (kind, month);

create index if not exists month_documents_month on month_documents (month);

comment on table month_documents is
  'Monthly statements that exist only as a PDF — Kontoauszug, Nexi, Amex, PayPal, Too Good To Go. One row per kind per month; re-uploading replaces.';
comment on column month_documents.kind is
  'Matches a key in the Monatsabschluss manifest (lib/month-folder.ts), which decides what a complete month looks like.';
