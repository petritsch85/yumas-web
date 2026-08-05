import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { classifyTransaction } from '@/lib/cashflow-categorize';

// Auto-detect delimiter: German bank CSVs use semicolons, others use commas
function detectDelimiter(sample: string): string {
  const semis  = (sample.match(/;/g)  ?? []).length;
  const commas = (sample.match(/,/g)  ?? []).length;
  return semis > commas ? ';' : ',';
}

function parseCSVRow(line: string, delimiter: string): string[] {
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
      fields.push(field.trim());
      if (line[i] === delimiter) i++;
    } else {
      let field = '';
      while (i < line.length && line[i] !== delimiter) field += line[i++];
      fields.push(field.trim());
      if (line[i] === delimiter) i++;
    }
  }
  return fields;
}

function splitCSVLines(text: string): string[] {
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
  s = s.trim();
  // DD/MM/YYYY
  const slash = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;
  // DD.MM.YYYY
  const dot = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dot)   return `${dot[3]}-${dot[2]}-${dot[1]}`;
  return null;
}

// Handles integer cents (already in minor units) OR German decimal euro format "1.234,56"
function parseAmountCents(s: string): number | null {
  const clean = s.trim().replace(/\s/g, '');
  if (!clean) return null;

  // Pure integer → treat as cents
  if (/^-?\d+$/.test(clean)) return parseInt(clean, 10);

  // German format: optional sign, digits with optional dot-thousands, comma-decimal
  // e.g. "-1.234,56" or "1234,56" or "-720.600,00"
  const german = clean.match(/^(-?)(\d{1,3}(?:\.\d{3})*),(\d{2})$/) ??
                 clean.match(/^(-?)(\d+),(\d{2})$/);
  if (german) {
    const sign  = german[1] === '-' ? -1 : 1;
    const whole = german[2].replace(/\./g, '');
    return sign * (parseInt(whole, 10) * 100 + parseInt(german[3], 10));
  }

  return null;
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

    const delimiter = detectDelimiter(text.slice(0, 500));
    const lines     = splitCSVLines(text);

    // Find the header row that contains "Buchungstag" — some bank exports have metadata before it
    const headerIdx = lines.findIndex(l => /Buchungstag/i.test(l));
    const dataLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines.slice(1);

    const admin = getSupabaseAdmin();

    // Create upload record first (file_path added separately — column may not exist before migration)
    const { data: upload, error: uploadErr } = await admin
      .from('cashflow_uploads')
      .insert({ filename: file.name, period_label: periodLabel.trim(), transaction_count: 0 })
      .select()
      .single();

    if (uploadErr || !upload) return NextResponse.json({ error: uploadErr?.message ?? 'Upload create failed' }, { status: 500 });

    // Save original CSV to storage — non-fatal if it fails
    try {
      await admin.storage.createBucket('cashflow-files', { public: false }).catch(() => {});
      const safeLabel = periodLabel.trim().replace(/[^a-zA-Z0-9-_]/g, '_');
      const storagePath = `uploads/${safeLabel}_${Date.now()}_${file.name}`;
      const { error: storeErr } = await admin.storage
        .from('cashflow-files')
        .upload(storagePath, buf, { contentType: 'text/csv', upsert: false });
      if (!storeErr) {
        await admin.from('cashflow_uploads').update({ file_path: storagePath }).eq('id', upload.id);
      }
    } catch { /* non-fatal */ }

    const txRows: object[] = [];
    for (const line of dataLines) {
      const cols = parseCSVRow(line, delimiter);

      // Expected: Buchungstag | Verwendungszweck | Kundenreferenz (End-to-End) | Beguenstigter/Zahlungspflichtiger | Betrag
      if (cols.length < 5) continue;

      const dateStr     = cols[0];
      const description = cols[1];
      const counterparty = cols[3];   // col 3 = Beguenstigter/Zahlungspflichtiger
      const amountStr   = cols[4];    // col 4 = Betrag

      const date = parseGermanDate(dateStr);
      if (!date) continue;

      const amountCents = parseAmountCents(amountStr);
      if (amountCents === null) continue;

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
