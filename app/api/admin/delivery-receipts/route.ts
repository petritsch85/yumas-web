import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function DELETE(request: Request) {
  try {
    const { runId, locationName } = await request.json();
    if (!runId || !locationName) {
      return NextResponse.json({ error: 'Missing runId or locationName' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('store_delivery_receipts')
      .delete()
      .eq('run_id', runId)
      .eq('location_name', locationName);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
