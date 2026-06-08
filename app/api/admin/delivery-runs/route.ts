import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function PATCH(request: Request) {
  try {
    const { runId, skippedStores } = await request.json();
    if (!runId || !Array.isArray(skippedStores)) {
      return NextResponse.json({ error: 'Missing runId or skippedStores' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('delivery_runs')
      .update({ skipped_stores: skippedStores })
      .eq('id', runId);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
