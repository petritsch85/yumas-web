-- ─── Trigger: notify assignees when a task is created ────────────────────────
CREATE OR REPLACE FUNCTION notify_task_assignees()
RETURNS TRIGGER AS $$
DECLARE
  assignee_id uuid;
  creator_name text;
  priority_label text;
BEGIN
  BEGIN
    SELECT raw_user_meta_data->>'full_name' INTO creator_name
    FROM auth.users WHERE id = NEW.created_by;

    priority_label := COALESCE(NEW.priority, 'medium');

    IF NEW.assignee_ids IS NOT NULL AND array_length(NEW.assignee_ids, 1) > 0 THEN
      FOREACH assignee_id IN ARRAY NEW.assignee_ids
      LOOP
        IF assignee_id IS DISTINCT FROM NEW.created_by THEN
          INSERT INTO notifications (user_id, type, title, body, metadata)
          VALUES (
            assignee_id,
            'task_assigned',
            'New task assigned to you',
            '"' || NEW.title || '" — priority: ' || priority_label
              || CASE WHEN NEW.deadline IS NOT NULL THEN ', due ' || NEW.deadline::text ELSE '' END
              || CASE WHEN creator_name IS NOT NULL THEN ' (from ' || creator_name || ')' ELSE '' END,
            jsonb_build_object('task_id', NEW.id, 'room', NEW.room)
          );
        END IF;
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Never block the task INSERT even if notification fails
    RAISE WARNING 'notify_task_assignees failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS task_assigned_notification ON room_tasks;
CREATE TRIGGER task_assigned_notification
  AFTER INSERT ON room_tasks
  FOR EACH ROW EXECUTE FUNCTION notify_task_assignees();


-- ─── Trigger: notify creator when a task is marked done ──────────────────────
CREATE OR REPLACE FUNCTION notify_task_done()
RETURNS TRIGGER AS $$
DECLARE
  doer_name text;
BEGIN
  BEGIN
    IF OLD.completed = false AND NEW.completed = true
      AND NEW.created_by IS NOT NULL
      AND NEW.done_by IS NOT NULL
      AND NEW.done_by IS DISTINCT FROM NEW.created_by
    THEN
      SELECT raw_user_meta_data->>'full_name' INTO doer_name
      FROM auth.users WHERE id = NEW.done_by;

      INSERT INTO notifications (user_id, type, title, body, metadata)
      VALUES (
        NEW.created_by,
        'task_done',
        'Task marked as done',
        '"' || NEW.title || '" was completed by ' || COALESCE(doer_name, 'someone')
          || CASE WHEN NEW.done_comment IS NOT NULL THEN ': "' || NEW.done_comment || '"' ELSE '' END,
        jsonb_build_object('task_id', NEW.id, 'room', NEW.room)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_task_done failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS task_done_notification ON room_tasks;
CREATE TRIGGER task_done_notification
  AFTER UPDATE ON room_tasks
  FOR EACH ROW EXECUTE FUNCTION notify_task_done();
