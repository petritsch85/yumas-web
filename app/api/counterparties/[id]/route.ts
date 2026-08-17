import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { SupabaseClient } from '@supabase/supabase-js';

async function autoAssignTransactions(
  admin: SupabaseClient,
  counterpartyId: string,
  keywords: string[],
  name: string,
): Promise<number> {
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('counterparties').select('*').eq('id', id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, category, default_vat_rate, notes, keywords } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const kws: string[] = Array.isArray(keywords) ? keywords.filter(Boolean) : [];

  const { data, error } = await admin
    .from('counterparties')
    .update({
      name: name.trim(),
      category: category || null,
      default_vat_rate: default_vat_rate ?? null,
      notes: notes || null,
      keywords: kws,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const assigned = await autoAssignTransactions(admin, id, kws, name.trim());
  return NextResponse.json({ ...data, assigned });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = getSupabaseAdmin();
  await admin.from('cashflow_transactions').update({ counterparty_id: null }).eq('counterparty_id', id);
  const { error } = await admin.from('counterparties').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = getSupabaseAdmin();
  // Clear any manual assignments before deleting
  await admin.from('cashflow_transactions').update({ counterparty_id: null }).eq('counterparty_id', id);
  const { error } = await admin.from('counterparties').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
