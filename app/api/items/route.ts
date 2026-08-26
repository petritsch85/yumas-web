import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET() {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('purchased_goods').select('*').order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, keywords, primary_supplier_id, secondary_supplier_ids, kg_per_unit, category } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('purchased_goods').insert({
    name:                   name.trim(),
    keywords:               Array.isArray(keywords) ? keywords.filter(Boolean) : [],
    primary_supplier_id:    primary_supplier_id || null,
    secondary_supplier_ids: Array.isArray(secondary_supplier_ids) ? secondary_supplier_ids : [],
    kg_per_unit:            kg_per_unit != null && kg_per_unit !== '' ? Number(kg_per_unit) : null,
    category:               category?.trim() || null,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
