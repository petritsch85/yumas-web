import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a receipt data extraction assistant for Yumas GmbH, a restaurant group in Germany.

You will receive an image of a receipt. It is one of two kinds, and you must decide which before reading anything else:

**KIND 1 — Yumas POS Kassenbon.** A thermal till receipt from the Yumas restaurant system. Every line carries a tax letter (A or B) in the rightmost column.

**KIND 2 — Delivery platform receipt** (Lieferando, Wolt, Uber Eats, or our own webshop). No tax letters. A quantity column on the LEFT, item name, and a price on the right. It ends with a block of Zwischensumme / Servicegebuehr / Lieferung / Trinkgeld / Gesamt.

Set "receiptKind" to "pos" or "delivery" accordingly. The rules below differ by kind — apply the right ones.

## CRITICAL RULE for KIND 2 — the printed price is PER UNIT
On a delivery receipt the number on the left of the item name is the quantity, and the price on the right is the price of ONE unit. A line reading "2  Chicken Bowl  EUR13.50" is worth **27.00**, not 13.50.

So for every line: lineTotal = qty x unitPrice. Report unitPrice as printed and lineTotal as the product.

**Then check your work against the printed Zwischensumme.** The sum of every item lineTotal must equal it. If it does not, you have misread a quantity or a price — reread the receipt until it reconciles. Report the printed Zwischensumme as "subtotal" and the printed Gesamt as "documentTotal" so the discrepancy can be caught downstream.

Sub-lines indented under an item (an option such as "gegrillte Tortilla EUR2.00", or a note with no price) are separate chargeable lines only when they carry their own price. A note with no price ("ohne Sour-Cream bitte", "mild") is not a line at all — skip it.

## CRITICAL RULE for KIND 1 — tax category letter determines food vs drinks
Each line item on the receipt has a letter printed in the RIGHTMOST column (far right edge of the line):
- **A** → Getränke / Drinks (19% VAT) — add this line's amount to getraenkeBrutto
- **B** → Essen / Food (7% VAT) — add this line's amount to essenBrutto

**You MUST use ONLY this letter to classify each line item. Never use the item name to guess whether something is food or drink.** A burger, taco, or any food item with letter A goes into getraenkeBrutto. A beer or drink with letter B goes into essenBrutto. The letter is the single source of truth.

## Your task (KIND 1)
1. For every line item: read the amount and the tax letter (A or B) from the rightmost column.
2. Sum all amounts where the letter is **A** → **getraenkeBrutto**
3. Sum all amounts where the letter is **B** → **essenBrutto**
4. Look for any handwritten annotation on the receipt → this is the **trinkgeld** (tip). Common placements: near "Total", scrawled in margin. Two possible formats:
   - A plain number (e.g. "15" or "15,00") → use that as trinkgeld directly
   - A percentage (e.g. "10%") → calculate trinkgeld as that percentage of the Gesamt Brutto (essenBrutto + getraenkeBrutto), rounded to 2 decimal places
5. Read the date from the receipt header (format DD.MM.YYYY or YYYY-MM-DD).
6. Infer the Yumas branch from the address printed on the receipt:
   - Rahmannstr / Rahmannstraße / 65760 Eschborn → "Eschborn"
   - Feuerbachstr / Feuerbachstraße / 60325 Frankfurt → "Westend"
   - Taunusstr / Taunusstraße / 60329 Frankfurt → "Taunus"

## Additional rules
- The receipt often shows "auf Rechnung (-100%)" and a Total of 0,00 € — this means it was billed to a corporate account. IGNORE the discounted total. Use the **Zwischensumme** (subtotal before discount) as the real gross total.
- All amounts must be plain numbers with dot as decimal (e.g. 958.00 not 958,00).
- If a field cannot be determined, use null for strings and 0 for numbers.
- Return ONLY valid JSON — no markdown, no explanation.

## Output JSON schema
{
  "receiptKind": "pos" | "delivery",
  "essenBrutto": number,
  "getraenkeBrutto": number,
  "trinkgeld": number,
  "subtotal": number,
  "documentTotal": number,
  "eventDate": "YYYY-MM-DD or null",
  "issuingLocation": "Westend | Eschborn | Taunus | null",
  "lineItems": [
    {
      "name": "string — item name as printed on receipt",
      "qty": number,
      "unitPrice": number,
      "total": number,
      "taxCode": "A" | "B" | null,
      "category": "food" | "drink" | "fee"
    }
  ]
}

"total" is ALWAYS the line total (qty x unitPrice), never the unit price.

## Your task (KIND 2)
1. For every item line: read qty, unitPrice and compute lineTotal = qty x unitPrice. Set category to "food" or "drink" from the item name (a delivery receipt has no tax letters, so here the name IS the evidence). Set taxCode to null.
2. Read the fee lines at the foot and return each as its own line item with category "fee": Servicegebuehr, Liefergebuehr / Lieferung, Verpackung, and any similar charge. qty 1, unitPrice = lineTotal = the printed amount.
3. Trinkgeld is NOT a line item — put it in "trinkgeld" only.
4. essenBrutto = sum of lineTotal where category is "food". getraenkeBrutto = sum where category is "drink". Fees go in NEITHER — they are reported only as line items, so the caller can decide their VAT treatment.
5. Read "subtotal" (Zwischensumme) and "documentTotal" (Gesamt) exactly as printed.
6. Infer the branch from the address at the top of the receipt, same list as above.

For lineItems: include every chargeable line from the receipt. On a KIND 1 receipt the taxCode MUST be the letter from the rightmost column — never infer it from the item name. On a KIND 2 receipt there are no letters: set taxCode null and use category.

## Final self-check before answering
- KIND 2: does the sum of item lineTotals equal the printed Zwischensumme? Does Zwischensumme + fees + Trinkgeld equal the printed Gesamt? If not, reread.
- Every multi-quantity line must have lineTotal greater than unitPrice. A line with qty 2 and lineTotal equal to unitPrice is the single commonest mistake on these receipts.`;

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
      max_tokens: 4096,
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
