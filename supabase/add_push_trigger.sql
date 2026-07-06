-- ─── Push notification trigger via pg_net ────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION call_push_on_notification()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://yumas-web.vercel.app/api/send-push',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-webhook-secret',  'yumas-push-secret-2026'
    ),
    body    := row_to_json(NEW)::jsonb
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'call_push_on_notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS push_on_notification_insert ON notifications;
CREATE TRIGGER push_on_notification_insert
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION call_push_on_notification();
