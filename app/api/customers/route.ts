import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// GET /api/customers?q=search_term
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  if (q.length < 2) return NextResponse.json([]);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('customers')
    .select('id,company_name,extra_line,contact_name,street,postcode,city,po_number,att,updated_at')
    .ilike('company_name', `%${q}%`)
    .order('company_name')
    .limit(8);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/customers — upsert by company_name
export async function POST(req: NextRequest) {
  try {
    const { company_name, extra_line, contact_name, street, postcode, city, po_number, att } = await req.json();
    if (!company_name?.trim()) {
      return NextResponse.json({ error: 'company_name required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('customers')
      .upsert({
        company_name: company_name.trim(),
        extra_line:   extra_line   || null,
        contact_name: contact_name || null,
        street:       street       || null,
        postcode:     postcode     || null,
        city:         city         || null,
        po_number:    po_number    || null,
        att:          att          || null,
        updated_at:   new Date().toISOString(),
      }, { onConflict: 'company_name' });

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
