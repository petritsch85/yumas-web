import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function POST(req: NextRequest) {
  const { transactionId, billIds, note } = await req.json();
  if (!transactionId || !Array.isArray(billIds) || billIds.length === 0) {
    return NextResponse.json({ error: 'transactionId and billIds required' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();
  const rows = billIds.map((bill_id: string) => ({
    transaction_id: transactionId,
    bill_id,
    note: note?.trim() || null,
  }));
  const { error } = await admin.from('transaction_bill_links').upsert(rows, { onConflict: 'transaction_id,bill_id', ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
