import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { unmarkBillsIfUnlinked } from '@/lib/bill-payment-status';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = getSupabaseAdmin();
  const { data: link } = await admin.from('transaction_bill_links').select('bill_id').eq('id', id).single();
  const { error } = await admin.from('transaction_bill_links').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await unmarkBillsIfUnlinked(admin, [link?.bill_id]);
  return NextResponse.json({ ok: true });
}
