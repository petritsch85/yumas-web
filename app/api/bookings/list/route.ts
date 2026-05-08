import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    // Show all inquiries that are either:
    //  - not classified as not_booking, OR
    //  - classified as not_booking but still marked draft (AI contradiction — real booking with wrong type)
    // In practice: show everything that isn't (not_booking + ignored)
    const { data, error } = await supabase
      .from('booking_inquiries')
      .select('id,from_name,from_email,subject,received_at,booking_type,party_size,requested_date,preferred_location,language,summary,status,created_at')
      .or('booking_type.neq.not_booking,status.eq.draft')
      .order('received_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
