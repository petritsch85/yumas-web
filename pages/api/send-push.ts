import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.PUSH_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const record = req.body?.record ?? req.body;
    const { user_id, title, body: notifBody, type } = record ?? {};

    if (!user_id) return res.status(200).json({ ok: true, reason: 'no user_id' });

    const { createClient } = await import('@supabase/supabase-js');
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', user_id);

    if (!subs?.length) return res.status(200).json({ ok: true, reason: 'no subscriptions' });

    const webpush = require('web-push');
    webpush.setVapidDetails(
      'mailto:benpeters2000@googlemail.com',
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );

    const payload = JSON.stringify({ title, body: notifBody, url: '/chat', tag: type });

    const results = await Promise.allSettled(
      subs.map((sub: { endpoint: string; p256dh: string; auth: string }) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        ).catch(async (err: { statusCode?: number }) => {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
          throw err;
        })
      ),
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const errors = results
      .filter((r) => r.status === 'rejected')
      .map((r) => String((r as PromiseRejectedResult).reason));

    return res.status(200).json({ ok: true, sent, errors });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
