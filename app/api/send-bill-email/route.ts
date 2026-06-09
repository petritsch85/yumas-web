import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Email service not configured (RESEND_API_KEY missing)' }, { status: 503 });
    const resend = new Resend(apiKey);

    const { to, invoiceNumber, companyName, pdfBase64 } = await req.json();

    if (!to || !pdfBase64 || !invoiceNumber) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const from = process.env.RESEND_FROM_EMAIL ?? 'Yumas GmbH <onboarding@resend.dev>';

    const { error } = await resend.emails.send({
      from,
      to: [to],
      subject: `Rechnung ${invoiceNumber} – Yumas GmbH`,
      html: `
        <p>Sehr geehrte Damen und Herren,</p>
        <p>
          im Anhang finden Sie Ihre Rechnung <strong>${invoiceNumber}</strong>
          ${companyName ? ` für <strong>${companyName}</strong>` : ''}.
        </p>
        <p>Bei Rückfragen stehen wir Ihnen gerne zur Verfügung.</p>
        <p>Mit freundlichen Grüßen,<br/>Ihr Yumas-Team</p>
        <hr/>
        <p style="color:#888;font-size:12px">
          Yumas GmbH · Feuerbachstraße 46 · 60325 Frankfurt<br/>
          Sparkasse Rhein-Nahe · IBAN DE98 5605 0180 0017 1489 25
        </p>
      `,
      attachments: [{
        filename: `${invoiceNumber}.pdf`,
        content:  pdfBase64,
      }],
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
