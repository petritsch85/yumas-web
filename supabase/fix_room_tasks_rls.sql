-- ─── Fix room_tasks RLS ───────────────────────────────────────────────────────
-- Allow all authenticated users to see ALL tasks in any room.
-- Previously restricted to creator only, which hid tasks from assignees.

-- Drop any existing SELECT policy (ignore error if it doesn't exist)
DROP POLICY IF EXISTS "tasks_select" ON room_tasks;
DROP POLICY IF EXISTS "room_tasks_select" ON room_tasks;
DROP POLICY IF EXISTS "tasks_select_own" ON room_tasks;

-- All authenticated users can read all tasks
CREATE POLICY "tasks_select_all" ON room_tasks
  FOR SELECT TO authenticated USING (true);

-- Allow creator to insert
DROP POLICY IF EXISTS "tasks_insert" ON room_tasks;
DROP POLICY IF EXISTS "room_tasks_insert" ON room_tasks;

CREATE POLICY "tasks_insert" ON room_tasks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

-- Allow creator OR any assignee to update (mark done, add done_comment, etc.)
DROP POLICY IF EXISTS "tasks_update" ON room_tasks;
DROP POLICY IF EXISTS "room_tasks_update" ON room_tasks;

CREATE POLICY "tasks_update" ON room_tasks
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = created_by
    OR auth.uid() = ANY(coalesce(assignee_ids, '{}'))
  );

-- Allow creator to delete
DROP POLICY IF EXISTS "tasks_delete" ON room_tasks;
DROP POLICY IF EXISTS "room_tasks_delete" ON room_tasks;

CREATE POLICY "tasks_delete" ON room_tasks
  FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- Make sure RLS is enabled (idempotent)
ALTER TABLE room_tasks ENABLE ROW LEVEL SECURITY;
