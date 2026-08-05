import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { classifyTransaction } from '@/lib/cashflow-categorize';

// Parse a CSV string handling quoted fields (fields may contain commas and newlines inside quotes)
function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(''); break; }
    if (line[i] === '"') {
      i++;
      let field = '';
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { field += line[i++]; }
      }
      fields.push(field);
      if (line[i] === ',') i++;
    } else {
      let field = '';
      while (i < line.length && line[i] !== ',') field += line[i++];
      fields.push(field.trim());
      if (line[i] === ',') i++;
    }
  }
  return fields;
}

function splitCSVLines(text: string): string[] {
  // Split on newlines not inside quotes
  const lines: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuote = !inQuote;
    else if ((c === '\n' || c === '\r') && !inQuote) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (cur.trim()) lines.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) lines.push(cur);
  return lines;
}

function parseGermanDate(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const periodLabel = (formData.get('periodLabel') as string | null) ?? '';

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!periodLabel.trim()) return NextResponse.json({ error: 'Period label required' }, { status: 400 });

    // Try UTF-8, fall back to Latin-1 (German bank CSVs are often ISO-8859-1)
    const buf = await file.arrayBuffer();
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { text = new TextDecoder('iso-8859-1').decode(buf); }

    const lines = splitCSVLines(text);
    const dataLines = lines.slice(1); // skip header

    const admin = getSupabaseAdmin();

    // Save original CSV to storage (cashflow-files bucket) so the upload log can serve it
    let storedFilePath: string | null = null;
    try {
      await admin.storage.createBucket('cashflow-files', { public: false }).catch(() => {/* already exists */});
      const safeLabel = periodLabel.trim().replace(/[^a-zA-Z0-9-_]/g, '_');
      const storagePath = `uploads/${safeLabel}_${Date.now()}_${file.name}`;
      const { error: storeErr } = await admin.storage
        .from('cashflow-files')
        .upload(storagePath, buf, { contentType: 'text/csv', upsert: false });
      if (!storeErr) storedFilePath = storagePath;
    } catch { /* non-fatal — upload log will show without download link */ }

    const { data: upload, error: uploadErr } = await admin
      .from('cashflow_uploads')
      .insert({ filename: file.name, period_label: periodLabel.trim(), transaction_count: 0, file_path: storedFilePath })
      .select()
      .single();

    if (uploadErr || !upload) return NextResponse.json({ error: uploadErr?.message ?? 'Upload create failed' }, { status: 500 });

    const txRows: object[] = [];
    for (const line of dataLines) {
      const cols = parseCSVRow(line);
      if (cols.length < 4) continue;

      const [dateStr, description, counterparty, amountStr] = cols;
      const date = parseGermanDate(dateStr);
      if (!date) continue;

      const amountCents = parseInt(amountStr.replace(/\s/g, ''), 10);
      if (isNaN(amountCents)) continue;

      const direction = amountCents >= 0 ? 'in' : 'out';
      const { category, salesType } = classifyTransaction(counterparty, description, direction);

      txRows.push({
        upload_id:    upload.id,
        date,
        description:  description.trim().slice(0, 1000),
        counterparty: counterparty.trim().slice(0, 300),
        amount_cents: Math.abs(amountCents),
        direction,
        category,
        location:     'Other',
        sales_type:   salesType,
        notes:        '',
      });
    }

    // Insert in batches of 200
    for (let i = 0; i < txRows.length; i += 200) {
      const { error } = await admin.from('cashflow_transactions').insert(txRows.slice(i, i + 200));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await admin.from('cashflow_uploads').update({ transaction_count: txRows.length }).eq('id', upload.id);

    return NextResponse.json({ ok: true, uploadId: upload.id, count: txRows.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
