import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { canonicalizeSupplierName, getKnownTerms } from '@/lib/canonical-supplier';

/**
 * Reading a bill: the model call and the supplier-name clean-up after it.
 *
 * Shared by the email import and by "Not imported", where a document whose
 * reading failed is read again rather than filed with nothing in it.
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type Attachment = { Name: string; Content: string; ContentType: string; ContentID?: string };

const SYSTEM_PROMPT = `You are an invoice data extraction assistant. Extract structured data from invoices and return valid JSON only — no markdown, no explanation, no trailing commas, no comments.

The invoices may be in German or English. German terms to know:
- Rechnung = Invoice
- Rechnungsnummer / Rechnungs-Nummer = Invoice number
- Rechnungsdatum = Invoice date
- Fälligkeitsdatum / Zahlungsziel / Valuta = Due date
- Zahlbar sofort / sofort ohne Abzüge / netto Kasse = payable immediately (a condition, not a date)
- Zahlbar innerhalb von 14 Tagen / 14 Tage netto = payable within N days of the invoice date
- Menge = Quantity
- Einzelpreis / E-Preis = Unit price
- Gesamtpreis / Gesamt / Betrag = Line total
- Zwischensumme = Subtotal
- Umsatzsteuer / MwSt / MWST = VAT
- Gesamtbetrag / Endbetrag / Gesamt = Grand total
- Netto = Net
- Brutto = Gross
- Leergut = Deposit items (returnable packaging — include but flag)
- Skonto = early-payment discount
- abgebucht / eingezogen = collected by direct debit

Return this exact JSON structure:
{
  "document_type": "one of: invoice | credit_note | delivery_note | order_confirmation | quote | reminder | statement | other",
  "supplier_name": "string",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "currency": "EUR",
  "payment_method": "how and by when it is to be paid, copied as printed — e.g. 'Zahlbar sofort ohne Abzüge', 'SEPA-Lastschrift', '14 Tage netto'. Always fill this where the invoice states any payment condition, even when no due date is given. null only when the invoice says nothing at all",
  "net_amount": number,
  "vat_amount": number,
  "gross_amount": number,
  "settlement_amount": "number or null — what the supplier will actually collect, when the invoice prints it",
  "settlement_date": "YYYY-MM-DD or null — the date the invoice says the debit falls",
  "discount_amount": "number or null — the Skonto in euros, as printed",
  "discount_percent": "number or null — the Skonto rate, as printed",
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

document_type — decide this first. The mailbox also receives documents that are not bills, and only a bill may be filed as one:
- invoice: a Rechnung asking for or recording payment for goods or services — including Sammelrechnung, Abschlagsrechnung, Dauerrechnung, a self-billing Gutschrift (Gutschriftverfahren), a platform's monthly Abrechnung that carries an invoice number or VAT breakdown, and a till receipt / Quittung for a purchase
- credit_note: a Gutschrift, Rechnungskorrektur or Stornorechnung that reduces or cancels an earlier invoice
- delivery_note: a Lieferschein / Warenbegleitschein — lists goods delivered, even when it shows prices, but asks for no payment
- order_confirmation: Auftragsbestätigung / Bestellbestätigung
- quote: Angebot / Kostenvoranschlag
- reminder: Zahlungserinnerung / Mahnung about an invoice already sent
- statement: Kontoauszug, Kontoübersicht, Saldenbestätigung, open-items list
- other: anything else (price lists, newsletters, contracts, terms, payslips …)
The title printed on the document is the strongest signal ("Rechnung", "Lieferschein", …). A Lieferschein that also says "Rechnung folgt" is a delivery_note; a combined "Lieferschein / Rechnung" with a total due is an invoice. For anything other than invoice or credit_note, still fill in the other fields as far as the document allows.

Rules:
- All amounts as plain numbers (no currency symbols), using dot as decimal separator
- Dates in YYYY-MM-DD format
- All property names must use double quotes
- No trailing commas anywhere
- For deposit/Leergut items: include them with is_deposit: true
- If multiple VAT rates exist, use the dominant one for the header; capture per-line rates in lines
- Suggest category based on supplier type and line item descriptions
- If a discount is applied, reflect it in the net_amount (post-discount)
- Skonto: many German suppliers print exactly what they will collect, e.g. "Der Rechnungsbetrag wird am 02.10.26 per Lastschrift abzüglich 2.00 % / 14.46 EUR Skonto = 756.24 EUR abgebucht". Copy those figures into settlement_amount (756.24), discount_amount (14.46), discount_percent (2.00) and settlement_date (2026-10-02). gross_amount stays the invoice total (770.70) — never reduce it by the Skonto. Leave all four null when the invoice offers no discount, and never calculate them yourself: the discount runs on the supplier's own base, which excludes Pfand and Leergut, so it is not a fixed percentage of the gross
- Line items: read each number from the column it sits under. Menge / G-Menge / Anzahl is the quantity, E-Preis / Einzelpreis the unit price; Kolli and Inhalt are packaging counts, not the quantity. Check that quantity × unit_price equals line_total for every line and re-read the row if it does not

supplier_name accuracy (important — this field is frequently misread):
- Yumas GmbH (any company named Yumas) is the CUSTOMER on an ordinary invoice — not the supplier. The one exception is a self-billing invoice (Gutschrift / Gutschriftverfahren) issued in Yumas's name, where Yumas is the seller. Its name sits in the address window (the recipient block, usually top-left under a small sender line); that block is the recipient, not the letterhead. If you find yourself about to answer "Yumas", read the small sender line above the address window, the footer and the bank details instead
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


/** Case, accents and punctuation removed — two spellings of one name match here. */
const nameKey = (s: string) => s.toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]/g, '');

/**
 * The spelling this supplier's existing bills already use.
 *
 * Matching ignores case and punctuation, and accepts a name that only differs
 * by a trailing tagline — "… GmbH Getränkegrosshandel und Gastronomiepartner"
 * is the same merchant as "… GmbH". Returns null when the supplier is new or
 * its spellings disagree, in which case the extracted name stands.
 */
async function establishedSpelling(raw: string): Promise<string | null> {
  const key = nameKey(raw);
  if (key.length < 6) return null;
  const { data } = await getSupabaseAdmin()
    .from('bills')
    .select('supplier_name')
    .ilike('supplier_name', `%${raw.trim().split(/\s+/)[0]}%`)
    .limit(500);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const name = String(row.supplier_name ?? '').trim();
    const k = nameKey(name);
    if (!k) continue;
    // The same string, or one a prefix of the other with enough in common.
    const [short, long] = k.length <= key.length ? [k, key] : [key, k];
    if (k !== key && !(short.length >= 12 && long.startsWith(short))) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
}

export async function extractFromAttachment(attachment: Attachment): Promise<Record<string, unknown>> {
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
      /* Then to the spelling this supplier already uses here. The model copies
         the name off the page and the page is not consistent — Leleithner
         invoices its own name in six different casings — so a bill would
         otherwise arrive as a supplier of its own. */
      const settled = await establishedSpelling(extracted.supplier_name as string);
      if (settled && settled !== extracted.supplier_name) {
        console.log(`[inbound-bills] supplier spelling settled: ${extracted.supplier_name} -> ${settled}`);
        extracted.supplier_name = settled;
      }
    }
  } catch (e) {
    console.error('[inbound-bills] supplier canonicalisation failed (non-fatal):', e);
  }

  return extracted;
}
