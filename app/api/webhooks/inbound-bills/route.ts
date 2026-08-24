import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { canonicalizeSupplierName, getKnownTerms } from '@/lib/canonical-supplier';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SECRET = process.env.INBOUND_BILLS_WEBHOOK_SECRET ?? '';

const SYSTEM_PROMPT = `You are an invoice data extraction assistant. Extract structured data from invoices and return valid JSON only — no markdown, no explanation, no trailing commas, no comments.

The invoices may be in German or English. German terms to know:
- Rechnung = Invoice
- Rechnungsnummer / Rechnungs-Nummer = Invoice number
- Rechnungsdatum = Invoice date
- Fälligkeitsdatum = Due date
- Menge = Quantity
- Einzelpreis / E-Preis = Unit price
- Gesamtpreis / Gesamt / Betrag = Line total
- Zwischensumme = Subtotal
- Umsatzsteuer / MwSt / MWST = VAT
- Gesamtbetrag / Endbetrag / Gesamt = Grand total
- Netto = Net
- Brutto = Gross
- Leergut = Deposit items (returnable packaging — include but flag)

Return this exact JSON structure:
{
  "supplier_name": "string",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "currency": "EUR",
  "payment_method": "string or null",
  "net_amount": number,
  "vat_amount": number,
  "gross_amount": number,
  "suggested_category": "one of: Food Cost | Drinks Cost | Packaging | Software & Technology | Delivery Platform Fees | Repairs & Maintenance | Cleaning Services | Utilities | Rent | Labour | Marketing | Other",
  "lines": [
    {
      "description": "string",
      "quantity": number,
      "unit_price": number,
      "vat_rate": number,
      "line_total": number,
      "is_deposit": boolean
    }
  ]
}

Rules:
- All amounts as plain numbers (no currency symbols), using dot as decimal separator
- Dates in YYYY-MM-DD format
- All property names must use double quotes
- No trailing commas anywhere
- For deposit/Leergut items: include them with is_deposit: true
- If multiple VAT rates exist, use the dominant one for the header; capture per-line rates in lines
- Suggest category based on supplier type and line item descriptions
- If a discount is applied, reflect it in the net_amount (post-discount)

supplier_name accuracy (important — this field is frequently misread):
- Read the supplier's name from PLAIN TEXT, not from the stylised logo. Logos use decorative fonts that are easy to misread. The reliable sources, in order of preference: the letterhead address block, the footer / Impressum, the line next to the USt-IdNr / Steuernummer, and the bank-details block ("Kontoinhaber" / account holder)
- Cross-check the spelling against at least two of those places before deciding. If the logo and the footer disagree, trust the footer
- Transcribe the name character-for-character. Do not guess at, "correct", or normalise unusual German surnames — names like "Leleithner" contain letter sequences that look like typos but are not
- Include the legal form (GmbH, AG, KG, e.K. …) if it is printed, but do NOT append trailing descriptive taglines such as "Getränkegroßhandel und Gastronomiepartner"
- If the document is a self-billing invoice or credit note, supplier_name is the party issuing the goods/services, not the recipient`;

function extractJSONObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) return text.trim();
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return text.slice(start).trim();
}

function cleanResponse(text: string): string {
  return extractJSONObject(text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim());
}

type Attachment = { Name: string; Content: string; ContentType: string };

