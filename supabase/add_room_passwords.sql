-- ─── Room Passwords ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_passwords (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  room       text        NOT NULL,
  label      text        NOT NULL,
  username   text,
  password   text        NOT NULL,
  url        text,
  created_by uuid        REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE room_passwords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "passwords_select" ON room_passwords
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "passwords_insert" ON room_passwords
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "passwords_delete" ON room_passwords
  FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, DELETE ON room_passwords TO authenticated;
