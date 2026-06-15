-- Dynamic chat channels (admin-created rooms beyond the hardcoded set)
CREATE TABLE IF NOT EXISTS chat_channels (
  id         text PRIMARY KEY,          -- slug used as room key, e.g. 'marketing'
  label      text NOT NULL,
  emoji      text NOT NULL DEFAULT '💬',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;

-- All authenticated users can see channels
CREATE POLICY "chat_channels_select" ON chat_channels
  FOR SELECT TO authenticated USING (true);

-- Any authenticated user can insert (admin check enforced in the UI)
CREATE POLICY "chat_channels_insert" ON chat_channels
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

-- Creator can delete
CREATE POLICY "chat_channels_delete" ON chat_channels
  FOR DELETE TO authenticated USING (auth.uid() = created_by);
