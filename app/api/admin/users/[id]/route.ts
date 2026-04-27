import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = getSupabaseAdmin();

    // Delete profile row first (FK may block auth deletion otherwise)
    await admin.from('profiles').delete().eq('id', id);

    // Delete the Supabase Auth user (permanent)
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { role, locationId, isActive, permissions, newPassword } = await request.json();

    const admin = getSupabaseAdmin();

    // Update profile fields
    const updatePayload: Record<string, any> = {
      role,
      location_id: locationId || null,
      is_active: isActive,
    };
    if (permissions !== undefined) {
      updatePayload.permissions = permissions;
    }

    const { error } = await admin
      .from('profiles')
      .update(updatePayload)
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Optionally reset password
    if (newPassword) {
      if (newPassword.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
      }
      const { error: pwError } = await admin.auth.admin.updateUserById(id, { password: newPassword });
      if (pwError) {
        return NextResponse.json({ error: pwError.message }, { status: 400 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
