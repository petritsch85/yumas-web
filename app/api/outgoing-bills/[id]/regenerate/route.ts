import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * Replace an outgoing bill's stored PDF and its row.
 *
 * The overwrite runs here rather than in the browser: the storage bucket's RLS
 * policy permits inserting a new object but not updating an existing one, so a
 * client-side upsert fails with "new row violates row-level security policy".
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file    = form.get('file');
  const payload = form.get('payload');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'Missing PDF file' }, { status: 400 });
  }
  if (typeof payload !== 'string') {
    return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
  }

  let update: Record<string, unknown>;
  try {
    update = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'payload is not valid JSON' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Only ever write to the path already recorded on the row — never a caller-supplied one
  const { data: bill, error: readErr } = await admin
    .from('outgoing_bills')
    .select('id, file_path')
    .eq('id', id)
    .single();
  if (readErr || !bill) {
    return NextResponse.json({ error: readErr?.message ?? 'Bill not found' }, { status: 404 });
  }
  if (!bill.file_path) {
    return NextResponse.json({ error: 'Bill has no stored PDF to replace' }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from('bills')
    .upload(bill.file_path, bytes, {
      contentType: 'application/pdf',
      upsert: true,
      cacheControl: '60', // the object can change in place, so don't let it sit in caches
    });
  if (upErr) {
    return NextResponse.json({ error: `PDF upload failed: ${upErr.message}` }, { status: 500 });
  }

  // Whitelist the columns a regeneration is allowed to touch
  const ALLOWED = new Set([
    'customer_name', 'customer_address', 'invoice_number', 'invoice_date', 'event_date',
    'issuing_location', 'shift_type', 'net_food', 'net_drinks', 'net_total',
    'vat_7', 'vat_19', 'gross_total', 'tips', 'total_payable', 'bill_data',
  ]);
  const safe = Object.fromEntries(Object.entries(update).filter(([k]) => ALLOWED.has(k)));

  const { error: dbErr } = await admin.from('outgoing_bills').update(safe).eq('id', id);
  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, file_path: bill.file_path });
}
