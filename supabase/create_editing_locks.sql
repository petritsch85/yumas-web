-- Editing locks: one row per lockable page.
-- Prevents two admins from editing the same list simultaneously.

CREATE TABLE IF NOT EXISTS editing_locks (
  page_key       TEXT        PRIMARY KEY,
  locked_by      UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  locked_by_name TEXT        NOT NULL DEFAULT 'Someone',
  locked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT now() + interval '5 minutes'
);

ALTER TABLE editing_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON editing_locks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── acquire_edit_lock ────────────────────────────────────────────────────────
-- Returns {"success": true} if the lock was acquired.
-- Returns {"success": false, "locked_by_name": "...", "locked_at": "..."} if
-- another user currently holds a valid lock.
CREATE OR REPLACE FUNCTION acquire_edit_lock(
  p_page_key  TEXT,
  p_user_id   UUID,
  p_user_name TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rec editing_locks%ROWTYPE;
BEGIN
  SELECT * INTO rec FROM editing_locks WHERE page_key = p_page_key;

  -- No lock, expired lock, or we already own it → grant
  IF rec IS NULL
     OR rec.expires_at < now()
     OR rec.locked_by = p_user_id
  THEN
    INSERT INTO editing_locks (page_key, locked_by, locked_by_name, locked_at, expires_at)
    VALUES (p_page_key, p_user_id, p_user_name, now(), now() + interval '5 minutes')
    ON CONFLICT (page_key) DO UPDATE
      SET locked_by      = EXCLUDED.locked_by,
          locked_by_name = EXCLUDED.locked_by_name,
          locked_at      = EXCLUDED.locked_at,
          expires_at     = EXCLUDED.expires_at;
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Someone else holds a valid lock → deny
  RETURN jsonb_build_object(
    'success',        false,
    'locked_by_name', rec.locked_by_name,
    'locked_at',      rec.locked_at
  );
END;
$$;

-- ── renew_edit_lock ──────────────────────────────────────────────────────────
-- Extends the expiry by 5 minutes. Called every ~2.5 min while in edit mode.
CREATE OR REPLACE FUNCTION renew_edit_lock(
  p_page_key TEXT,
  p_user_id  UUID
) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE editing_locks
  SET    expires_at = now() + interval '5 minutes'
  WHERE  page_key  = p_page_key
  AND    locked_by = p_user_id;
$$;

-- ── release_edit_lock ────────────────────────────────────────────────────────
-- Deletes the lock. Only the owner can release it (enforced in app layer too).
CREATE OR REPLACE FUNCTION release_edit_lock(
  p_page_key TEXT,
  p_user_id  UUID
) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM editing_locks
  WHERE  page_key  = p_page_key
  AND    locked_by = p_user_id;
$$;
