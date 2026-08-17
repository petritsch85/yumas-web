import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { SupabaseClient } from '@supabase/supabase-js';

async function autoAssignTransactions(
  admin: SupabaseClient,
  counterpartyId: string,
  keywords: string[],
  name: string,
): Promise<number> {
  // Fetch all currently-unassigned transactions
  const { data: txs } = await admin
    .from('cashflow_transactions')
    .select('id, counterparty')
    .is('counterparty_id', null);

  if (!txs?.length) return 0;

  const terms = keywords.length > 0 ? keywords : [name];
  const matched = txs
    .filter(tx => {
      const raw = (tx.counterparty ?? '').toLowerCase();
      return terms.some(kw => kw && raw.includes(kw.toLowerCase()));
    })
    .map(tx => tx.id);

  if (!matched.length) return 0;

  await admin
    .from('cashflow_transactions')
    .update({ counterparty_id: counterpartyId })
    .in('id', matched);

  return matched.length;
}

export async function GET() {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('counterparties')
    .select('*')
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, category, default_vat_rate, notes, keywords } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const kws: string[] = Array.isArray(keywords) ? keywords.filter(Boolean) : [];

  const { data, error } = await admin
    .from('counterparties')
    .insert({
      name: name.trim(),
      category: category || null,
      default_vat_rate: default_vat_rate ?? null,
      notes: notes || null,
      keywords: kws,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const assigned = await autoAssignTransactions(admin, data.id, kws, name.trim());
  return NextResponse.json({ ...data, assigned });
}
