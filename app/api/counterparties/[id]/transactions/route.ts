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

  function applyDates(q: any): any {
    if (dateFrom) q = q.gte('date', dateFrom);
    if (dateTo)   q = q.lte('date', dateTo);
    return q;
  }

  // Query 1: transactions pinned to this counterparty (counterparty_id = id)
  const { data: pinned, error: e1 } = await applyDates(
    admin.from('cashflow_transactions').select(SELECT).eq('counterparty_id', id)
      .order('date', { ascending: false }).order('created_at', { ascending: false })
  );
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  const seenIds = new Set((pinned ?? []).map((r: any) => r.id));

  // Query 2: for each keyword, ilike search — no counterparty_id restriction
  const keywordRows: any[] = [];
  const kwDebug: Record<string, number> = {};
  for (const kw of keywords.filter(Boolean)) {
    const { data: kRows, error: e2 } = await applyDates(
      admin.from('cashflow_transactions').select(SELECT).ilike('counterparty', `%${kw}%`)
        .order('date', { ascending: false }).order('created_at', { ascending: false })
    );
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
    kwDebug[kw] = (kRows ?? []).length;
    for (const row of kRows ?? []) {
      if (!seenIds.has(row.id)) {
        keywordRows.push(row);
        seenIds.add(row.id);
      }
    }
  }

  const combined = [...(pinned ?? []), ...keywordRows].sort(
    (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)
  );

  // Debug: also fetch raw Jan 2026 transactions to inspect counterparty field values
  const { data: jan } = await admin
    .from('cashflow_transactions')
    .select('id, date, counterparty, counterparty_id, amount_cents')
    .gte('date', '2026-01-01')
    .lte('date', '2026-01-31')
    .lt('amount_cents', 0)
    .order('date', { ascending: true });

  return NextResponse.json({
    data: combined,
    count: combined.length,
    _debug: {
      counterpartyId: id,
      keywords,
      pinnedCount: (pinned ?? []).length,
      kwDebug,
      jan2026Txs: (jan ?? []).map((r: any) => ({ date: r.date, counterparty: r.counterparty, counterparty_id: r.counterparty_id, amount_cents: r.amount_cents })),
    },
  });
}
