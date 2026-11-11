import { NextRequest, NextResponse } from 'next/server';
import { POST as autoMatch } from '@/app/api/cashflow/auto-match/route';

/**
 * Vercel cron, every night (vercel.json): link incoming bills to the payments
 * that settled them, without anyone pressing "Auto-match" on the Cash Flow page.
 *
 * Only the bill matches are applied — the ones the matcher makes where nothing
 * else is possible: the invoice number quoted, or the amount to the cent with
 * one supplier beyond doubt and no rival on either side. Wolt periods,
 * part-payments, customer payments and anything flagged as suspect stay on the
 * Cash Flow page for a person to tick, as before.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const call = (body: unknown) => autoMatch(new Request('http://internal/api/cashflow/auto-match', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as unknown as NextRequest);
  try {
    const preview = await (await call({ apply: false })).json() as { matches?: { txId: string }[]; error?: string };
    if (preview.error) throw new Error(preview.error);
    const only = (preview.matches ?? []).map(m => m.txId);
    if (!only.length) return NextResponse.json({ applied: 0 });
    const result = await (await call({ apply: true, only })).json();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
