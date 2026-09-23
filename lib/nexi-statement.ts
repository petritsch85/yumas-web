/**
 * Parser for the Nexi monthly settlement (Abrechnung).
 *
 * Nexi collects the card payments of a day and transfers them as one amount,
 * so the bank sees a stream of credits with no invoice behind any of them.
 * The monthly statement is that evidence: it lists every payout with its
 * Zahlungsnummer and date, and closes with the transaction fees Nexi charges,
 * collected separately by direct debit.
 *
 * The rows are read from the text's own coordinates rather than from a text
 * dump: the columns interleave badly when the page is flattened to lines, and
 * a payout paired with the wrong date would be worse than no import at all.
 */

export class NexiParseError extends Error {}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.'));
/** "02.09.2026" → "2026-09-02" */
const isoDate = (s: string) => s.split('.').reverse().join('-');
const AMOUNT = /^-?[\d.]+,\d{2}$/;

/** One daily transfer. */
export interface NexiPayout {
  /** "000098" — unique within the merchant's account. */
  paymentNumber: string;
  date:   string;
  /** What the card transactions of that batch came to. */
  transactionAmount: number;
  /** What Nexi actually transferred. Equal to the above unless something was held back. */
  amount: number;
}

/** A card brand's turnover and the fee charged on it, for the month. */
export interface NexiBrandFee {
  brand:      string;
  turnover:   number;
  units:      number;
  feeNet:     number;
}

export interface NexiStatement {
  invoiceNumber:  string;
  invoiceDate:    string;
  periodStart:    string;
  periodEnd:      string;
  merchantNumber: string;
  /** The account Nexi settles into, as printed. */
  accountIban:    string | null;

  payouts:      NexiPayout[];
  payoutsTotal: number;

  /** Transaction fees for the month, net, VAT and gross. */
  feesNet:   number;
  feesVat:   number;
  feesGross: number;
  brands:    NexiBrandFee[];

  /** The direct debit that collects the fees. */
  debitDate:   string | null;
  debitAmount: number | null;

  warnings: string[];
}

/** A line of the PDF: its items, left to right. */
export interface NexiLine { y: number; items: { x: number; s: string }[] }

/** True when these lines look like a Nexi settlement. */
export const isNexiStatement = (lines: NexiLine[]) =>
  lines.some(l => l.items.some(i => /Nexi Germany/i.test(i.s))) &&
  lines.some(l => l.items.some(i => /Transaktions[üu]bersicht|Abrechnung/i.test(i.s)));

/**
 * Reads the statement from the positioned text of every page, in order.
 *
 * @param lines every line of the document, each already sorted left to right.
 */
