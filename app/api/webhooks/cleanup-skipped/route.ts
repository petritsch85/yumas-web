import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const KEEP_DAYS = 30;

/**
 * Vercel cron, every night (vercel.json): deletes the files the email import set
 * aside as "not a bill" once they are older than 30 days, to keep storage under
 * the plan limit. A misread one can still be imported by hand within those 30 days.
 *
 * Never deleted: a file a bill uses (imported by hand), and a file whose reading
 * failed — that one was never judged and may well be an invoice.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  try {
    const existing = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage.from('bills').list('skipped', { limit: 1000, offset });
      if (error) throw error;
      for (const f of data ?? []) existing.add(`skipped/${f.name}`);
      if ((data ?? []).length < 1000) break;
    }
    if (!existing.size) return NextResponse.json({ deleted: 0 });

    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString();
    const { data: rows, error: e1 } = await admin.from('inbound_skipped')
      .select('id, file_path, status, document_type')
      .in('status', ['skipped', 'dismissed']).is('bill_id', null).lt('received_at', cutoff);
    if (e1) throw e1;
    const { data: used, error: e2 } = await admin.from('bills').select('file_path').like('file_path', 'skipped/%');
    if (e2) throw e2;
    const usedSet = new Set((used ?? []).map((b) => b.file_path as string));

    const targets = (rows ?? []).filter((r) => existing.has(r.file_path) && !usedSet.has(r.file_path)
      && !['failed', 'unrecognised'].includes(String(r.document_type)));

    let deleted = 0;
    for (let i = 0; i < targets.length; i += 50) {
      const batch = targets.slice(i, i + 50);
      const { error } = await admin.storage.from('bills').remove(batch.map((t) => t.file_path));
      if (error) throw error;
      const listed = batch.filter((t) => t.status === 'skipped').map((t) => t.id);
      if (listed.length) {
        const { error: e3 } = await admin.from('inbound_skipped').update({ status: 'dismissed' }).in('id', listed);
        if (e3) throw e3;
      }
      deleted += batch.length;
    }
    return NextResponse.json({ deleted });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
