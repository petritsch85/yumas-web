-- 1. Add chat_rooms column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS chat_rooms TEXT[] NOT NULL DEFAULT '{}';

-- 2. Drop old permissive chat policies
DROP POLICY IF EXISTS "chat_select"    ON chat_messages;
DROP POLICY IF EXISTS "chat_insert"    ON chat_messages;
DROP POLICY IF EXISTS "chat_select_v2" ON chat_messages;
DROP POLICY IF EXISTS "chat_insert_v2" ON chat_messages;

-- 3. New SELECT policy:
--    • DM rooms  → both participants can always read
--    • Regular rooms → user must have the room in their chat_rooms array, OR be admin
CREATE POLICY "chat_select_v2" ON chat_messages
  FOR SELECT TO authenticated
  USING (
    -- DM: room id contains the caller's user-id
    (room LIKE 'dm::%' AND room LIKE '%' || auth.uid()::text || '%')
    OR
    -- Regular room: the caller has it in their chat_rooms, or is admin
    (room NOT LIKE 'dm::%' AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR room = ANY(p.chat_rooms))
    ))
  );

-- 4. New INSERT policy (same access check + must be the sender)
CREATE POLICY "chat_insert_v2" ON chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND (
      (room LIKE 'dm::%' AND room LIKE '%' || auth.uid()::text || '%')
      OR
      (room NOT LIKE 'dm::%' AND EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
          AND (p.role = 'admin' OR room = ANY(p.chat_rooms))
      ))
    )
  );
