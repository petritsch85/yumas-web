import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET() {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('counterparties')
    .select('*')
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, category, default_vat_rate, notes, keywords } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('counterparties')
    .insert({
      name: name.trim(),
      category: category || null,
      default_vat_rate: default_vat_rate ?? null,
      notes: notes || null,
      keywords: Array.isArray(keywords) ? keywords.filter(Boolean) : [],
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
