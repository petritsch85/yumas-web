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

/**
 * Reads a booking date.
 *
 * Banks differ on the year: some write "31.07.2026", Sparkasse writes
 * "31.07.26". A two-digit year is read as this century — these are bank
 * statements, so a date decades in the past is not a case worth handling.
 */
function parseGermanDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 4 ? y : `20${y}`;
  return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Works out which column holds what.
 *
 * Bank exports vary in both width and order — one has the date first, the
 * Sparkasse export puts the account there and the date second, with seventeen
 * columns in all. Reading the header by name rather than counting positions
 * means a new export layout is understood instead of silently importing
 * nothing.
 */
const FIELD_ALIASES = {
  date:         ['buchungstag', 'valutadatum', 'datum', 'date'],
  description:  ['verwendungszweck', 'buchungstext', 'description', 'reference'],
  counterparty: ['beguenstigter/zahlungspflichtiger', 'begünstigter/zahlungspflichtiger',
                 'beguenstigter', 'begünstigter', 'zahlungspflichtiger',
                 'auftraggeber/empfänger', 'auftraggeber', 'empfänger', 'counterparty'],
  amount:       ['betrag', 'umsatz', 'amount'],
} as const;

type FieldMap = { date: number; description: number; counterparty: number; amount: number };

/** Positions used by the export this importer was first written for. */
const FALLBACK: FieldMap = { date: 0, description: 1, counterparty: 3, amount: 4 };

function mapColumns(headerCols: string[] | null): FieldMap {
  if (!headerCols) return FALLBACK;
  const norm = headerCols.map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const find = (aliases: readonly string[]) => {
    for (const a of aliases) {
      const exact = norm.indexOf(a);
      if (exact >= 0) return exact;
    }
    for (const a of aliases) {
      const partial = norm.findIndex(h => h.includes(a));
      if (partial >= 0) return partial;
    }
    return -1;
  };
  const map: FieldMap = {
    date:         find(FIELD_ALIASES.date),
    description:  find(FIELD_ALIASES.description),
    counterparty: find(FIELD_ALIASES.counterparty),
    amount:       find(FIELD_ALIASES.amount),
  };
  // A header we cannot read is worse than the layout we already know.
  if (map.date < 0 || map.amount < 0) return FALLBACK;
  if (map.description  < 0) map.description  = FALLBACK.description;
  if (map.counterparty < 0) map.counterparty = FALLBACK.counterparty;
  return map;
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
    const col = mapColumns(headerIdx >= 0 ? parseCSVRow(lines[headerIdx], delimiter) : null);

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

      if (cols.length < 5) continue;

      const dateStr      = cols[col.date]         ?? '';
      const description  = cols[col.description]  ?? '';
      const counterparty = cols[col.counterparty] ?? '';
      const amountStr    = cols[col.amount]       ?? '';

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

    /* A file that yields nothing is a problem to report, not a successful
       import of zero. Saying which columns were read makes the next unfamiliar
       export layout diagnosable from the message alone. */
    if (txRows.length === 0) {
      await admin.from('cashflow_uploads').delete().eq('id', upload.id);
      const names = headerIdx >= 0 ? parseCSVRow(lines[headerIdx], delimiter) : [];
      const used  = (i: number) => (names[i] ? `"${names[i]}"` : `column ${i + 1}`);
      return NextResponse.json({
        error:
          `No transactions could be read. ${dataLines.length} data row${dataLines.length === 1 ? '' : 's'} were found, ` +
          `but none had both a readable date and amount. ` +
          `Read the date from ${used(col.date)} and the amount from ${used(col.amount)}.`,
      }, { status: 422 });
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
