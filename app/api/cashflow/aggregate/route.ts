import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// GET /api/cashflow/aggregate?dateFrom=&dateTo=
// Calls a DB-side GROUP BY function — returns one row per category/direction pair,
// bypassing PostgREST's default 1000-row limit entirely.
export async function GET(req: NextRequest) {
  const p        = req.nextUrl.searchParams;
  const dateFrom = p.get('dateFrom') || null;
  const dateTo   = p.get('dateTo')   || null;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('cashflow_aggregate', {
    p_date_from: dateFrom,
    p_date_to:   dateTo,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
