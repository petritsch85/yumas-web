import { google } from 'googleapis';
import { getSupabaseAdmin } from './supabase-admin';

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI,
  );
}

export function getAuthUrl() {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });
}

export async function getGmailClient() {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('gmail_credentials')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data) throw new Error('Gmail not connected. Please connect via Bookings → Settings.');

  const client = createOAuth2Client();
  client.setCredentials({
    refresh_token: data.refresh_token,
    access_token:  data.access_token  ?? undefined,
    expiry_date:   data.token_expiry  ? new Date(data.token_expiry).getTime() : undefined,
  });

  client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await supabase
        .from('gmail_credentials')
        .update({
          access_token: tokens.access_token,
          token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          updated_at:   new Date().toISOString(),
        })
        .eq('id', data.id);
    }
  });

  return google.gmail({ version: 'v1', auth: client });
}

// Decode base64url Gmail message body, preferring text/plain
export function decodeBody(payload: any): string {
  if (!payload) return '';
  const extract = (part: any): string => {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) {
      for (const p of part.parts) {
        const t = extract(p);
        if (t) return t;
      }
    }
    return '';
  };
  return extract(payload);
}

export function extractSenderInfo(headers: any[]): { name: string; email: string } {
  const from = headers.find((h: any) => h.name?.toLowerCase() === 'from')?.value ?? '';
  const m = from.match(/^(.*?)\s*<(.+?)>$/);
  if (m) return { name: m[1].trim().replace(/^["']|["']$/g, ''), email: m[2].trim() };
  return { name: '', email: from.trim() };
}
