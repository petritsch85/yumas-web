-- ─── Enhanced room_tasks ──────────────────────────────────────────────────────
ALTER TABLE room_tasks
  ADD COLUMN IF NOT EXISTS description   text,
  ADD COLUMN IF NOT EXISTS priority      text DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS deadline      date,
  ADD COLUMN IF NOT EXISTS assignee_ids  uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_by    uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS done_comment  text,
  ADD COLUMN IF NOT EXISTS done_at       timestamptz,
  ADD COLUMN IF NOT EXISTS done_by       uuid REFERENCES auth.users(id);

-- ─── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id),
  type        text        NOT NULL,
  title       text        NOT NULL,
  body        text        NOT NULL,
  read        boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_select" ON notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "notif_insert" ON notifications
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "notif_update" ON notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
