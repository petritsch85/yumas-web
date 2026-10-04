-- Let the app read and write month_documents.
--
-- The table was created with row level security on and no policy, so every
-- access from the browser was refused: uploading from the Monatsabschluss page
-- failed outright with "new row violates row-level security policy", and the
-- P&L's cash flow statement silently showed no opening or closing balance
-- because its select came back empty rather than erroring.
--
-- The service role bypasses RLS, which is why the Kontoauszug uploaded through
-- Cash Flow Check worked and nothing looked wrong from the server side.
--
-- Same shape as the rest of the schema: signed in is enough. There is nothing
-- per-user about which documents a month holds.

alter table month_documents enable row level security;

drop policy if exists month_documents_all on month_documents;
create policy month_documents_all on month_documents
  for all to authenticated using (true) with check (true);
