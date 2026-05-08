import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    // Show draft + sent inquiries (all real bookings regardless of type)
    // Ignored items are hidden — they include not_booking spam/newsletters
    const { data, error } = await supabase
      .from('booking_inquiries')
      .select('id,from_name,from_email,subject,received_at,booking_type,party_size,requested_date,preferred_location,language,summary,status,created_at')
      .in('status', ['draft', 'sent'])
      .order('received_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
