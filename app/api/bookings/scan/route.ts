import Anthropic        from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { getGmailClient, decodeBody, extractSenderInfo } from '@/lib/gmail';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a booking assistant for Yumas GmbH, a restaurant group in Germany with three venues:
- Yumas Westend (Feuerbachstraße 46, 60325 Frankfurt)
- Yumas Eschborn (Rahmannstraße 11, 65760 Eschborn)
- Yumas Taunus (Taunusstraße 43, 60329 Frankfurt)

## Booking tiers:
- regular: Fewer than 12 people. Standard table booking, no special requirements.
- group: 12–50 people. Yumas offers the "Taco Fiesta Deluxe" set menu. Restaurant stays open to other guests.
- private_hire: Guest wants exclusive use of the entire venue. Minimum spend thresholds apply (details TBD).
- other: Event-related but doesn't fit the above (e.g. opening hours query, general questions).
- not_booking: Not a booking request at all (spam, newsletter, internal email, etc.).

## Reply language rule:
ALWAYS write the draft_reply in the SAME language as the customer's email.

## Draft reply guidance:
- Warm, professional, enthusiastic tone
- regular: Thank them, ask for preferred date/time, confirm party size, say they can call or email to confirm availability.
- group: Thank them for the large group enquiry, mention the Taco Fiesta Deluxe set menu, ask for exact guest count, preferred date/time, and preferred location. Say full details will follow.
- private_hire: Warmly acknowledge the private hire interest, say you will follow up with full venue details and pricing. Ask for preferred date(s) and a contact phone number. Mention an Event Booklet with venue and menu details will follow.
- other: Answer helpfully or route to the right contact.
- Sign off: "Das Yumas Team" (German) or "The Yumas Team" (English). No specific prices or confirmed availability.

Return ONLY valid JSON, no markdown:
{
  "is_booking": boolean,
  "booking_type": "regular" | "group" | "private_hire" | "other" | "not_booking",
  "party_size": number | null,
  "requested_date": "YYYY-MM-DD" | null,
  "requested_time": "HH:MM" | null,
  "preferred_location": "Westend" | "Eschborn" | "Taunus" | null,
  "language": "de" | "en",
  "summary": "2-3 sentence summary in English",
  "draft_reply": "Full draft reply in the customer's language, ready to send"
}`;

export async function POST() {
  try {
    const gmail    = await getGmailClient();
    const supabase = getSupabaseAdmin();

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

      // Throttle: 1 s between Claude calls to stay within rate limits
      if (processed > 0) await new Promise(r => setTimeout(r, 1200));

      const res = await anthropic.messages.create({
        model:      'claude-haiku-4-5',
        max_tokens: 1024,
        system:     SYSTEM_PROMPT,
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
        gmail_message_id: msg.id,
        gmail_thread_id:  full.threadId ?? null,
        from_email:       fromEmail,
        from_name:        fromName   || null,
        subject:          subject    || null,
        body_text:        bodyText   || null,
        received_at:      dateHdr ? new Date(dateHdr).toISOString() : new Date().toISOString(),
        booking_type:     a.booking_type    ?? 'not_booking',
        party_size:       a.party_size      ?? null,
        requested_date:   a.requested_date  ?? null,
        requested_time:   a.requested_time  ?? null,
        preferred_location: a.preferred_location ?? null,
        language:         a.language        ?? 'de',
        summary:          a.summary         ?? null,
        status:           a.is_booking ? 'draft' : 'ignored',
        draft_reply:      a.draft_reply     ?? null,
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
