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

/**
 * Moves this counterparty's transactions onto its category.
 *
 * Rows whose category a person set by hand are left alone — one Nexi line a
 * month is the fee for the service, not takings.
 */
async function applyCategory(
  admin: SupabaseClient,
  counterpartyId: string,
  category: string | null,
  keywords: string[],
  name: string,
): Promise<number> {
  if (!category) return 0;
  const terms = keywords.length > 0 ? keywords : [name];
  const { data: txs } = await admin
    .from('cashflow_transactions')
    .select('id, counterparty, counterparty_id, category')
    .eq('category_manual', false);
  const matched = (txs ?? []).filter(tx => {
    if (tx.category === category) return false;
    if (tx.counterparty_id === counterpartyId) return true;
    if (tx.counterparty_id) return false;
    const raw = (tx.counterparty ?? '').toLowerCase();
    return terms.some(kw => kw && raw.includes(kw.toLowerCase()));
  }).map(tx => tx.id);
  if (!matched.length) return 0;

  // Supabase caps an IN list, so the update goes in chunks.
  for (let i = 0; i < matched.length; i += 200) {
    await admin.from('cashflow_transactions')
      .update({ category })
      .in('id', matched.slice(i, i + 200));
  }
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
  const { name, category, default_vat_rate, notes, keywords, iban, bic, account_holder } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const kws: string[] = Array.isArray(keywords) ? keywords.filter(Boolean) : [];

  const { data, error } = await admin
    .from('counterparties')
    .update({
      name: name.trim(),
      /* Every field is written only when the caller sent it. A payment run
         saving an IBAN sends nothing else, and must not blank the category. */
      ...(category !== undefined         ? { category: category || null } : {}),
      ...(default_vat_rate !== undefined ? { default_vat_rate: default_vat_rate ?? null } : {}),
      ...(notes !== undefined            ? { notes: notes || null } : {}),
      ...(keywords !== undefined         ? { keywords: kws } : {}),
      ...(iban !== undefined           ? { iban: iban || null } : {}),
      ...(bic !== undefined            ? { bic: bic || null } : {}),
      ...(account_holder !== undefined ? { account_holder: account_holder || null } : {}),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The keywords as stored, so a caller that sent none does not re-assign on [].
  const terms: string[] = Array.isArray(data.keywords) ? data.keywords : kws;
  const assigned = await autoAssignTransactions(admin, id, terms, name.trim());
  const recategorised = await applyCategory(admin, id, data.category, terms, name.trim());
  return NextResponse.json({ ...data, assigned, recategorised });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = getSupabaseAdmin();
  await admin.from('cashflow_transactions').update({ counterparty_id: null }).eq('counterparty_id', id);
  const { error } = await admin.from('counterparties').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
