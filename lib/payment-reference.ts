/**
 * Reading the invoice numbers a supplier quotes in its payment reference.
 *
 * A supplier collecting a fortnight of deliveries by direct debit writes every
 * invoice number into the Verwendungszweck:
 *
 *   "Rechnungsnummern 149592+149671+149734+149733+149767+... DATUM 17.08.2026"
 *
 * That is a better key than any amount. It says which invoices the payment
 * covers, in the supplier's own words, and it works where amount matching
 * cannot: one debit against sixteen bills has no single amount to match.
 *
 * It also reads the other way. Numbers quoted that we hold no invoice for are
 * invoices that never reached us — the bank becomes a completeness check on
 * the inbox, which is how sixteen missing Fruveg invoices went unnoticed for
 * a month.
 */

/** Words that carry digits but never an invoice number. */
const NOISE = /\b(?:datum|uhr|ref)\b/gi;

/**
 * A number introduced as something other than an invoice.
 *
 * "Kd.1059374738", "KndNr: 16137", "Auftragsbestätigung Nr. 167021" — a
 * customer number, an order confirmation, a contract or a mandate all look
 * exactly like an invoice number once the words around them are dropped, and
 * a ten-digit customer number will happily "contradict" a ten-digit invoice.
 * So the label is stripped together with the number it introduces, rather
 * than the label alone.
 */
const LABELLED_NON_INVOICE =
  /\b(?:kd|knd|kunden?|kundennummer|auftrag|auftrags?best(?:ä|ae)tigung|order|vertrag|mandat|gl(?:ä|ae)ubiger|iban|bic|ust|steuer)\.?(?:\s*-?\s*(?:nr|nummer|id)\.?)?\s*[:#-]?\s*[A-Za-z]{0,3}[-/]?\d{4,12}/gi;

/**
 * Every token in a reference that could be an invoice number.
 *
 * Deliberately loose — a candidate costs nothing, since it is only ever used
 * to look up a bill that must also belong to the same supplier. Dates and
 * times are stripped first so "17.08.2026, 18.32 UHR" contributes nothing.
 */
export function referenceTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const cleaned = (text ?? '')
    // Dates in any common shape, and the time that follows them.
    .replace(/\b\d{1,2}[.\/-]\s?\d{1,2}[.\/-]\s?\d{2,4}\b/g, ' ')
    .replace(/\b\d{1,2}[.:]\d{2}\s*uhr\b/gi, ' ')
    // Labelled non-invoice numbers go before the bare-word noise, so the
    // label is still there to identify them.
    .replace(LABELLED_NON_INVOICE, ' ')
    .replace(NOISE, ' ');
  const out = new Set<string>();
  for (const m of cleaned.matchAll(/[A-Za-z]{0,3}[-\/]?\d{4,12}(?:[-\/]\d{1,4})?/g)) {
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 4 || digits.length > 12) continue;
    out.add(raw.toUpperCase());
    out.add(digits);
  }
  return [...out];
}

