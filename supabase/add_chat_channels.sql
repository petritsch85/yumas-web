-- Dynamic chat channels (admin-created rooms beyond the hardcoded set)
CREATE TABLE IF NOT EXISTS chat_channels (
  id         text PRIMARY KEY,          -- slug used as room key, e.g. 'marketing'
  label      text NOT NULL,
  emoji      text NOT NULL DEFAULT '💬',
  member_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;

-- Users can see channels they are a member of
CREATE POLICY "chat_channels_select" ON chat_channels
  FOR SELECT TO authenticated USING (auth.uid() = ANY(member_ids));

-- Any authenticated user can insert (admin check enforced in the UI)
CREATE POLICY "chat_channels_insert" ON chat_channels
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

-- Creator can delete
CREATE POLICY "chat_channels_delete" ON chat_channels
  FOR DELETE TO authenticated USING (auth.uid() = created_by);
