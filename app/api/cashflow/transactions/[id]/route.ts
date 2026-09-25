import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();

  const allowed = ['category', 'location', 'sales_type', 'notes', 'bill_id', 'outgoing_bill_id', 'confirmed', 'counterparty_id', 'accounting_period'] as const;
  const update: Record<string, string | boolean | null> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true });

  const admin = getSupabaseAdmin();

  /* Linking a credit to one of our own invoices is the payment of that
     invoice, so the invoice's status follows the link — the same as when the
     match is applied from the Outgoing Bills page. */
  let previousOutgoing: string | null = null;
  if (update.outgoing_bill_id !== undefined) {
    const { data: before } = await admin
      .from('cashflow_transactions').select('outgoing_bill_id').eq('id', id).single();
    previousOutgoing = before?.outgoing_bill_id ?? null;
  }

  const { error } = await admin.from('cashflow_transactions').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (update.outgoing_bill_id !== undefined) {
    const next = update.outgoing_bill_id as string | null;
    if (next) {
      await admin.from('outgoing_bills').update({ status: 'paid' }).eq('id', next).eq('status', 'pending');
    }
    /* The invoice this credit no longer pays goes back to pending — unless
       another credit still pays it (a customer who paid in two parts). */
    if (previousOutgoing && previousOutgoing !== next) {
      const { count } = await admin
        .from('cashflow_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('outgoing_bill_id', previousOutgoing);
      if (!count) {
        await admin.from('outgoing_bills').update({ status: 'pending' }).eq('id', previousOutgoing).eq('status', 'paid');
      }
    }
  }

  return NextResponse.json({ ok: true });
}
