import Anthropic        from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { getGmailClient, decodeBody, extractSenderInfo } from '@/lib/gmail';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { DEFAULT_SYSTEM_PROMPT } from '@/app/api/bookings/agent-settings/route';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function loadSystemPrompt(): Promise<string> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('booking_agent_settings')
      .select('system_prompt')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.system_prompt ?? DEFAULT_SYSTEM_PROMPT;
  } catch {
    return DEFAULT_SYSTEM_PROMPT;
  }
}

export async function POST() {
  try {
    const gmail      = await getGmailClient();
    const supabase   = getSupabaseAdmin();
    const systemPrompt = await loadSystemPrompt();

    const { data: listData } = await gmail.users.messages.list({
      userId:     'me',
      q:          'is:unread in:inbox',
      maxResults: 10,
    });

    const messages = listData.messages ?? [];
    if (!messages.length) return NextResponse.json({ processed: 0, bookings: 0 });

    const { data: existing } = await supabase.from('booking_inquiries').select('gmail_message_id');
    const seen = new Set((existing ?? []).map((e: any) => e.gmail_message_id));

    let processed = 0, bookings = 0;

    for (const msg of messages) {
      if (!msg.id || seen.has(msg.id)) continue;

      const { data: full } = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const headers  = full.payload?.headers ?? [];
      const subject  = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value ?? '';
      const dateHdr  = headers.find((h: any) => h.name?.toLowerCase() === 'date')?.value;
      const { name: fromName, email: fromEmail } = extractSenderInfo(headers);
      const bodyText = decodeBody(full.payload);

      if (!bodyText && !subject) { processed++; continue; }

      // Throttle: 1.2 s between Claude calls to stay within rate limits
      if (processed > 0) await new Promise(r => setTimeout(r, 1200));

      const res = await anthropic.messages.create({
        model:      'claude-haiku-4-5',
        max_tokens: 1024,
        system:     systemPrompt,
        messages:   [{
          role:    'user',
          content: `Analyse this email:\n\nFrom: ${fromName} <${fromEmail}>\nSubject: ${subject}\n\n${bodyText}`,
        }],
      });

      const raw = res.content[0].type === 'text' ? res.content[0].text : '{}';
      let a: any = { is_booking: false, booking_type: 'not_booking' };
      try {
        const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
        if (s !== -1 && e !== -1) a = JSON.parse(raw.slice(s, e + 1));
      } catch { /* keep default */ }

      // Fix contradiction: if AI says is_booking=true but type=not_booking, correct to 'other'
      if (a.is_booking && a.booking_type === 'not_booking') {
        a.booking_type = 'other';
      }

      await supabase.from('booking_inquiries').insert({
        gmail_message_id:   msg.id,
        gmail_thread_id:    full.threadId ?? null,
        from_email:         fromEmail,
        from_name:          fromName   || null,
        subject:            subject    || null,
        body_text:          bodyText   || null,
        received_at:        dateHdr ? new Date(dateHdr).toISOString() : new Date().toISOString(),
        booking_type:       a.booking_type    ?? 'not_booking',
        party_size:         a.party_size      ?? null,
        requested_date:     a.requested_date  ?? null,
        requested_time:     a.requested_time  ?? null,
        preferred_location: a.preferred_location ?? null,
        language:           a.language        ?? 'de',
        summary:            a.summary         ?? null,
        status:             a.is_booking ? 'draft' : 'ignored',
        draft_reply:        a.draft_reply     ?? null,
      });

      // Mark as read
      await gmail.users.messages.modify({
        userId:      'me',
        id:          msg.id,
        requestBody: { removeLabelIds: ['UNREAD'] },
      });

      processed++;
      if (a.is_booking) bookings++;
    }

    return NextResponse.json({ processed, bookings });
  } catch (err: any) {
    console.error('Booking scan error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
