import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { role, locationId, isActive, permissions } = await request.json();

    const updatePayload: Record<string, any> = {
      role,
      location_id: locationId || null,
      is_active: isActive,
    };
    if (permissions !== undefined) {
      updatePayload.permissions = permissions;
    }

    const { error } = await getSupabaseAdmin()
      .from('profiles')
      .update(updatePayload)
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
