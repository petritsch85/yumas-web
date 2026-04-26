import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// Returns a map of { [userId]: email } for all auth users
export async function GET() {
  try {
    const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({ perPage: 1000 });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const emailMap: Record<string, string> = {};
    for (const user of data.users) {
      if (user.email) emailMap[user.id] = user.email;
    }
    return NextResponse.json(emailMap);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { fullName, email, password, role, locationId } = await request.json();

    if (!fullName || !email || !password || !role) {
      return NextResponse.json({ error: 'Name, email, password and role are required' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // Create the Supabase auth user (auto-confirmed — no email verification needed)
    const { data, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    // Upsert the profile row (a trigger may have already created one)
    const { error: profileError } = await admin
      .from('profiles')
      .upsert(
        {
          id: data.user.id,
          full_name: fullName,
          role,
          location_id: locationId || null,
          is_active: true,
        },
        { onConflict: 'id' }
      );

    if (profileError) {
      // Roll back the auth user if profile fails
      await admin.auth.admin.deleteUser(data.user.id);
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, userId: data.user.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
