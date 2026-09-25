import { NextRequest, NextResponse, after } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import PostalMime from 'postal-mime';
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

type Attachment = { Name: string; Content: string; ContentType: string; ContentID?: string };

/* A batch arrives as one email with each original forwarded "as attachment"
   (Gmail: select several → ⋮ → Forward as attachment). The work runs after
   the reply to Postmark, so a batch of bills is not cut off by its timeout. */
export const maxDuration = 300;

/** How many bills are read at once — enough to clear a batch, few enough not to hit the API's rate limit. */
const CONCURRENCY = 3;

const isPdf   = (ct: string, name: string) => ct === 'application/pdf' || name.endsWith('.pdf');
const isImage = (ct: string, name: string) =>
  ct === 'image/jpeg' || ct === 'image/jpg' || ct === 'image/png' ||
  name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png');
const isEmail = (ct: string, name: string) => ct === 'message/rfc822' || name.endsWith('.eml');

/* The logo in an email signature ("image001.png") is not a bill. It is
   embedded in the body, not attached, and small. */
const isSignatureImage = (name: string, inline: boolean, bytes: number) =>
  inline || /^image\d{3}\.(png|jpe?g)$/i.test(name) || bytes < 15_000;

/** The bills in one email, looking inside any email forwarded as an attachment. */
async function collectBills(attachments: Attachment[], depth = 0): Promise<Attachment[]> {
  const found: Attachment[] = [];
  for (const a of attachments) {
    const ct = (a.ContentType ?? '').toLowerCase().split(';')[0].trim();
    const name = (a.Name ?? '').toLowerCase();
    const bytes = Math.floor((a.Content?.length ?? 0) * 3 / 4);

    if (isEmail(ct, name) && depth < 3) {
      try {
        const inner = await PostalMime.parse(Buffer.from(a.Content, 'base64'), { attachmentEncoding: 'base64' });
        found.push(...await collectBills(inner.attachments.map(x => ({
          Name:        x.filename ?? 'attachment',
          Content:     x.content as string,
          ContentType: x.mimeType,
          ContentID:   x.disposition === 'inline' || x.related ? (x.contentId ?? 'inline') : undefined,
        })), depth + 1));
      } catch (e) {
        console.error(`[inbound-bills] could not read forwarded email ${a.Name}:`, e);
      }
    } else if (isPdf(ct, name)) {
      found.push(a);
    } else if (isImage(ct, name) && !isSignatureImage(name, !!a.ContentID, bytes)) {
      found.push(a);
    }
  }
  return found;
}

/* A bill forwarded twice — or a batch Postmark delivers again — must not
   appear twice. Same supplier, same number, same amount is the same bill. */
async function findDuplicate(extracted: Record<string, unknown>): Promise<string | null> {
  const invoiceNumber = extracted.invoice_number as string | null;
  if (!invoiceNumber) return null;
  const { data } = await getSupabaseAdmin()
    .from('bills')
    .select('id, supplier_name, gross_amount')
    .eq('invoice_number', invoiceNumber)
    .limit(10);
  const gross = Number(extracted.gross_amount ?? 0);
  const supplier = String(extracted.supplier_name ?? '').toLowerCase();
  const hit = (data ?? []).find(b =>
    Math.abs(Number(b.gross_amount) - gross) < 0.01 &&
    String(b.supplier_name ?? '').toLowerCase() === supplier);
  return hit?.id ?? null;
}

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
  const billAttachments = await collectBills(attachments);

  if (billAttachments.length === 0) {
    return NextResponse.json({ message: 'No bill attachments found — email ignored' });
  }

  after(async () => {
    const queue = [...billAttachments];
    const worker = async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        try {
          const extracted = await extractFromAttachment(a);
          const duplicate = await findDuplicate(extracted);
          if (duplicate) {
            console.log(`[inbound-bills] ${a.Name}: already on file as ${duplicate} — skipped`);
            continue;
          }
          const billId = await saveBillToDB(a, extracted);
          console.log(`[inbound-bills] ${a.Name}: saved as ${billId}`);
        } catch (err) {
          console.error(`[inbound-bills] ${a.Name}: processing failed:`, err);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, billAttachments.length) }, worker));
  });

  return NextResponse.json({ queued: billAttachments.map(a => a.Name) });
}
