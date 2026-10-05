import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/* Issues the token baked into a "Yumas Import" bookmark. Signed-in users only
   (proxy.ts); every bookmark set up stays valid until its row is deleted. */
export async function POST() {
  const token = randomBytes(32).toString('hex');
  const { error } = await getSupabaseAdmin().from('orderbird_import_tokens').insert({ token });
  if (error) return NextResponse.json({ error: `${error.message} — has supabase/add_orderbird_sync.sql been run?` }, { status: 500 });
  return NextResponse.json({ token });
}
