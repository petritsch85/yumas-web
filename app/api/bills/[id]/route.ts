import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function billToAccountingPeriod(
  period_type: string | null,
  period_start: string | null,
  period_end: string | null,
): string | null {
  if (!period_start) return null;
  switch (period_type) {
    case 'single_date': return `one-off|${period_start}`;
    case 'month':       return `monthly|${period_start.slice(0, 7)}`;
    case 'year':        return `annual|${period_start.slice(0, 7)}|${(period_end ?? period_start).slice(0, 7)}`;
    case 'custom':      return period_end ? `custom|${period_start}|${period_end}` : `one-off|${period_start}`;
    default:            return null;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const admin = getSupabaseAdmin();

  const update: Record<string, string | null> = {};
  if (body.period_type  !== undefined) update.period_type  = body.period_type;
  if (body.period_start !== undefined) update.period_start = body.period_start;
  if (body.period_end   !== undefined) update.period_end   = body.period_end;

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true });

  const { error } = await admin.from('bills').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Propagate updated period to all linked cash flows (best-effort)
  try {
    const ap = billToAccountingPeriod(
      body.period_type ?? null,
      body.period_start ?? null,
      body.period_end ?? null,
    );
    if (ap) {
      const [{ data: direct }, { data: junction }] = await Promise.all([
        admin.from('cashflow_transactions').select('id').eq('bill_id', id),
        admin.from('transaction_bill_links').select('transaction_id').eq('bill_id', id),
      ]);
      const txIds = [
        ...(direct  ?? []).map((r: any) => r.id),
        ...(junction ?? []).map((r: any) => r.transaction_id),
      ];
      if (txIds.length > 0) {
        await admin
          .from('cashflow_transactions')
          .update({ accounting_period: ap })
          .in('id', txIds);
      }
    }
  } catch {
    // Non-fatal
  }

  return NextResponse.json({ ok: true });
}
