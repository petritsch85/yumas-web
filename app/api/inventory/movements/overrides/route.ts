import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  const store = req.nextUrl.searchParams.get('store');
  if (!store) return NextResponse.json({ error: 'store required' }, { status: 400 });

  const { data, error } = await supabase
    .from('inventory_movement_overrides')
    .select('*')
    .eq('store', store)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { store, delivery_date, item_name, overridden_qty, original_qty, comment } =
    await req.json();

  const { data, error } = await supabase
    .from('inventory_movement_overrides')
    .upsert(
      { store, delivery_date, item_name, overridden_qty, original_qty, comment,
        updated_at: new Date().toISOString() },
      { onConflict: 'store,delivery_date,item_name' },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const { store, delivery_date, item_name } = await req.json();

  const { error } = await supabase
    .from('inventory_movement_overrides')
    .delete()
    .eq('store', store)
    .eq('delivery_date', delivery_date)
    .eq('item_name', item_name);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
