import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { fileBill, findDuplicate } from '@/lib/inbound-bills';

/**
 * A document the email import set aside as not a bill.
 *   { action: 'import' }  — file it as a bill after all (the reading was wrong)
 *   { action: 'dismiss' } — take it off the list; the file is kept
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action } = await req.json().catch(() => ({}));
  const admin = getSupabaseAdmin();

  const { data: doc, error } = await admin.from('inbound_skipped').select('*').eq('id', id).single();
  if (error || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (doc.status !== 'skipped') return NextResponse.json({ error: `Already ${doc.status}` }, { status: 409 });

  if (action === 'dismiss') {
    await admin.from('inbound_skipped').update({ status: 'dismissed' }).eq('id', id);
    return NextResponse.json({ ok: true });
  }

  if (action !== 'import') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  const extracted = (doc.extracted ?? {}) as Record<string, unknown>;
  const duplicate = await findDuplicate(extracted);
  if (duplicate) {
    return NextResponse.json({ error: 'This invoice is already on file — not imported again.' }, { status: 409 });
  }

  // Imported by hand, so it has been looked at: straight into Pending
  const billId = await fileBill(doc.file_path, extracted, { isNew: false });
  await admin.from('inbound_skipped').update({ status: 'imported', bill_id: billId }).eq('id', id);
  return NextResponse.json({
    ok: true,
    billId,
    message: billId ? null : 'Stored, but this counterparty pays us — no payable was created.',
  });
}
