import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a receipt data extraction assistant for Yumas GmbH, a restaurant group in Germany.

You will receive a photo of a POS (point-of-sale) thermal receipt / Kassenbon from the Yumas restaurant system.

## Tax bracket mapping
The receipt assigns a tax category letter (shown on the right side of each line item):
- **A = 19% Mehrwertsteuer** → Getränke (drinks)
- **B = 7% Mehrwertsteuer** → Essen (food)

## Your task
1. Find every line item and read its total amount and its tax category letter (A or B).
2. Sum all A-category amounts → this is **getraenkeBrutto** (drinks gross, 19% VAT)
3. Sum all B-category amounts → this is **essenBrutto** (food gross, 7% VAT)
4. Look for any handwritten number on the receipt → this is the **trinkgeld** (tip). Common placements: near "Total", scrawled in margin.
5. Read the date from the receipt header (format DD.MM.YYYY or YYYY-MM-DD).
6. Infer the Yumas branch from the address printed on the receipt:
   - Rahmannstr / Rahmannstraße / 65760 Eschborn → "Eschborn"
   - Feuerbachstr / Feuerbachstraße / 60325 Frankfurt → "Westend"
   - Taunusstr / Taunusstraße / 60329 Frankfurt → "Taunus"

## Important rules
- The receipt often shows "auf Rechnung (-100%)" and a Total of 0,00 € — this means it was billed to a corporate account. IGNORE the discounted total. Use the **Zwischensumme** (subtotal before discount) as the real gross total.
- All amounts must be plain numbers with dot as decimal (e.g. 958.00 not 958,00).
- If a field cannot be determined, use null for strings and 0 for numbers.
- Return ONLY valid JSON — no markdown, no explanation.

## Output JSON schema
{
  "essenBrutto": number,
  "getraenkeBrutto": number,
  "trinkgeld": number,
  "eventDate": "YYYY-MM-DD or null",
  "issuingLocation": "Westend | Eschborn | Taunus | null"
}`;

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
]);

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
    const { imageBase64, mediaType } = await req.json();
    if (!imageBase64) return NextResponse.json({ error: 'No image data provided' }, { status: 400 });

    // Normalise media type — iOS HEIC often arrives as jpeg after browser conversion
    const mt = (mediaType ?? 'image/jpeg').toLowerCase().replace('image/jpg', 'image/jpeg');
    if (!ALLOWED_TYPES.has(mt)) {
      return NextResponse.json({ error: `Unsupported image type: ${mt}` }, { status: 400 });
    }

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mt as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: imageBase64,
            },
          },
          { type: 'text', text: 'Extract the receipt data. Return valid JSON only.' },
        ],
      }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonStr = extractJSONObject(raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim());

    let extracted: unknown;
    try {
      extracted = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json({ error: 'Could not parse receipt data from image' }, { status: 422 });
    }

    return NextResponse.json({ data: extracted });
  } catch (err: any) {
    console.error('Receipt image extraction error:', err);
    return NextResponse.json({ error: err.message ?? 'Extraction failed' }, { status: 500 });
  }
}
