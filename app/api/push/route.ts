import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  webpush.setVapidDetails(
    'mailto:benpeters2000@googlemail.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  const secret = req.headers.get('x-webhook-secret');
  if (secret !== process.env.PUSH_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  // Supabase webhook sends: { type, table, record, old_record, schema }
  const record = body.record ?? body;
  const { user_id, title, body: notifBody, type, metadata } = record;

  if (!user_id) return NextResponse.json({ ok: true });

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', user_id);

  if (!subs?.length) return NextResponse.json({ ok: true });

  const url = metadata?.room
    ? `/chat`
    : type === 'task_assigned' || type === 'task_done'
    ? '/chat'
    : '/chat';

  const payload = JSON.stringify({ title, body: notifBody, url, tag: type });

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      ).catch(async (err) => {
        // Subscription expired/invalid — remove it
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabaseAdmin
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint);
        }
        throw err;
      })
    ),
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return NextResponse.json({ ok: true, sent });
}
