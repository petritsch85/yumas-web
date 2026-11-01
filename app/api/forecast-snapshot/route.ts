import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { readSnapshot, freezeMonth } from '@/lib/forecast-snapshot';

/**
 * The frozen start-of-month forecast.
 *   GET  ?month=2026-11            → the snapshot, or { snapshot: null }
 *   POST ?month=2026-11            → freeze it now, unless already frozen
 */
const MONTH = /^\d{4}-\d{2}$/;

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!MONTH.test(month)) return NextResponse.json({ error: 'month must look like 2026-11' }, { status: 400 });
  return NextResponse.json({ snapshot: await readSnapshot(getSupabaseAdmin(), month) });
}

export async function POST(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!MONTH.test(month)) return NextResponse.json({ error: 'month must look like 2026-11' }, { status: 400 });
  try {
    const snapshot = await freezeMonth(getSupabaseAdmin(), month);
    if (!snapshot) return NextResponse.json({ error: 'No forecast for this month yet.' }, { status: 404 });
    return NextResponse.json({ snapshot });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
