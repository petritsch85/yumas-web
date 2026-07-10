import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a receipt data extraction assistant for Yumas GmbH, a German restaurant group.

You will receive an Orderbird POS receipt (Rechnung) as a PDF. These are corporate bills issued by Yumas to clients.

## Your task
1. Read every line item. Each line has: ANZAHL (qty), BESCHREIBUNG (name), UST (VAT rate), EINZELPREIS (unit price), SUMME (line total).
2. Classify by VAT rate:
   - **7% UST** → Essen (food) → add line SUMME to essenBrutto
   - **19% UST** → Getränke (drinks) → add line SUMME to getraenkeBrutto
3. Use the **Zwischensumme** (subtotal) as the true gross total — NOT the "Total" or "Summe" at the bottom, which may be 0,00 € because the bill was issued "Auf Rechnung" (corporate credit).
4. There is usually NO tip (trinkgeld = 0).
5. Extract the date from the header (format: "Eschborn, DD.MM.YYYY" or "Westend, DD.MM.YYYY" etc.).
6. Infer the Yumas branch from the address on the document:
   - Rahmannstr / Rahmannstraße / 65760 Eschborn → "Eschborn"
   - Feuerbachstr / Feuerbachstraße / 60325 Frankfurt → "Westend"
   - Taunusstr / Taunusstraße / 60329 Frankfurt → "Taunus"

## Rules
- All amounts must be plain numbers with dot as decimal (e.g. 595.00 not 595,00).
- If a field cannot be determined, use null for strings and 0 for numbers.
- Return ONLY valid JSON — no markdown, no explanation.

## Output JSON schema
{
  "essenBrutto": number,
  "getraenkeBrutto": number,
  "trinkgeld": number,
  "eventDate": "YYYY-MM-DD or null",
  "issuingLocation": "Westend | Eschborn | Taunus | null",
  "lineItems": [
    {
      "name": "string",
      "qty": number,
      "total": number,
      "taxCode": "A" | "B"
    }
  ]
}

For lineItems: taxCode "A" = 19% (Getränke), taxCode "B" = 7% (Essen).`;

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

export async function POST(req: NextRequest) {
  try {
    const { pdfBase64 } = await req.json();
    if (!pdfBase64) return NextResponse.json({ error: 'No PDF data provided' }, { status: 400 });

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
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
          { type: 'text', text: 'Extract the receipt data from this Orderbird PDF. Return valid JSON only.' },
        ],
      }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonStr = extractJSONObject(raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim());

    let extracted: unknown;
    try {
      extracted = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json({ error: 'Could not parse receipt data from PDF' }, { status: 422 });
    }

    return NextResponse.json({ data: extracted });
  } catch (err: any) {
    console.error('Orderbird PDF extraction error:', err);
    return NextResponse.json({ error: err.message ?? 'Extraction failed' }, { status: 500 });
  }
}
