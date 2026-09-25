import { getSupabaseAdmin } from '@/lib/supabase-admin';

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * A bill linked to a cash flow has been paid: the bank shows the money
 * leaving. Every place that links one — a single row on the Cash Flow page,
 * a transfer covering several bills, auto-match — marks it Paid here.
 */
export async function markBillsPaid(admin: Admin, billIds: (string | null | undefined)[]) {
  const ids = [...new Set(billIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;
  await admin.from('bills').update({ status: 'paid' }).in('id', ids).neq('status', 'paid');
}

/**
 * When a link is removed, a bill that no longer has any cash flow behind it
 * goes back to Approved — it was approved to be paid, and now is not shown
 * as paid by anything. A bill still linked elsewhere stays Paid.
 */
export async function unmarkBillsIfUnlinked(admin: Admin, billIds: (string | null | undefined)[]) {
  const ids = [...new Set(billIds.filter((id): id is string => !!id))];
  for (const id of ids) {
    const [{ count: direct }, { count: multi }] = await Promise.all([
      admin.from('cashflow_transactions').select('id', { count: 'exact', head: true }).eq('bill_id', id),
      admin.from('transaction_bill_links').select('id', { count: 'exact', head: true }).eq('bill_id', id),
    ]);
    if (!direct && !multi) {
      await admin.from('bills').update({ status: 'approved' }).eq('id', id).eq('status', 'paid');
    }
  }
}
