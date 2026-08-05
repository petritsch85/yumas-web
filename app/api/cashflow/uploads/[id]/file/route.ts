import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// GET /api/cashflow/uploads/[id]/file  — returns a short-lived signed download URL
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = getSupabaseAdmin();

  const { data: upload, error } = await admin
    .from('cashflow_uploads')
    .select('file_path, filename')
    .eq('id', id)
    .single();

  if (error || !upload) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!upload.file_path) return NextResponse.json({ error: 'No file stored for this upload' }, { status: 404 });

  const { data: signed, error: signErr } = await admin.storage
    .from('cashflow-files')
    .createSignedUrl(upload.file_path, 300); // 5-minute URL

  if (signErr || !signed) return NextResponse.json({ error: signErr?.message ?? 'Signing failed' }, { status: 500 });

  return NextResponse.json({ url: signed.signedUrl, filename: upload.filename });
}
