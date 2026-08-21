import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const uploadId  = p.get('uploadId');
  const dateFrom  = p.get('dateFrom');
  const dateTo    = p.get('dateTo');
  const direction = p.get('direction');
  const category  = p.get('category');
  const location  = p.get('location');
  const salesType = p.get('salesType');
  const page      = Math.max(1, parseInt(p.get('page') ?? '1', 10));
  const pageSize  = Math.min(10000, parseInt(p.get('pageSize') ?? '1000', 10));

  const admin = getSupabaseAdmin();
  let q = admin
    .from('cashflow_transactions')
    .select('*, bill:bills(id, supplier_name, invoice_number, gross_amount, file_path)', { count: 'exact' })
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

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [], count: count ?? 0, page, pageSize });
}
