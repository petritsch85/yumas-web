import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getUserId(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  return data.user?.id ?? null;
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { endpoint, p256dh, auth } = await req.json();
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  await supabaseAdmin.from('push_subscriptions').upsert(
    { user_id: userId, endpoint, p256dh, auth },
    { onConflict: 'user_id,endpoint' },
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { endpoint } = await req.json();
  if (!endpoint) return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 });

  await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', endpoint);

  return NextResponse.json({ ok: true });
}
