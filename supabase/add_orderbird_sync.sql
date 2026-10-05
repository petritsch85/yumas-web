-- "Yumas Import" bookmark for MY orderbird. Run in Supabase SQL Editor. Safe to run more than once.

-- One row per click, shown on the Sales Reports page.
CREATE TABLE IF NOT EXISTS orderbird_sync_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at          timestamptz NOT NULL DEFAULT now(),
  trigger         text NOT NULL,
  ok              boolean NOT NULL,
  imported_count  integer NOT NULL DEFAULT 0,
  imported        jsonb,
  error           text
);
ALTER TABLE orderbird_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can read orderbird_sync_runs" ON orderbird_sync_runs;
CREATE POLICY "Auth users can read orderbird_sync_runs"
  ON orderbird_sync_runs FOR SELECT TO authenticated USING (true);

-- The tokens baked into the bookmarks. Server access only (no policies).
CREATE TABLE IF NOT EXISTS orderbird_import_tokens (
  token       text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE orderbird_import_tokens ENABLE ROW LEVEL SECURITY;
