import { NextRequest, NextResponse } from 'next/server';
import { venueStatus, importVenueShifts, logRun, validToken, type IncomingShift, type ImportedShift } from '@/lib/orderbird-import';

/* Called by public/orderbird-import.js from inside a logged-in MY orderbird
   tab — hence CORS for that one origin, and a token instead of a session. */
export const maxDuration = 120;

const CORS = {
  'Access-Control-Allow-Origin':  'https://my.orderbird.com',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Import-Token',
  'Access-Control-Max-Age':       '600',
};

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Where to start: the last Z number on file for each venue. */
export async function GET(req: NextRequest) {
  if (!await validToken(req.headers.get('x-import-token'))) return reply({ error: 'This button is not valid any more — set it up again from the Sales Reports page.' }, 401);
  try {
    return reply({ venues: await venueStatus() });
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

type Body = { venues?: { venueId: string; shifts: IncomingShift[]; error?: string }[] };

/** The Z-reports the bookmark fetched, all venues at once. */
export async function POST(req: NextRequest) {
  if (!await validToken(req.headers.get('x-import-token'))) return reply({ error: 'This button is not valid any more — set it up again from the Sales Reports page.' }, 401);
  const body = await req.json().catch(() => ({})) as Body;

  const imported: ImportedShift[] = [];
  const errors: string[] = [];
  // One restaurant failing must not hold up the others
  for (const v of body.venues ?? []) {
    if (v.error) errors.push(v.error);
    try {
      imported.push(...await importVenueShifts(v.venueId, v.shifts ?? []));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  const error = errors.length ? errors.join(' · ') : null;
  await logRun(!error, imported, error);
  return reply({ ok: !error, imported, error }, error ? 207 : 200);
}
