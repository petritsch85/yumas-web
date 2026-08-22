import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const SELECT = '*, bill:bills(id, supplier_name, invoice_number, gross_amount, file_path)';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p        = req.nextUrl.searchParams;
  const dateFrom = p.get('dateFrom');
  const dateTo   = p.get('dateTo');
  const keywords = p.getAll('keyword');

  const admin = getSupabaseAdmin();

  function applyDateFilters(q: ReturnType<typeof admin.from>) {
    if (dateFrom) q = (q as any).gte('date', dateFrom);
    if (dateTo)   q = (q as any).lte('date', dateTo);
    return q;
  }

  // Query 1: transactions pinned to this counterparty (counterparty_id = id)
  let q1 = admin
    .from('cashflow_transactions')
    .select(SELECT)
    .eq('counterparty_id', id)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  q1 = applyDateFilters(q1 as any) as any;
  const { data: pinned, error: e1 } = await (q1 as any);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  const pinnedIds = new Set((pinned ?? []).map((r: any) => r.id));

  // Query 2: for each keyword, ilike search on counterparty name
  const keywordRows: any[] = [];
  for (const kw of keywords.filter(Boolean)) {
    let q2 = admin
      .from('cashflow_transactions')
      .select(SELECT)
      .ilike('counterparty', `%${kw}%`)
      .is('counterparty_id', null) // only unlinked ones (avoid duplicates with pinned)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });
    q2 = applyDateFilters(q2 as any) as any;
    const { data: kRows, error: e2 } = await (q2 as any);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
    for (const row of kRows ?? []) {
      if (!pinnedIds.has(row.id)) {
        keywordRows.push(row);
        pinnedIds.add(row.id);
      }
    }
  }

  const combined = [...(pinned ?? []), ...keywordRows].sort(
    (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)
  );

  return NextResponse.json({ data: combined, count: combined.length });
}
