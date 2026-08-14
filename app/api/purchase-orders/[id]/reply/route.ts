import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { Resend } from 'resend';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: poId } = await params;

    // Verify auth
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = getSupabaseAdmin();

    const { body: emailBody, subject } = await req.json();
    if (!emailBody) return NextResponse.json({ error: 'Missing email body' }, { status: 400 });

    // Load PO + supplier email
    const { data: po } = await admin
      .from('purchase_orders')
      .select('po_number, supplier:suppliers(email, name)')
      .eq('id', poId)
      .single();

    if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 });

    const supplierEmail = (po.supplier as any)?.email || 'bestellung@lieferant.de';
    const emailSubject = subject || `Bestellung ${po.po_number} – Yumas GmbH`;
    const from = process.env.RESEND_FROM_EMAIL ?? 'Yumas GmbH <onboarding@resend.dev>';

    // Send email
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from,
        to: [supplierEmail],
        subject: emailSubject,
        text: emailBody,
      });
    }

    // Save to thread
    const senderProfile = await admin.from('profiles').select('full_name').eq('id', user.id).single();
    const fromEmail = process.env.RESEND_FROM_EMAIL?.match(/<(.+)>/)?.[1]
      ?? process.env.RESEND_FROM_EMAIL
      ?? 'bestellungen@yumas.de';

    const { error } = await admin.from('po_messages').insert({
      po_id:      poId,
      direction:  'outbound',
      from_email: fromEmail,
      to_email:   supplierEmail,
      subject:    emailSubject,
      body:       emailBody,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
