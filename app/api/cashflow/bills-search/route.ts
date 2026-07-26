import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const q           = (p.get('q') ?? '').trim().toLowerCase();
  const amountCents = parseInt(p.get('amountCents') ?? '0', 10);

  const admin = getSupabaseAdmin();

  let query = admin
    .from('bills')
    .select('id, supplier_name, invoice_number, invoice_date, gross_amount, net_amount, category, location_label, status')
    .order('invoice_date', { ascending: false })
    .limit(50);

  if (q) {
    query = query.or(`supplier_name.ilike.%${q}%,invoice_number.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Score by amount proximity if provided
  let results = data ?? [];
  if (amountCents > 0) {
    results = results
      .map(b => {
        const billCents = Math.round((b.gross_amount ?? 0) * 100);
        const diff = Math.abs(billCents - amountCents);
        const score = diff === 0 ? 1000 : Math.max(0, 100 - Math.round((diff / amountCents) * 100));
        return { ...b, _score: score };
      })
      .sort((a, b) => b._score - a._score);
  }

  return NextResponse.json(results);
}
