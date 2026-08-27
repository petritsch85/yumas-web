import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { canonicalizeSupplierName, getKnownTerms } from '@/lib/canonical-supplier';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
- Abrechnungszeitraum / Abrechnungsperiode / Leistungszeitraum / Billing period = the date range the invoice covers (distinct from the invoice date itself)

Return this exact JSON structure:
{
  "supplier_name": "string",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "billing_period_start": "YYYY-MM-DD or null",
  "billing_period_end": "YYYY-MM-DD or null",
  "currency": "EUR",
  "payment_method": "string or null",
  "net_amount": number,
  "vat_amount": number,
  "gross_amount": number,
  "suggested_category": "one of: Food Cost | Drinks Cost | Packaging | Software & Technology | Delivery Platform Fees | Repairs & Maintenance | Cleaning Services | Utilities | Rent | Labour | Marketing | Other",
  "delivery_address": {
    "street": "string or null",
    "postcode": "string or null",
    "city": "string or null",
    "full": "string or null"
  },
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
- billing_period_start / billing_period_end: if the invoice shows a billing/service period (Abrechnungszeitraum, Leistungszeitraum, "period: X – Y", etc.), extract the start and end dates of that period in YYYY-MM-DD format. Set both to null if no billing period is stated.
- delivery_address: extract the delivery/ship-to address from the invoice (Lieferadresse / Lieferanschrift / Warenempfänger). This is the address where goods were delivered TO, NOT the supplier's address. Set to null fields if not found

supplier_name accuracy (important — this field is frequently misread):
- Read the supplier's name from PLAIN TEXT, not from the stylised logo. Logos use decorative fonts that are easy to misread. The reliable sources, in order of preference: the letterhead address block, the footer / Impressum, the line next to the USt-IdNr / Steuernummer, and the bank-details block ("Kontoinhaber" / account holder)
- Cross-check the spelling against at least two of those places before deciding. If the logo and the footer disagree, trust the footer
- Transcribe the name character-for-character. Do not guess at, "correct", or normalise unusual German surnames — names like "Leleithner" contain letter sequences that look like typos but are not
- Include the legal form (GmbH, AG, KG, e.K. …) if it is printed, but do NOT append trailing descriptive taglines such as "Getränkegroßhandel und Gastronomiepartner"
- If the document is a self-billing invoice or credit note, supplier_name is the party issuing the goods/services, not the recipient`;

/**
 * Every invoice satisfies net + VAT = gross. Extraction is a model reading a
 * PDF, so it is non-deterministic — the same file has been read twice with
 * different numbers, once with the columns shifted so the net landed in the VAT
 * field. Checking this identity costs nothing and catches exactly that.
 */
class ParseError extends Error {}

function arithmeticOk(d: Record<string, unknown>): boolean {
  const net   = Number(d.net_amount);
  const vat   = Number(d.vat_amount);
  const gross = Number(d.gross_amount);
  if (![net, vat, gross].every(Number.isFinite)) return false;
  // A gross of 0 with nothing else is an empty extraction, not a valid bill.
  if (net === 0 && vat === 0 && gross === 0) return false;
  return Math.abs(net + vat - gross) <= 0.02;
}

/** Pull the outermost JSON object out of a string that may contain surrounding text */
function extractJSONObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) return text.trim();

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start).trim();
}

/** Strip markdown fences and pull out the JSON object */
function cleanResponse(text: string): string {
  const stripped = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  return extractJSONObject(stripped);
}

/** Ask Claude to repair or complete malformed/truncated JSON */
async function repairJSON(bad: string): Promise<string> {
  const isTruncated = !bad.trimEnd().endsWith('}');
  const instruction = isTruncated
    ? `The following JSON was cut off mid-response and is incomplete. Complete it so it is valid JSON matching this structure: { supplier_name, invoice_number, invoice_date, due_date, billing_period_start, billing_period_end, currency, payment_method, net_amount, vat_amount, gross_amount, suggested_category, lines[] }. Return only the completed valid JSON, no markdown, no explanation:`
    : `The following text is supposed to be a JSON object but has syntax errors. Fix it and return only valid JSON, no markdown, no trailing commas, all property names in double quotes:`;

  const repair = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: `${instruction}\n\n${bad}`,
      },
    ],
  });
  const repairText = repair.content[0].type === 'text' ? repair.content[0].text : '';
  return cleanResponse(repairText);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fileName } = body;
    let { pdfBase64, storagePath } = body;

    if (!pdfBase64 && !storagePath) {
      return NextResponse.json({ error: 'Provide pdfBase64 or storagePath' }, { status: 400 });
    }

    if (!pdfBase64 && storagePath) {
      const { getSupabaseAdmin } = await import('@/lib/supabase-admin');
      const admin = getSupabaseAdmin();
      const { data: fileBlob, error: dlErr } = await admin.storage.from('bills').download(storagePath);
      if (dlErr || !fileBlob) {
        return NextResponse.json({ error: `Could not download PDF: ${dlErr?.message ?? 'unknown'}` }, { status: 500 });
      }
      pdfBase64 = Buffer.from(await fileBlob.arrayBuffer()).toString('base64');
    }

    const runExtraction = async (): Promise<Record<string, unknown>> => {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: `Extract all invoice data from this PDF (filename: ${fileName}) and return the JSON structure described. Return valid JSON only — no markdown fences, no trailing commas, all keys double-quoted.`,
            },
          ],
        },
      ],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
    let jsonStr = cleanResponse(raw);

    let extracted: unknown;
    try {
      extracted = JSON.parse(jsonStr);
    } catch {
      // First parse failed — ask Claude to repair it
      try {
        jsonStr = await repairJSON(jsonStr);
        extracted = JSON.parse(jsonStr);
      } catch (repairErr: any) {
        throw new ParseError(`Could not parse invoice data: ${repairErr.message}`);
      }
    }
      return extracted as Record<string, unknown>;
    };

    // Extract, then verify net + VAT = gross. A failure means the model misread
    // the totals (most often a column shift), so try once more before accepting.
    let extracted = await runExtraction();
    let retried = false;
    if (!arithmeticOk(extracted)) {
      console.warn('[extract-bill] arithmetic failed, retrying once:', {
        net: extracted.net_amount, vat: extracted.vat_amount, gross: extracted.gross_amount,
      });
      retried = true;
      const second = await runExtraction();
      // Keep whichever run is self-consistent; prefer the retry if both fail.
      extracted = arithmeticOk(second) ? second : (arithmeticOk(extracted) ? extracted : second);
    }
    const ok = arithmeticOk(extracted);
    if (!ok) {
      console.error('[extract-bill] totals still inconsistent after retry:', {
        net: extracted.net_amount, vat: extracted.vat_amount, gross: extracted.gross_amount,
      });
    }

    // Snap OCR near-misses in the supplier name to the canonical spelling we
    // already have on file (e.g. "BIER-ZENTRALE LEIEITHNER GMBH" -> "…Leleithner…").
    try {
      const rec = extracted as Record<string, unknown>;
      if (typeof rec?.supplier_name === 'string') {
        const known = await getKnownTerms();
        const fixed = canonicalizeSupplierName(rec.supplier_name, known);
        if (fixed !== rec.supplier_name) {
          console.log(`[extract-bill] supplier corrected: ${rec.supplier_name} -> ${fixed}`);
          rec.supplier_name = fixed;
        }
      }
    } catch (e) {
      console.error('[extract-bill] supplier canonicalisation failed (non-fatal):', e);
    }

    return NextResponse.json({
      data: extracted,
      validation: {
        arithmeticOk: ok,
        retried,
        message: ok ? null
          : `net (${extracted.net_amount}) + VAT (${extracted.vat_amount}) does not equal gross (${extracted.gross_amount}) — check this bill against the PDF`,
      },
    });
  } catch (err: any) {
    if (err instanceof ParseError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error('Bill extraction error:', err);
    return NextResponse.json({ error: err.message ?? 'Extraction failed' }, { status: 500 });
  }
}
