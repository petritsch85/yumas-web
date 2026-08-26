import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const PAGE = 1000;

export async function GET() {
  const admin = getSupabaseAdmin();

  // PostgREST caps a single response at 1000 rows. bill_lines is well past that,
  // so an unpaged read silently returned only the oldest slice — item purchase
  // histories were missing most of their purchases.
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await admin
      .from('bill_lines')
      .select('id, description, quantity, unit_price, line_total, bill:bills(id, invoice_date, supplier_name)')
      .order('id')
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) break;
    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
  }

  // PostgREST returns the many-to-one join as either an object or array depending on SDK version.
  // Normalise to always be a plain object (or null) so the client can rely on bill.invoice_date directly.
  const normalised = rows.map((line) => ({
    ...line,
    bill: Array.isArray(line.bill)
      ? (line.bill[0] ?? null)
      : (line.bill ?? null),
  }));

  return NextResponse.json(normalised);
}
