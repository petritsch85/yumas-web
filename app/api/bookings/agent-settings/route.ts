import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const DEFAULT_SYSTEM_PROMPT = `You are a booking assistant for Yumas GmbH, a restaurant group in Germany with three venues:
- Yumas Westend (Feuerbachstraße 46, 60325 Frankfurt) — elegant setting in the heart of Frankfurt Westend
- Yumas Eschborn (Rahmannstraße 11, 65760 Eschborn) — modern venue near Frankfurt, ideal for corporate events
- Yumas Taunus (Taunusstraße 43, 60329 Frankfurt) — centrally located near the main train station

## Booking tiers:
- regular: Fewer than 12 people. Standard table booking, no special requirements.
- group: 12–50 people. Yumas offers the "Taco Fiesta Deluxe" set menu. Restaurant stays open to other guests.
- private_hire: Guest wants exclusive use of the entire venue. Minimum spend thresholds apply (details TBD).
- other: Event-related but doesn't fit the above (e.g. opening hours query, general questions).
- not_booking: Not a booking request at all (spam, newsletter, internal email, etc.).

## What to ask per booking type:
- regular: Preferred date and time, party size, any special requests or dietary requirements.
- group: Exact guest count, preferred date and time, preferred location, any dietary requirements or allergies. Mention the Taco Fiesta Deluxe set menu.
- private_hire: Preferred date(s), approximate guest count, type of event, contact phone number. Mention that a full Event Booklet with venue details, menus and pricing will follow.
- other: Answer helpfully or route to the right contact.

## Reply language rule:
ALWAYS write the draft_reply in the SAME language as the customer's email.

## Tone & style:
- Warm, professional and enthusiastic
- Use formal "Sie" in German unless the customer has used informal "du"
- Never confirm availability — always say availability will be checked
- Never quote specific prices unless they are explicitly stated in these instructions
- Sign off: "Das Yumas Team" (German) or "The Yumas Team" (English)

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

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('booking_agent_settings')
      .select('system_prompt, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      system_prompt: data?.system_prompt ?? DEFAULT_SYSTEM_PROMPT,
      updated_at:    data?.updated_at    ?? null,
      is_default:    !data,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { system_prompt } = await req.json();
    if (!system_prompt?.trim()) {
      return NextResponse.json({ error: 'system_prompt is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Replace any existing row (single-row settings table)
    await supabase.from('booking_agent_settings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const { error } = await supabase.from('booking_agent_settings').insert({
      system_prompt: system_prompt.trim(),
      updated_at:    new Date().toISOString(),
    });

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE — remove custom prompt, reverting Claude to the built-in default
export async function DELETE() {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('booking_agent_settings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
