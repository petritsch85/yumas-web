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

    // Load PO with supplier and location
    const { data: po, error: poErr } = await admin
      .from('purchase_orders')
      .select('*, supplier:suppliers(name, email), destination_location:locations(name)')
      .eq('id', poId)
      .single();

    if (poErr || !po) return NextResponse.json({ error: 'PO not found' }, { status: 404 });
    if (po.status !== 'pending_approval') return NextResponse.json({ error: 'PO is not pending approval' }, { status: 400 });

    // Load PO lines
    const { data: lines } = await admin
      .from('purchase_order_lines')
      .select('display_name, einheit, quantity_ordered, unit_price, line_total')
      .eq('po_id', poId);

    // Mark as sent
    const { error: updateErr } = await admin
      .from('purchase_orders')
      .update({ status: 'sent', approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', poId);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // Send email
    const supplierEmail = (po.supplier as any)?.email || 'bestellung@lieferant.de';
    const supplierName = (po.supplier as any)?.name ?? 'Lieferant';
    const locationName = (po.destination_location as any)?.name ?? po.destination_location_id ?? '';

    const lineRows = (lines ?? []).map((l: any) =>
      `- ${l.display_name}: ${l.quantity_ordered} ${l.einheit ?? ''}${l.unit_price > 0 ? ` à €${Number(l.unit_price).toFixed(2)}` : ''}`
    ).join('\n');

    const totalBrutto = (lines ?? []).reduce((s: number, l: any) => s + (Number(l.line_total) || 0), 0);

    const emailBody = `Sehr geehrte Damen und Herren,

wir möchten folgende Bestellung aufgeben:

Bestellnummer: ${po.po_number}
Bestelldatum: ${po.order_date ?? new Date().toISOString().slice(0, 10)}
Lieferort: ${locationName}

Bestellte Artikel:
${lineRows}
${totalBrutto > 0 ? `\nGesamtbetrag: €${totalBrutto.toFixed(2)}` : ''}

Bitte bestätigen Sie den Eingang dieser Bestellung.

Mit freundlichen Grüßen,
${profile?.full_name ?? ''}
Yumas GmbH`;

    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
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