export function parseNexiStatement(lines: NexiLine[]): NexiStatement {
  if (!isNexiStatement(lines)) {
    throw new NexiParseError('This is not a Nexi settlement (Abrechnung).');
  }
  const warnings: string[] = [];
  const text = lines.map(l => l.items.map(i => i.s).join(' ')).join('\n');

  const need = (re: RegExp, what: string) => {
    const m = text.match(re);
    if (!m) throw new NexiParseError(`Could not find ${what}.`);
    return m;
  };

  const invoiceNumber = need(/Rechnungsnummer:?\s+(\d+-\d{4}-\d{4}-\S+)/, 'the invoice number')[1];
  const invoiceDate   = isoDate(need(/Rechnungs-Datum:\s*(\d{2}\.\d{2}\.\d{4})/, 'the invoice date')[1]);
  const period        = need(/(\d{2}\.\d{2}\.\d{4}) - (\d{2}\.\d{2}\.\d{4})/, 'the period');
  const merchant      = need(/VP Nr\.:\s*(\d+)/, 'the merchant number')[1];
  const iban          = text.match(/Abrechnungskonto IBAN\s+([A-Z]{2}[\d ]+)/)?.[1].replace(/\s+/g, '') ?? null;

  /*
   * Payout rows: merchant number, payment number, date, then the two amounts.
   * Matching on the shape of the whole line rather than on column positions —
   * the columns shift by a few points from page to page.
   */
  const payouts: NexiPayout[] = [];
  for (const line of lines) {
    const s = line.items.map(i => i.s);
    if (s.length < 5 || s[0] !== merchant) continue;
    if (!/^\d{6}$/.test(s[1]) || !/^\d{2}\.\d{2}\.\d{4}$/.test(s[2])) continue;
    if (!AMOUNT.test(s[3]) || !AMOUNT.test(s[4])) continue;
    payouts.push({
      paymentNumber: s[1],
      date: isoDate(s[2]),
      transactionAmount: num(s[3]),
      amount: num(s[4]),
    });
  }
  if (payouts.length === 0) throw new NexiParseError('No payout rows found in the Transaktionsübersicht.');

  const dupes = payouts.length - new Set(payouts.map(p => p.paymentNumber)).size;
  if (dupes > 0) throw new NexiParseError(`${dupes} payout rows share a Zahlungsnummer — the document was read wrong.`);

  // "Gesamt  158.578,07  158.578,07" — the payout total, for the check.
  const totalLine = lines.find(l => l.items[0]?.s === 'Gesamt' && l.items.length >= 3 && AMOUNT.test(l.items[2].s));
  const payoutsTotal = totalLine ? num(totalLine.items[2].s) : round2(payouts.reduce((t, p) => t + p.amount, 0));
  const summed = round2(payouts.reduce((t, p) => t + p.amount, 0));
  if (Math.abs(summed - payoutsTotal) > 0.011) {
    throw new NexiParseError(
      `The payouts add to ${summed.toFixed(2)} but the statement says ${payoutsTotal.toFixed(2)} — the document was read wrong.`,
    );
  }

  // "Transaktionsentgelte  S (19%)  1.256,24  235,62  1.491,86"
  const feeLine = lines.find(l => /^Transaktionsentgelte$/.test(l.items[0]?.s ?? '') && l.items.length >= 5);
  if (!feeLine) throw new NexiParseError('Could not find the fee line (Transaktionsentgelte).');
  const feeAmounts = feeLine.items.map(i => i.s).filter(s => AMOUNT.test(s));
  if (feeAmounts.length < 3) throw new NexiParseError('The fee line carries no amounts.');
  const [feesNet, feesVat, feesGross] = feeAmounts.slice(-3).map(num);
  if (Math.abs(round2(feesNet + feesVat) - feesGross) > 0.011) {
    warnings.push('The fee VAT does not add up to the fee total.');
  }

  // "1  Mastercard  S (19%)  69.538,21  2151  550,77"
  const brands: NexiBrandFee[] = [];
  for (const line of lines) {
    const s = line.items.map(i => i.s);
    if (!/^\d$/.test(s[0] ?? '') || s.length < 6) continue;
    const amounts = s.filter(x => AMOUNT.test(x));
    const units   = s.find(x => /^\d{2,6}$/.test(x) && !AMOUNT.test(x));
    if (amounts.length < 2 || !units) continue;
    brands.push({ brand: s[1], turnover: num(amounts[0]), units: parseInt(units, 10), feeNet: num(amounts[1]) });
  }

  // "03.09.2026  000040066352/0128/  000128  DE98…  CCDE…  235,62  1.491,86"
  const debitLine = lines.find(l =>
    /^\d{2}\.\d{2}\.\d{4}$/.test(l.items[0]?.s ?? '') && l.items.some(i => /^CCDE/.test(i.s)));
  const debitAmounts = debitLine?.items.map(i => i.s).filter(s => AMOUNT.test(s)) ?? [];

  return {
    invoiceNumber, invoiceDate,
    periodStart: isoDate(period[1]), periodEnd: isoDate(period[2]),
    merchantNumber: merchant, accountIban: iban,
    payouts, payoutsTotal,
    feesNet, feesVat, feesGross, brands,
    debitDate:   debitLine ? isoDate(debitLine.items[0].s) : null,
    debitAmount: debitAmounts.length ? num(debitAmounts[debitAmounts.length - 1]) : null,
    warnings,
  };
}
