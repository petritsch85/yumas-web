import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const uploadId       = p.get('uploadId');
  const dateFrom       = p.get('dateFrom');
  const dateTo         = p.get('dateTo');
  const direction      = p.get('direction');
  const category       = p.get('category');
  const location       = p.get('location');
  const salesType      = p.get('salesType');
  const counterpartyId = p.get('counterpartyId');
  const confirmed      = p.get('confirmed');   // 'true' | 'false' | null (= both)
  const search         = (p.get('q') ?? '').trim();
  const keywords       = p.getAll('keyword'); // repeated ?keyword=foo&keyword=bar
  const page           = Math.max(1, parseInt(p.get('page') ?? '1', 10));
  const pageSize       = Math.min(10000, parseInt(p.get('pageSize') ?? '1000', 10));

  const admin = getSupabaseAdmin();
  let q = admin
    .from('cashflow_transactions')
    // wolt_period stands in for a bill on a Wolt payout: the settlement
    // documents in Sales Reports are the evidence, and Wolt issues no invoice
    // that would ever be filed under incoming bills.
    .select('*, bill:bills(id, supplier_name, invoice_number, gross_amount, net_amount, vat_amount, file_path), transaction_bill_links(id, note, bill:bills(id, supplier_name, invoice_number, gross_amount, net_amount, vat_amount)), wolt_period:wolt_periods(invoice_number, restaurant, period_start, period_end, payout_net, net_sales_pre_ads, sales_vat)', { count: 'exact' })
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (uploadId)  q = q.eq('upload_id', uploadId);
  if (dateFrom)  q = q.gte('date', dateFrom);
  if (dateTo)    q = q.lte('date', dateTo);
  if (direction) q = q.eq('direction', direction);
  if (category && category !== 'All')  q = q.eq('category', category);
  if (location && location !== 'All')  q = q.eq('location', location);
  if (salesType && salesType !== 'All') q = q.eq('sales_type', salesType);
  // Split the review queue from the settled ledger. Older rows may predate the
  // column default, so treat NULL as unconfirmed.
  if (confirmed === 'true')  q = q.eq('confirmed', true);
  if (confirmed === 'false') q = q.or('confirmed.is.null,confirmed.eq.false');

  /* Free-text search across the two fields a person actually reads. A bank
     export names the same money in different ways — a Wolt Capital drawdown
     arrives as "MIR Lux Capital . Wolt" — so the description has to be
     searchable too, not just the counterparty. */
  if (search) {
    const safe = search.replace(/[%,()]/g, ' ').trim();
    if (safe) q = q.or(`counterparty.ilike.%${safe}%,description.ilike.%${safe}%`);
  }

  // Counterparty filter: match by pinned id OR by any keyword (ilike)
  if (counterpartyId || keywords.length > 0) {
    const orParts: string[] = [];
    if (counterpartyId) orParts.push(`counterparty_id.eq.${counterpartyId}`);
    for (const kw of keywords) {
      if (kw) orParts.push(`counterparty.ilike.%${kw}%`);
    }
    if (orParts.length > 0) q = q.or(orParts.join(','));
  }

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [], count: count ?? 0, page, pageSize });
}

/**
 * PATCH /api/cashflow/transactions — applies one change to many rows.
 *
 * Confirming a review queue one row at a time means one request and one
 * refetch per row. This takes the whole selection in a single update so a
 * batch of twenty settles as fast as one.
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const ids: unknown = body.ids;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'No transactions selected.' }, { status: 400 });
  }
  if (ids.some(id => typeof id !== 'string')) {
    return NextResponse.json({ error: 'Invalid transaction id.' }, { status: 400 });
  }

  const allowed = ['category', 'location', 'sales_type', 'notes', 'bill_id', 'confirmed', 'counterparty_id', 'accounting_period'] as const;
  const update: Record<string, string | boolean | null> = {};
  for (const key of allowed) {
    if (body.patch?.[key] !== undefined) update[key] = body.patch[key];
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true, updated: 0 });

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('cashflow_transactions')
    .update(update)
    .in('id', ids as string[]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated: ids.length });
}
