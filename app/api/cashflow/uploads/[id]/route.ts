import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * DELETE /api/cashflow/uploads/[id] — removes an upload and its transactions.
 *
 * cashflow_transactions references the upload with ON DELETE CASCADE, so this
 * takes the bank rows with it. The count is read first and returned, so the
 * page can say what actually went rather than guessing from the stale figure
 * it had on screen.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = getSupabaseAdmin();

  const { data: upload, error: findErr } = await admin
    .from('cashflow_uploads')
    .select('id, file_path, filename')
    .eq('id', id)
    .single();

  if (findErr || !upload) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { count } = await admin
    .from('cashflow_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('upload_id', id);

  // The stored CSV is the evidence behind the rows; it goes with them.
  if (upload.file_path) {
    await admin.storage.from('cashflow-files').remove([upload.file_path]).catch(() => {});
  }

  const { error: delErr } = await admin.from('cashflow_uploads').delete().eq('id', id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, deletedTransactions: count ?? 0, filename: upload.filename });
}
