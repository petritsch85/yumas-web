import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('gmail_credentials')
      .select('id,email,created_at,updated_at,token_expiry')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return NextResponse.json({ connected: !!data, credential: data ?? null });
  } catch (err: any) {
    return NextResponse.json({ connected: false, credential: null, error: err.message });
  }
}
