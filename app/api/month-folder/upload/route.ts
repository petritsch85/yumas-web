import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { itemFor } from '@/lib/month-folder';

export const maxDuration = 60;

/**
 * Filing a monthly statement against its month.
 *
 * The write goes through the server for the same reason every other write to
 * cashflow-files does: the bucket and the table are closed to the browser
 * client, and an upload from the page was refused outright with "new row
 * violates row-level security policy". Loosening that to let one page write
 * directly would be the wrong way round — this is the pattern the rest of the
 * app already uses.
 */

const MONTH = /^\d{4}-\d{2}$/;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const kind = String(form?.get('kind') ?? '');
  const month = String(form?.get('month') ?? '');

  if (!(file instanceof File)) return NextResponse.json({ error: 'Keine Datei.' }, { status: 400 });
  if (!MONTH.test(month)) return NextResponse.json({ error: 'month muss 2026-09 sein.' }, { status: 400 });

  /* Only a kind the manifest declares: a typo would otherwise file a document
     under a position nothing ever looks at. */
  const item = itemFor(kind);
  if (!item) return NextResponse.json({ error: `Unbekannte Position "${kind}".` }, { status: 400 });
  if (item.source !== 'uploaded') {
    return NextResponse.json({ error: `${item.label} wird automatisch gesammelt.` }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `monatsabschluss/${month}/${kind}_${Date.now()}_${safe}`;

  const { error: upErr } = await admin.storage.from('cashflow-files')
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type || 'application/octet-stream', upsert: true,
    });
  if (upErr) return NextResponse.json({ error: `Upload: ${upErr.message}` }, { status: 500 });

  /* Replacing, not adding: the same position twice in a month would otherwise
     put two copies in the Steuerberater's folder. */
  const { data: old } = await admin.from('month_documents')
    .select('file_path').eq('kind', kind).eq('month', `${month}-01`).maybeSingle();

  const { error } = await admin.from('month_documents').upsert({
    kind, month: `${month}-01`, filename: file.name, file_path: path,
    bucket: 'cashflow-files', byte_size: file.size,
  }, { onConflict: 'kind,month' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (old?.file_path && old.file_path !== path) {
    await admin.storage.from('cashflow-files').remove([old.file_path]).catch(() => {});
  }
  return NextResponse.json({ ok: true, filename: file.name });
}

export async function DELETE(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind') ?? '';
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!MONTH.test(month) || !itemFor(kind)) {
    return NextResponse.json({ error: 'kind und month erforderlich.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();
  const { data: row } = await admin.from('month_documents')
    .select('file_path,bucket').eq('kind', kind).eq('month', `${month}-01`).maybeSingle();

  const { error } = await admin.from('month_documents')
    .delete().eq('kind', kind).eq('month', `${month}-01`);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (row?.file_path) {
    await admin.storage.from(row.bucket || 'cashflow-files').remove([row.file_path]).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
