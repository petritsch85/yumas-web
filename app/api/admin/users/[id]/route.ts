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
    const { role, locationId, isActive, permissions, newPassword, newEmail, language } = await request.json();

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
    if (language) updatePayload.language = language;

    const { error } = await admin
      .from('profiles')
      .update(updatePayload)
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Optionally update auth fields (email and/or password)
    const authUpdate: Record<string, any> = {};
    if (newEmail?.trim()) authUpdate.email = newEmail.trim();
    if (newPassword?.trim()) {
      if (newPassword.trim().length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
      }
      authUpdate.password = newPassword.trim();
    }
    if (Object.keys(authUpdate).length > 0) {
      const { error: authErr } = await admin.auth.admin.updateUserById(id, authUpdate);
      if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
