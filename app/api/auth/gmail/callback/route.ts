import { NextRequest, NextResponse } from 'next/server';
import { google }                    from 'googleapis';
import { createOAuth2Client }        from '@/lib/gmail';
import { getSupabaseAdmin }          from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const base  = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  if (error) return NextResponse.redirect(`${base}/bookings/settings?error=access_denied`);
  if (!code) return NextResponse.redirect(`${base}/bookings/settings?error=no_code`);

  try {
    const client        = createOAuth2Client();
    const { tokens }    = await client.getToken(code);

    if (!tokens.refresh_token) {
      return NextResponse.redirect(`${base}/bookings/settings?error=no_refresh_token`);
    }

    client.setCredentials(tokens);

    const oauth2      = google.oauth2({ version: 'v2', auth: client });
    const { data: ui } = await oauth2.userinfo.get();

    const supabase = getSupabaseAdmin();
    // Replace any existing credentials with the new ones
    await supabase.from('gmail_credentials').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('gmail_credentials').insert({
      email:         ui.email ?? '',
      refresh_token: tokens.refresh_token,
      access_token:  tokens.access_token  ?? null,
      token_expiry:  tokens.expiry_date   ? new Date(tokens.expiry_date).toISOString() : null,
    });

    return NextResponse.redirect(`${base}/bookings/settings?connected=true`);
  } catch (err: any) {
    console.error('Gmail OAuth callback error:', err);
    return NextResponse.redirect(`${base}/bookings/settings?error=${encodeURIComponent(err.message)}`);
  }
}
