import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// Matches PO number pattern in email subjects like:
// "Re: Bestellung PO-20260814-8197 – Yumas GmbH"
const PO_PATTERN = /PO-\d{8}-\d{4}/;

// Verify the webhook is from our configured email service
const WEBHOOK_SECRET = process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? '';

export async function POST(req: NextRequest) {
  try {
    // Validate webhook secret (passed as ?secret=xxx query param or X-Webhook-Secret header)
    const url = new URL(req.url);
    const secret = url.searchParams.get('secret') ?? req.headers.get('x-webhook-secret') ?? '';
    if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();

    // Support multiple inbound email providers
    // Postmark: From, Subject, TextBody, MessageID, Headers[In-Reply-To]
    // Mailgun:  sender, subject, body-plain, Message-Id, In-Reply-To
    // Resend:   from, subject, text, messageId, inReplyTo
    const from       = payload.From       ?? payload.from      ?? payload.sender       ?? '';
    const to         = payload.To         ?? payload.to        ?? payload.recipient    ?? '';
    const subject    = payload.Subject    ?? payload.subject   ?? '';
    const body       = payload.TextBody   ?? payload['body-plain'] ?? payload.text ?? payload.body ?? '';
    const messageId  = payload.MessageID  ?? payload['Message-Id']  ?? payload.messageId ?? '';

    // Extract In-Reply-To from headers (Postmark stores headers as array)
    let inReplyTo = payload.InReplyTo ?? payload['In-Reply-To'] ?? payload.inReplyTo ?? '';
    if (!inReplyTo && Array.isArray(payload.Headers)) {
      const h = payload.Headers.find((h: { Name: string }) => h.Name === 'In-Reply-To');
      inReplyTo = h?.Value ?? '';
    }

    // Find PO number in subject
    const match = PO_PATTERN.exec(subject);
    if (!match) {
      // Not related to a PO — ignore silently
      return NextResponse.json({ ok: true, skipped: 'no PO number in subject' });
    }
    const poNumber = match[0];

    const admin = getSupabaseAdmin();

    // Look up the PO
    const { data: po } = await admin
      .from('purchase_orders')
      .select('id')
      .eq('po_number', poNumber)
      .single();

    if (!po) {
      return NextResponse.json({ ok: true, skipped: `PO ${poNumber} not found` });
    }

    // Save inbound message
    const { error } = await admin.from('po_messages').insert({
      po_id:       po.id,
      direction:   'inbound',
      from_email:  from,
      to_email:    to,
      subject,
      body,
      message_id:  messageId,
      in_reply_to: inReplyTo,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, po_number: poNumber });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
