import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// GET /api/chat/channels?userId=<id>
// Returns all chat_channels the given user has access to, based on profile.chat_rooms.
// Uses the admin client so RLS does not filter out channels the user was given
// access to via Settings (profile.chat_rooms) but is not yet in member_ids.
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

  const admin = getSupabaseAdmin();

  // Get the user's chat_rooms list
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('chat_rooms, role')
    .eq('id', userId)
    .single();

  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });

  // Admins see all channels
  if (profile?.role === 'admin') {
    const { data, error } = await admin
      .from('chat_channels')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  }

  const allowedIds: string[] = profile?.chat_rooms ?? [];
  if (allowedIds.length === 0) return NextResponse.json([]);

  const { data, error } = await admin
    .from('chat_channels')
    .select('*')
    .in('id', allowedIds)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
