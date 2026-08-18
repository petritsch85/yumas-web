import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET() {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('bill_lines')
    .select('id, description, quantity, unit_price, line_total, bill:bills(id, invoice_date, supplier_name)');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
