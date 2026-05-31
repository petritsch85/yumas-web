-- ─── Chat Messages ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  room        text        NOT NULL,
  sender_id   uuid        NOT NULL REFERENCES auth.users(id),
  sender_name text        NOT NULL,
  content     text,
  media_url   text,
  media_type  text,        -- 'image' | 'video' | null
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_room_idx
  ON chat_messages (room, created_at ASC);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_select" ON chat_messages
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "chat_insert" ON chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id);

-- Enable Supabase Realtime on this table
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;


-- ─── Read Markers (for unread badges) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_read_markers (
  user_id      uuid        NOT NULL REFERENCES auth.users(id),
  room         text        NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, room)
);

ALTER TABLE chat_read_markers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_markers_select" ON chat_read_markers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "read_markers_insert" ON chat_read_markers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "read_markers_update" ON chat_read_markers
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);


-- ─── Storage Bucket for Chat Media ───────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  true,
  20971520,   -- 20 MB limit per file
  ARRAY['image/jpeg','image/png','image/gif','image/webp','image/heic',
        'video/mp4','video/quicktime','video/webm']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "chat_media_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-media');

CREATE POLICY "chat_media_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'chat-media');