/** How an invoice number is compared: case and punctuation do not count. */
export const normaliseRef = (raw: string | null | undefined) =>
  (raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/**
 * The last part of a segmented invoice number.
 *
 * METRO numbers an invoice by the store and the day that produced it —
 * "23.09.2026/529/0/0/0194/030282" — but its direct debit quotes only the
 * running number at the end, "RG030282". Without this the two can never be
 * compared, which is why 115 METRO bills and 108 METRO payments sat side by
 * side barely matching.
 */
export function tailSegment(invoiceNumber: string | null | undefined): string | null {
  const parts = String(invoiceNumber ?? '').split('/').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  return /^\d{4,12}$/.test(last) ? last : null;
}

/**
 * Numbers the reference explicitly calls invoice numbers.
 *
 * `referenceTokens` insists on four digits, because a bare three-digit number
 * turns up by accident in every second Verwendungszweck. But a small number a
 * supplier has *labelled* is not an accident: "Rechnung Nr. 105+106" against
 * two invoices of 1.000 € each is unambiguous, and without this the whole
 * payment goes unmatched. The label is what makes a short number safe to use.
 *
 * Lists are read as lists — "105+106", "103 + 104", "12 und 13".
 */
const LABELLED_INVOICES =
  /(?:rechnung(?:s?\s*-?\s*(?:nummer|nr)n?)?|re\.?\s*-?\s*nr|rg\.?\s*-?\s*nr|rnr|invoice|inv)\.?\s*:?\s*((?:\d{1,12}\s*(?:[+,&/]|und)\s*)*\d{1,12})/gi;

export function labelledInvoiceNumbers(text: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of (text ?? '').matchAll(LABELLED_INVOICES)) {
    for (const part of m[1].split(/[+,&/]|und/i)) {
      const n = part.trim();
      if (n) out.add(n.toUpperCase());
    }
  }
  return [...out];
}

/**
 * A bill whose number *ends* with the quoted one.
 *
 * Werz's bank drops the constant leading digits of its own invoice numbers:
 * it writes "792690+792689+792688…" for invoices 10792690, 10792689, 10792688.
 * Seventeen of those in one reference added up to the payment exactly, and
 * none of them matched, because nothing compared the ends of the numbers.
 *
 * Deliberately narrow. The token must be five digits or more, the bill's
 * number must be genuinely longer — a full match is handled before this — and
 * exactly one bill of the supplier may end that way. A shorter suffix, or two
 * bills sharing one, is a coincidence rather than an abbreviation.
 */
function endsWithMatch<T extends RefBill>(token: string, pool: T[]): T | null {
  if (token.length < 5) return null;
  const hits = pool.filter(b => {
    const n = normaliseRef(b.invoice_number);
    return n.length > token.length && n.endsWith(token);
  });
  return hits.length === 1 ? hits[0] : null;
}

/** One invoice named in a reference that spells out number, date and amount. */
export interface QuotedItem {
  ref: string;
  /** The invoice's own date, ISO. */
  date: string;
  /** What the bank says that invoice came to. */
  amount: number;
}

/* "RG000192/05.01.26/EUR 3.117,93RG000082/05.01.26/EUR 76,51" — entries run
   together with no separator, each carrying three facts. Three agreeing facts
   identify a bill even where the number alone would be ambiguous. */
const QUOTED_ITEM =
  /(?:[A-Z]{0,3})\s*(\d{4,12})\s*\/\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s*\/\s*(?:EUR|€)\s*([\d.]*,\d{2}|\d+)/gi;

export function quotedItems(text: string | null | undefined): QuotedItem[] {
  const out: QuotedItem[] = [];
  for (const m of (text ?? '').matchAll(QUOTED_ITEM)) {
    const year = m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
    const amount = Number(String(m[5]).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(amount)) continue;
    out.push({
      ref: m[1],
      date: `${year}-${m[3].padStart(2, '0')}-${m[2].padStart(2, '0')}`,
      amount,
    });
  }
  return out;
}

export interface RefBill {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  gross_amount: number;
  /** What the supplier collects after Skonto, where the invoice prints it. */
  settlement_amount?: number | null;
  supplier_name: string;
}

/** What a bill will actually appear as in the bank. See lib/skonto.ts. */
const collected = (b: RefBill) =>
  typeof b.settlement_amount === 'number' && b.settlement_amount > 0
    ? b.settlement_amount
    : Number(b.gross_amount);

/** An invoice the reference names that we hold, but another payment already claims. */
export interface TakenBill {
  invoiceNumber: string | null;
  gross: number;
  /** The payment holding it, so the wrong link can be found and undone. */
  heldBy: { date: string; description: string | null } | null;
}

