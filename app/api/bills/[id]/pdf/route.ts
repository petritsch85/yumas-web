import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const admin = getSupabaseAdmin();

  const { data: bill, error } = await admin
    .from('bills')
    .select('file_path')
    .eq('id', id)
    .single();

  if (error || !bill?.file_path) {
    return NextResponse.json({ error: 'PDF not found' }, { status: 404 });
  }

  const { data: signed, error: signErr } = await admin.storage
    .from('bills')
    .createSignedUrl(bill.file_path, 120);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Could not generate URL' }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
