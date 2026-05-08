import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin }          from '@/lib/supabase-admin';
import { getGmailClient }            from '@/lib/gmail';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id }   = await params;
    const body     = await req.json().catch(() => ({}));
    const replyText: string | undefined = body.reply_text;

    const supabase = getSupabaseAdmin();

    // 1. Fetch the inquiry
    const { data: inquiry, error: fetchErr } = await supabase
      .from('booking_inquiries')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !inquiry) {
      return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    }

    const replyBody = replyText ?? inquiry.draft_reply ?? '';
    if (!replyBody) {
      return NextResponse.json({ error: 'No reply text provided' }, { status: 400 });
    }

    // 2. Get the gmail client
    const gmail = await getGmailClient();

    // 3. Fetch the original message to get the Message-ID header for threading
    let originalMessageId = '';
    try {
      const { data: original } = await gmail.users.messages.get({
        userId: 'me',
        id:     inquiry.gmail_message_id,
        format: 'metadata',
        metadataHeaders: ['Message-ID', 'Message-Id'],
      });
      const headers = original?.payload?.headers ?? [];
      originalMessageId = headers.find(
        (h: any) => h.name?.toLowerCase() === 'message-id',
      )?.value ?? '';
    } catch {
      // Proceed without In-Reply-To if original message is not accessible
    }

    // RFC 2047 encode a header value if it contains non-ASCII characters
    const encodeHeader = (str: string) =>
      /[^\x00-\x7F]/.test(str)
        ? `=?UTF-8?B?${Buffer.from(str, 'utf-8').toString('base64')}?=`
        : str;

    // 4. Build RFC-2822 raw message
    const subjectRaw = inquiry.subject
      ? (inquiry.subject.startsWith('Re:') ? inquiry.subject : `Re: ${inquiry.subject}`)
      : 'Re: Booking Enquiry';
    const subject = encodeHeader(subjectRaw);

    const from = 'benjaminpeters@yumas.de';
    const to   = inquiry.from_email;
    const toDisplay = inquiry.from_name
      ? `${encodeHeader(inquiry.from_name)} <${to}>`
      : to;

    const headers = [
      `From: Yumas GmbH <${from}>`,
      `To: ${toDisplay}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
    ];

    if (originalMessageId) {
      headers.push(`In-Reply-To: ${originalMessageId}`);
      headers.push(`References: ${originalMessageId}`);
    }

    if (inquiry.gmail_thread_id) {
      // threadId is passed separately to the API, not in headers
    }

    const bodyEncoded = Buffer.from(replyBody, 'utf-8').toString('base64');
    const rawMessage  = headers.join('\r\n') + '\r\n\r\n' + bodyEncoded;
    const encoded     = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // 5. Send via Gmail
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw:      encoded,
        threadId: inquiry.gmail_thread_id ?? undefined,
      },
    });

    // 6. Update inquiry status and final reply text
    await supabase
      .from('booking_inquiries')
      .update({
        status:      'sent',
        draft_reply: replyBody,
        updated_at:  new Date().toISOString(),
      })
      .eq('id', id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Booking send error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
