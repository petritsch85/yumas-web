import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

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
- If a discount is applied, reflect it in the net_amount (post-discount)`;

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

/** Ask Claude to repair malformed JSON */
async function repairJSON(bad: string): Promise<string> {
  const repair = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `The following text is supposed to be a JSON object but has syntax errors. Fix it and return only valid JSON with no explanation, no markdown, no trailing commas, and all property names in double quotes:\n\n${bad}`,
      },
    ],
  });
  const repairText = repair.content[0].type === 'text' ? repair.content[0].text : '';
  return cleanResponse(repairText);
}

export async function POST(req: NextRequest) {
  try {
    const { pdfBase64, fileName } = await req.json();

    if (!pdfBase64) {
      return NextResponse.json({ error: 'No PDF data provided' }, { status: 400 });
    }

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
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
        return NextResponse.json(
          { error: `Could not parse invoice data: ${repairErr.message}` },
          { status: 422 }
        );
      }
    }

    return NextResponse.json({ data: extracted });
  } catch (err: any) {
    console.error('Bill extraction error:', err);
    return NextResponse.json({ error: err.message ?? 'Extraction failed' }, { status: 500 });
  }
}
