/**
 * Postmark → Supabase Storage → Vercel.
 *
 * Vercel refuses a request body over 4.5 MB, and an email carrying a few
 * invoices — or a batch forwarded "as attachment" — is often larger. Postmark
 * delivers up to 35 MB. This function takes the inbound webhook instead, puts
 * the payload in storage untouched (it is never parsed here: the CPU budget is
 * 2 s), and hands the app only the path to it.
 *
 * Postmark's webhook URL:
 *   https://<project>.supabase.co/functions/v1/inbound-relay?secret=<INBOUND_BILLS_WEBHOOK_SECRET>
 *
 * The secret is passed through to the app, which checks it; a payload the app
 * refuses is deleted again. Deploy with JWT verification off — Postmark cannot
 * send a Supabase token.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL      = Deno.env.get('APP_URL') ?? 'https://yumas-web.vercel.app';
const BUCKET       = 'inbound-emails';

const storage = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...(init.headers ?? {}) },
  });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const secret = new URL(req.url).searchParams.get('secret') ?? req.headers.get('x-webhook-secret') ?? '';
  const body   = await req.arrayBuffer();
  const key    = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.json`;

  const put = await storage(key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!put.ok) {
    const msg = await put.text();
    console.error(`[inbound-relay] storing ${body.byteLength} bytes failed: ${put.status} ${msg}`);
    // Postmark retries on an error, which is what is wanted here
    return new Response(`Storage failed: ${msg}`, { status: 502 });
  }

  const res = await fetch(
    `${APP_URL}/api/webhooks/inbound-bills?secret=${encodeURIComponent(secret)}&key=${encodeURIComponent(key)}`,
    { method: 'POST' },
  );
  const text = await res.text();

  if (!res.ok) {
    console.error(`[inbound-relay] app answered ${res.status}: ${text}`);
    await storage(key, { method: 'DELETE' });
    // A refused secret will not improve on retry; anything else might
    return new Response(text, { status: res.status === 401 ? 401 : 502 });
  }

  console.log(`[inbound-relay] ${body.byteLength} bytes → ${key} · ${text.slice(0, 300)}`);
  return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
});
