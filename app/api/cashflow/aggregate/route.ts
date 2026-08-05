import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// GET /api/cashflow/aggregate?dateFrom=&dateTo=
// Tries the DB-side cashflow_aggregate RPC first (run supabase/cashflow_aggregate_fn.sql to enable).
// Falls back to fetching all matching rows and aggregating in JS if the RPC doesn't exist yet.
export async function GET(req: NextRequest) {
  const p        = req.nextUrl.searchParams;
  const dateFrom = p.get('dateFrom') || null;
  const dateTo   = p.get('dateTo')   || null;

  const admin = getSupabaseAdmin();

  // Try the DB-side GROUP BY function first
  const { data, error } = await admin.rpc('cashflow_aggregate', {
    p_date_from: dateFrom,
    p_date_to:   dateTo,
  });

  if (!error) return NextResponse.json(data ?? []);

  // Fallback: fetch all matching rows (up to 10 000) and aggregate in JS
  let q = admin
    .from('cashflow_transactions')
    .select('category, direction, amount_cents')
    .range(0, 9999);
  if (dateFrom) q = q.gte('date', dateFrom);
  if (dateTo)   q = q.lte('date', dateTo);

  const { data: rows, error: err2 } = await q;
  if (err2) return NextResponse.json({ error: err2.message }, { status: 500 });

  // Group by category + direction
  const map = new Map<string, number>();
  for (const row of rows ?? []) {
    const key = `${row.category ?? ''}|||${row.direction}`;
    map.set(key, (map.get(key) ?? 0) + (row.amount_cents as number));
  }
  const result = Array.from(map.entries()).map(([key, total_cents]) => {
    const sep = key.indexOf('|||');
    const category  = key.slice(0, sep) || null;
    const direction = key.slice(sep + 3);
    return { category, direction, total_cents };
  });

  return NextResponse.json(result);
}
