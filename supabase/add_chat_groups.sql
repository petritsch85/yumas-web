-- ─── Group Chats ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_groups (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  member_ids uuid[] NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_groups ENABLE ROW LEVEL SECURITY;

-- Members can see groups they belong to
CREATE POLICY "chat_groups_select" ON chat_groups
  FOR SELECT TO authenticated USING (auth.uid() = ANY(member_ids));

-- Any authenticated user can create a group (must include themselves)
CREATE POLICY "chat_groups_insert" ON chat_groups
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = ANY(member_ids));

-- Creator can delete the group
CREATE POLICY "chat_groups_delete" ON chat_groups
  FOR DELETE TO authenticated USING (auth.uid() = created_by);
