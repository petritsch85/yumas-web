import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { freezeMonth } from '@/lib/forecast-snapshot';

/**
 * Vercel cron, every night just after midnight Berlin time (vercel.json):
 * freeze the current month's forecast if it is not frozen yet. On the 1st
 * that catches the new month as it stands; on any other night it does
 * nothing, because an existing snapshot is kept. A month whose forecast is
 * only written mid-month is frozen the night after it appears.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const month = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 7);
  try {
    const snap = await freezeMonth(getSupabaseAdmin(), month);
    return NextResponse.json({ month, frozen: !!snap, frozenAt: snap?.frozenAt ?? null, rows: snap?.rows.length ?? 0 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
