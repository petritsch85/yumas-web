import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET() {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('bill_lines')
    .select('id, description, quantity, unit_price, line_total, bill:bills(id, invoice_date, supplier_name)');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // PostgREST returns the many-to-one join as either an object or array depending on SDK version.
  // Normalise to always be a plain object (or null) so the client can rely on bill.invoice_date directly.
  const normalised = (data ?? []).map((line: Record<string, unknown>) => ({
    ...line,
    bill: Array.isArray(line.bill)
      ? (line.bill[0] ?? null)
      : (line.bill ?? null),
  }));

  return NextResponse.json(normalised);
}
