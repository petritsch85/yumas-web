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
  const keywords       = p.getAll('keyword'); // repeated ?keyword=foo&keyword=bar
  const page           = Math.max(1, parseInt(p.get('page') ?? '1', 10));
  const pageSize       = Math.min(10000, parseInt(p.get('pageSize') ?? '1000', 10));

  const admin = getSupabaseAdmin();
  let q = admin
    .from('cashflow_transactions')
    .select('*, bill:bills(id, supplier_name, invoice_number, gross_amount, file_path), transaction_bill_links(id, note, bill:bills(id, supplier_name, invoice_number, gross_amount))', { count: 'exact' })
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
