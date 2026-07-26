import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();

  const allowed = ['category', 'location', 'sales_type', 'notes', 'bill_id', 'confirmed'] as const;
  const update: Record<string, string | boolean | null> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true });

  const admin = getSupabaseAdmin();
  const { error } = await admin.from('cashflow_transactions').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