async function extractFromAttachment(attachment: Attachment): Promise<Record<string, unknown>> {
  const isPdf = attachment.ContentType === 'application/pdf' || attachment.Name.toLowerCase().endsWith('.pdf');
  const textBlock = { type: 'text' as const, text: `Extract all invoice data from this file (filename: ${attachment.Name}) and return the JSON structure described. Return valid JSON only — no markdown, no trailing commas.` };

  let response;
  if (isPdf) {
    response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: attachment.Content } },
          textBlock,
        ],
      }],
    });
  } else {
    const imageType = (attachment.ContentType === 'image/png' ? 'image/png' : 'image/jpeg') as 'image/jpeg' | 'image/png';
    response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: imageType, data: attachment.Content } },
          textBlock,
        ],
      }],
    });
  }

  const raw = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonStr = cleanResponse(raw);
  const extracted = JSON.parse(jsonStr) as Record<string, unknown>;

  // Snap OCR near-misses in the supplier name to the canonical spelling on file.
  try {
    if (typeof extracted.supplier_name === 'string') {
      const known = await getKnownTerms();
      const fixed = canonicalizeSupplierName(extracted.supplier_name, known);
      if (fixed !== extracted.supplier_name) {
        console.log(`[inbound-bills] supplier corrected: ${extracted.supplier_name} -> ${fixed}`);
        extracted.supplier_name = fixed;
      }
    }
  } catch (e) {
    console.error('[inbound-bills] supplier canonicalisation failed (non-fatal):', e);
  }

  return extracted;
}

async function saveBillToDB(attachment: Attachment, extracted: Record<string, unknown>): Promise<string> {
  const admin = getSupabaseAdmin();

  const bytes = Buffer.from(attachment.Content, 'base64');
  const fileName = attachment.Name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `bills/${Date.now()}_${fileName}`;

  const { error: upErr } = await admin.storage
    .from('bills')
    .upload(path, bytes, { contentType: attachment.ContentType || 'application/pdf' });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const invoiceDate = (extracted.invoice_date as string | null) ?? null;

  const { data: bill, error: billErr } = await admin.from('bills').insert({
    supplier_name:  extracted.supplier_name  ?? 'Unknown',
    invoice_number: extracted.invoice_number ?? null,
    invoice_date:   invoiceDate,
    due_date:       extracted.due_date       ?? null,
    net_amount:     extracted.net_amount     ?? 0,
    vat_amount:     extracted.vat_amount     ?? 0,
    gross_amount:   extracted.gross_amount   ?? 0,
    currency:       extracted.currency       ?? 'EUR',
    category:       extracted.suggested_category ?? null,
    payment_method: extracted.payment_method ?? null,
    status:         'pending',
    file_path:      path,
    uploaded_by:    null,
    location_id:    null,
    location_label: null,
    period_type:    'single_date',
    period_start:   invoiceDate,
    period_end:     invoiceDate,
  }).select('id').single();
  if (billErr) throw billErr;

  const lines = extracted.lines as Record<string, unknown>[] | undefined;
  if (lines?.length && bill) {
    await admin.from('bill_lines').insert(
      lines.map((l) => ({
        bill_id:     bill.id,
        description: l.description,
        quantity:    l.quantity,
        unit_price:  l.unit_price,
        vat_rate:    l.vat_rate,
        line_total:  l.line_total,
        category:    extracted.suggested_category ?? null,
      }))
    );
  }

  return bill.id as string;
}

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') ?? req.headers.get('x-webhook-secret') ?? '';
  if (SECRET && secret !== SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const attachments = (payload.Attachments as Attachment[] | undefined) ?? [];
  const billAttachments = attachments.filter((a) => {
    const ct = (a.ContentType ?? '').toLowerCase();
    const name = (a.Name ?? '').toLowerCase();
    return ct === 'application/pdf' || name.endsWith('.pdf') ||
      ct === 'image/jpeg' || ct === 'image/jpg' || ct === 'image/png' ||
      name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png');
  });

  if (billAttachments.length === 0) {
    return NextResponse.json({ message: 'No bill attachments found — email ignored' });
  }

  const results: { name: string; status: string; billId?: string; error?: string }[] = [];

  for (const attachment of billAttachments) {
    try {
      const extracted = await extractFromAttachment(attachment);
      const billId    = await saveBillToDB(attachment, extracted);
      results.push({ name: attachment.Name, status: 'saved', billId });
    } catch (err: any) {
      console.error('Inbound bill processing error:', err);
      results.push({ name: attachment.Name, status: 'error', error: err.message });
    }
  }

  return NextResponse.json({ processed: results });
}
