import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// POST /api/notifications — create a notification for any user
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { user_id, type, title, body: notifBody, metadata } = body;
  if (!user_id || !type || !title) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('notifications').insert({ user_id, type, title, body: notifBody, metadata: metadata ?? {} });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// PATCH /api/notifications — mark one or all notifications as read
// Body: { id: string | 'all', user_id: string }
export async function PATCH(req: NextRequest) {
  const { id, user_id } = await req.json();
  if (!user_id) return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
  const admin = getSupabaseAdmin();
  let error;
  if (id === 'all') {
    ({ error } = await admin.from('notifications').update({ read: true }).eq('user_id', user_id).eq('read', false));
  } else {
    ({ error } = await admin.from('notifications').update({ read: true }).eq('id', id).eq('user_id', user_id));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
