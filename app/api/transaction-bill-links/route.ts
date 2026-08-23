import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/** Convert bill period_type + period_start + period_end to accounting_period string */
function billToAccountingPeriod(
  period_type: string | null,
  period_start: string | null,
  period_end: string | null,
): string | null {
  if (!period_start) return null;
  switch (period_type) {
    case 'single_date': return `one-off|${period_start}`;
    case 'month': {
      // Derive YYYY-MM from the start date
      const ym = period_start.slice(0, 7);
      return `monthly|${ym}`;
    }
    case 'year': {
      const ym = period_start.slice(0, 7);
      const ymEnd = period_end ? period_end.slice(0, 7) : `${period_start.slice(0, 4)}-12`;
      return `annual|${ym}|${ymEnd}`;
    }
    case 'custom':
      return period_end ? `custom|${period_start}|${period_end}` : `one-off|${period_start}`;
    default:
      return null;
  }
}

export async function POST(req: NextRequest) {
  const { transactionId, billIds, note } = await req.json();
  if (!transactionId || !Array.isArray(billIds) || billIds.length === 0) {
    return NextResponse.json({ error: 'transactionId and billIds required' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();

  // Insert junction links
  const rows = billIds.map((bill_id: string) => ({
    transaction_id: transactionId,
    bill_id,
    note: note?.trim() || null,
  }));
  const { error } = await admin
    .from('transaction_bill_links')
    .upsert(rows, { onConflict: 'transaction_id,bill_id', ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-set accounting_period on the transaction if it has none and the bill has a period
  try {
    const { data: tx } = await admin
      .from('cashflow_transactions')
      .select('accounting_period')
      .eq('id', transactionId)
      .single();

    if (!tx?.accounting_period) {
      // Only auto-set when linking exactly one bill (unambiguous period)
      if (billIds.length === 1) {
        const { data: bill } = await admin
          .from('bills')
          .select('period_type, period_start, period_end')
          .eq('id', billIds[0])
          .single();

        const ap = bill ? billToAccountingPeriod(bill.period_type, bill.period_start, bill.period_end) : null;
        if (ap) {
          await admin
            .from('cashflow_transactions')
            .update({ accounting_period: ap })
            .eq('id', transactionId);
        }
      }
    }
  } catch {
    // Non-fatal — linking succeeded, period auto-set is best-effort
  }

  return NextResponse.json({ ok: true });
}
