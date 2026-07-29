import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// GET /api/cashflow/aggregate?dateFrom=&dateTo=
// Returns all rows (category, direction, amount_cents only) with no page limit
// Used by the P&L summary table so counts are always exact regardless of transaction volume
export async function GET(req: NextRequest) {
  const p        = req.nextUrl.searchParams;
  const dateFrom = p.get('dateFrom');
  const dateTo   = p.get('dateTo');

  const admin = getSupabaseAdmin();
  let q = admin
    .from('cashflow_transactions')
    .select('category, direction, amount_cents');

  if (dateFrom) q = q.gte('date', dateFrom);
  if (dateTo)   q = q.lte('date', dateTo);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
