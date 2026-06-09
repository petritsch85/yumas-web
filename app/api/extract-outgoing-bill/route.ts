import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an invoice data extraction assistant specialising in outgoing event catering invoices written by Yumas GmbH.

These are invoices that Yumas sends TO corporate customers for catering events (dinners, lunches, etc.).
The document is always from Yumas GmbH to a corporate client.

German terms to know:
- Rechnungsnummer = Invoice number
- Rechnungsempfänger = Invoice recipient (the customer)
- Abendessen / Mittagessen am = Dinner / Lunch on (this is the event date)
- Gesamt Essen netto = Total food net
- Gesamt Getränke netto = Total drinks net
- Gesamt Netto = Total net
- Mwst 7% = VAT at 7%
- Mwst 19% = VAT at 19%
- Gesamt Brutto = Total gross
- Trinkgeld = Tips
- Gesamtbetrag (zu zahlen) = Total amount payable

The issuing Yumas location can be inferred from the address in the document header:
- Feuerbachstraße / 60325 Frankfurt → Westend
- Rahmannstraße / 65760 Eschborn → Eschborn
- Taunusstraße / 60329 Frankfurt → Taunus

Return this exact JSON structure (valid JSON only — no markdown, no explanation, no trailing commas):
{
  "customer_name": "string — the company or person the invoice is addressed TO",
  "customer_address": "string — full address of the customer, or null",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "event_date": "YYYY-MM-DD or null — the date of the actual event/dinner/lunch",
  "issuing_location": "Westend | Eschborn | Taunus | null — inferred from Yumas address",
  "net_food": number,
  "net_drinks": number,
  "net_total": number,
  "vat_7": number,
  "vat_19": number,
  "gross_total": number,
  "tips": number,
  "total_payable": number
}

Rules:
- All amounts as plain numbers with dot as decimal separator (e.g. 2119.63 not 2.119,63)
- Dates in YYYY-MM-DD format
- customer_name is the RECIPIENT, never Yumas GmbH
- If a field is not found set it to null (for strings) or 0 (for numbers)

CRITICAL — POS receipt tax classification:
When the document is a POS/cash register receipt (Kassenbon), each line item has a tax code letter printed in the RIGHTMOST column of the receipt (far right edge), after the line total. This letter is ALWAYS either A or B:
- A = 19% MwSt = Getränke (drinks) → counts toward net_drinks / gross drinks
- B = 7% MwSt = Essen (food) → counts toward net_food / gross food

You MUST use ONLY this rightmost column tax letter to classify each item. Do NOT use the item name text to infer the tax bracket. For example, a dish called "Gamba Chipotle B" has the letter B as part of its name — this is NOT a tax code. Only the standalone letter printed at the far right end of the line is the tax code.

To extract gross_food and gross_drinks from a POS receipt:
- Sum all line totals where the rightmost tax letter = B → gross_food (7% tax applies)
- Sum all line totals where the rightmost tax letter = A → gross_drinks (19% tax applies)
- Derive net and VAT amounts from the brutto totals using the respective tax rates

The receipt footer may show a summary table (USt.% / Brutto / Netto / USt.) — use this as a cross-check, but always prefer the per-line classification over the footer if there is a discrepancy.`;

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

export async function POST(req: NextRequest) {
  try {
    const { storagePath, fileName } = await req.json();
    if (!storagePath) return NextResponse.json({ error: 'No storage path provided' }, { status: 400 });

    // Download PDF from Supabase Storage (server-side, no size limit)
    const admin = getSupabaseAdmin();
    const { data: fileBlob, error: dlErr } = await admin.storage.from('bills').download(storagePath);
    if (dlErr || !fileBlob) {
      return NextResponse.json({ error: `Could not download PDF: ${dlErr?.message ?? 'unknown'}` }, { status: 500 });
    }
    const pdfBase64 = Buffer.from(await fileBlob.arrayBuffer()).toString('base64');

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: `Extract all data from this outgoing Yumas catering invoice (filename: ${fileName}). Return valid JSON only.` },
        ],
      }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
    let jsonStr = cleanResponse(raw);

    let extracted: unknown;
    try {
      extracted = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json({ error: 'Could not parse invoice data from PDF' }, { status: 422 });
    }

    return NextResponse.json({ data: extracted });
  } catch (err: any) {
    console.error('Outgoing bill extraction error:', err);
    return NextResponse.json({ error: err.message ?? 'Extraction failed' }, { status: 500 });
  }
}
