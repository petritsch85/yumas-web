import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const q           = (p.get('q') ?? '').trim().toLowerCase();
  const amountCents = parseInt(p.get('amountCents') ?? '0', 10);
  // A credit is paid against one of our own invoices, a debit against a supplier's
  const outgoing    = p.get('direction') === 'in';

  const admin = getSupabaseAdmin();

  let results: Record<string, any>[];

  if (outgoing) {
    let query = admin
      .from('outgoing_bills')
      .select('id, customer_name, invoice_number, invoice_date, total_payable, net_total, issuing_location, status')
      .neq('status', 'cancelled')
      .order('invoice_date', { ascending: false })
      .limit(50);
    if (q) query = query.or(`customer_name.ilike.%${q}%,invoice_number.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Shaped like a supplier bill so the one picker lists both
    results = (data ?? []).map(b => ({
      id:             b.id,
      kind:           'outgoing',
      supplier_name:  b.customer_name,
      invoice_number: b.invoice_number,
      invoice_date:   b.invoice_date,
      gross_amount:   Number(b.total_payable) || 0,
      net_amount:     Number(b.net_total) || 0,
      category:       'Outgoing invoice',
      location_label: b.issuing_location,
      status:         b.status,
    }));
  } else {
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
    results = data ?? [];
  }

  // Score by amount proximity if provided
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
