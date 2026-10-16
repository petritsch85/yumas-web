import { NextRequest, NextResponse } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseFibuJournal, FibuParseError } from '@/lib/fibu-journal';

export const runtime = 'nodejs';

/**
 * The months for which a FiBu-Journal is on file.
 *
 * Read through the server for the same reason month_documents is: the table is
 * closed to the browser client, and an empty answer from RLS looks exactly like
 * "nothing uploaded yet".
 */
export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from('staff_costs').select('*').order('month', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ months: data ?? [] });
}

/**
 * Upload a FiBu-Journal: read the month and its total, keep the PDF.
 *
 * The figure is checked before anything is written. A journal that cannot be
 * read, or whose clearing account does not reconcile, is refused with the
 * reason — a wrong staff cost would move EBITDA by the whole error, and a
 * silent failure would leave the placeholder in place looking like the truth.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Keine Datei.' }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  let journal;
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    journal = parseFibuJournal(String(text), file.name);
  } catch (e) {
    const msg = e instanceof FibuParseError ? e.message : 'Das PDF konnte nicht gelesen werden.';
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  const admin = getSupabaseAdmin();
  const path = `staff-costs/${journal.month.slice(0, 7)}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: upErr } = await admin.storage.from('cashflow-files')
    .upload(path, bytes, { contentType: 'application/pdf', upsert: true });
  if (upErr) return NextResponse.json({ error: `Upload: ${upErr.message}` }, { status: 500 });

  /* A corrected journal replaces the month; the old file goes with it. */
  const { data: old } = await admin.from('staff_costs').select('file_path').eq('month', journal.month).maybeSingle();

  const { error } = await admin.from('staff_costs').upsert({
    month: journal.month,
    total: journal.total,
    total_haben: journal.totalHaben,
    filename: file.name,
    file_path: path,
    uploaded_at: new Date().toISOString(),
  }, { onConflict: 'month' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (old?.file_path && old.file_path !== path) {
    await admin.storage.from('cashflow-files').remove([old.file_path]).catch(() => {});
  }
  return NextResponse.json({ ok: true, month: journal.month, total: journal.total, replaced: !!old });
}