export interface ReferenceMatch {
  bills: RefBill[];
  /** Numbers the reference quotes that no bill in the system carries. */
  missing: string[];
  /**
   * Numbers the reference quotes that we do hold, but that are linked to some
   * other payment. Almost always the other link is the wrong one: the bank
   * naming an invoice is better evidence than an amount that happened to
   * agree. Reporting these apart from `missing` is what stops "ask the
   * supplier to resend" being said about an invoice already in the building.
   */
  taken: TakenBill[];
  /** What the found bills add up to. */
  sum: number;
  /** The transaction's own amount, for the comparison. */
  amount: number;
  /** True when the found bills account for the payment to the cent. */
  complete: boolean;
}

/**
 * Matches a payment to the bills its reference names.
 *
 * Only bills of the same supplier are considered, and only ones nothing else
 * has claimed: a reference number is a strong signal but a short one, and
 * "150465" would otherwise match a stray figure in another supplier's text.
 *
 * A single matched number is accepted only when it accounts for the whole
 * payment. Two or more together are accepted regardless — a supplier quoting
 * several of its own invoice numbers is not a coincidence, and the gap is
 * worth reporting precisely because it is a gap.
 */
export function matchByReference(
  tx: {
    description: string | null;
    counterparty: string | null;
    amount_cents: number;
    /** Which way the money went. A credit note is settled by a refund in. */
    direction?: 'in' | 'out' | null;
  },
  candidateBills: RefBill[],
  /** Bills of the same supplier that another payment already holds. */
  claimedBills: (RefBill & { heldBy?: { date: string; description: string | null } | null })[] = [],
): ReferenceMatch | null {
  const text = `${tx.description ?? ''} ${tx.counterparty ?? ''}`;
  const tokens = referenceTokens(text);
  const items = quotedItems(text);
  /* Read before the guard: a reference may name nothing but short numbers —
     "Rechnung Nr. 105+106" yields no ordinary token at all. */
  const labelled = new Set(labelledInvoiceNumbers(text).map(normaliseRef).filter(Boolean));
  if (tokens.length === 0 && items.length === 0 && labelled.size === 0) return null;

  const byRef = new Map<string, RefBill>();
  const byTail = new Map<string, RefBill[]>();
  /* Numbers too short for the general path — "105", "42". Reachable only
     through a label, never from a bare token. */
  const byShortRef = new Map<string, RefBill[]>();
  for (const b of candidateBills) {
    const key = normaliseRef(b.invoice_number);
    if (key.length >= 4) byRef.set(key, b);
    else if (key.length >= 1) byShortRef.set(key, [...(byShortRef.get(key) ?? []), b]);
    const tail = tailSegment(b.invoice_number);
    if (tail) byTail.set(tail, [...(byTail.get(tail) ?? []), b]);
  }
  type Claimed = (typeof claimedBills)[number];
  const byRefClaimed = new Map<string, Claimed>();
  const byTailClaimed = new Map<string, Claimed[]>();
  for (const b of claimedBills) {
    const key = normaliseRef(b.invoice_number);
    if (key.length >= 4) byRefClaimed.set(key, b);
    const tail = tailSegment(b.invoice_number);
    if (tail) byTailClaimed.set(tail, [...(byTailClaimed.get(tail) ?? []), b]);
  }

  const bills: RefBill[] = [];
  const missing: string[] = [];
  const taken: TakenBill[] = [];
  const add = (b: RefBill) => { if (!bills.includes(b)) bills.push(b); };
  const hold = (b: Claimed) =>
    taken.push({ invoiceNumber: b.invoice_number, gross: Number(b.gross_amount), heldBy: b.heldBy ?? null });

  /* 1. Itemised entries. The bank gives the number, the invoice's own date and
     its own amount, so a bill can be picked out of a store's running sequence
     even though only the tail of its number is printed. Requiring the date and
     the amount to agree as well is what makes a short number safe to use. */
  const claimedItems = new Set<string>();
  for (const it of items) {
    if (claimedItems.has(it.ref)) continue;
    claimedItems.add(it.ref);
    const agrees = <T extends RefBill>(pool: T[]) => pool.filter(b =>
      b.invoice_date === it.date && Math.abs(Number(b.gross_amount) - it.amount) < 0.01);

    const whole = byRef.get(normaliseRef(it.ref));
    if (whole) { add(whole); continue; }
    const tailHits = agrees(byTail.get(it.ref) ?? []);
    if (tailHits.length === 1) { add(tailHits[0]); continue; }

    const heldWhole = byRefClaimed.get(normaliseRef(it.ref));
    const heldTail = agrees(byTailClaimed.get(it.ref) ?? []);
    if (heldWhole) hold(heldWhole);
    else if (heldTail.length === 1) hold(heldTail[0]);
    else missing.push(it.ref);
  }

  /* 2. Numbers the reference calls invoice numbers outright. These may be
     short — "Rechnung Nr. 105+106" — because the label vouches for them. */
  for (const t of labelled) {
    if (claimedItems.has(t)) continue;
    claimedItems.add(t);
    const whole = byRef.get(t);
    if (whole) { add(whole); continue; }
    const short = byShortRef.get(t) ?? [];
    if (short.length === 1) { add(short[0]); continue; }
    const held = byRefClaimed.get(t);
    if (held) hold(held);
    else if (t.length < 4) missing.push(t);   // labelled, so certainly an invoice
  }

  /* 3. Bare numbers, for references that just list them. */
  const wanted = new Set(tokens.map(normaliseRef).filter(t => t.length >= 4));
  const bare: string[] = [];
  for (const t of wanted) {
    if (claimedItems.has(t)) continue;
    const hit = byRef.get(t) ?? endsWithMatch(t, candidateBills);
    if (hit) { add(hit); continue; }
    const held = byRefClaimed.get(t) ?? endsWithMatch(t, claimedBills);
    if (held) hold(held);
    else bare.push(t);
  }
  if (bills.length === 0) return null;

  const amount = Math.abs(tx.amount_cents) / 100;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  /* A supplier taking Skonto debits the discounted figure, so the collected
     total is what the bank will show. The gross total is kept as the second
     candidate: some invoices in a batch may state no discount. */
  const sumCollected = round2(bills.reduce((t, b) => t + collected(b), 0));
  const sumGross = round2(bills.reduce((t, b) => t + Number(b.gross_amount), 0));

  /* A transaction's amount carries no sign, so totals are compared as
     magnitudes and the direction settles which way it should have run: a
     positive total is owed and leaves, a credit note comes back. */
  const runsRight = (total: number) =>
    !tx.direction ? true : total < 0 ? tx.direction === 'in' : tx.direction === 'out';
  const explains = (total: number) => Math.abs(Math.abs(total) - amount) < 0.01 && runsRight(total);

  const complete = explains(sumCollected) || explains(sumGross);
  const sum = explains(sumGross) ? sumGross : sumCollected;

  /* A number quoted with its date and its amount is certainly an invoice, so
     it is reported missing as it stands. A bare number is only reported when
     it is shaped like the ones that did match — otherwise every Kundennummer
     in the text would look like a missing invoice. */
  const shapes = new Set(bills.map(b => {
    const tail = tailSegment(b.invoice_number);
    return (tail ?? normaliseRef(b.invoice_number)).length;
  }));
  const gaps = [...missing, ...bare.filter(m => shapes.has(m.length))];

  /* One number alone is only convincing when it explains the whole payment.
     But where the bank named several and we hold one of them, the shortfall is
     the point: FFD's debit of 30,37 € names a credit note of −60,39 € that we
     have and an invoice of 90,76 € that we do not, and saying so is more use
     than saying nothing. */
  if (bills.length === 1 && !complete && gaps.length === 0 && taken.length === 0) return null;

  return { bills, sum, amount, complete, taken, missing: gaps };
}
