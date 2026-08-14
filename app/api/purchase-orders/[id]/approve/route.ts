import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { Resend } from 'resend';

const APPROVER_NAMES = ['Nikolas Peters', 'Benjamin Peters', 'Marino Wolf'];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: poId } = await params;
    const admin = getSupabaseAdmin();

    // Verify the requesting user is an approved approver
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    if (!profile || !APPROVER_NAMES.includes(profile.full_name ?? '')) {
      return NextResponse.json({ error: 'Not authorized to approve orders' }, { status: 403 });
    }

    // Load PO with supplier
    const { data: po, error: poErr } = await admin
      .from('purchase_orders')
      .select('*, supplier:suppliers(name, email)')
      .eq('id', poId)
      .single();

    if (poErr || !po) return NextResponse.json({ error: 'PO not found' }, { status: 404 });
    if (po.status !== 'pending_approval') return NextResponse.json({ error: 'PO is not pending approval' }, { status: 400 });

    // Get the edited email body from the request
    const body = await req.json().catch(() => ({}));
    const emailBody: string = body.emailBody ?? '';

    // Mark as sent
    const { error: updateErr } = await admin
      .from('purchase_orders')
      .update({ status: 'sent', approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', poId);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // Send email with the text the approver reviewed and edited
    const supplierEmail = (po.supplier as any)?.email || 'bestellung@lieferant.de';
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey && emailBody) {
      const resend = new Resend(apiKey);
      const from = process.env.RESEND_FROM_EMAIL ?? 'Yumas GmbH <onboarding@resend.dev>';
      await resend.emails.send({
        from,
        to: [supplierEmail],
        subject: `Bestellung ${po.po_number} – Yumas GmbH`,
        text: emailBody,
      });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
