import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { readSequence, writeSequence } from '@/lib/month-sequence';

export const dynamic = 'force-dynamic';

/** The order of the Check Out PDF's sections, as set under "Sequencing". */
export async function GET() {
  try {
    return NextResponse.json({ order: await readSequence(getSupabaseAdmin()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  try {
    return NextResponse.json({ order: await writeSequence(getSupabaseAdmin(), body?.order) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
