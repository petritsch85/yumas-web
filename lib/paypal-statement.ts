/**
 * Reading a PayPal Monatsübersicht.
 *
 * PayPal is a second account beside the bank one, and its statement mixes four
 * unrelated things: delivery customers paying, purchases we make, the Working
 * Capital loan repaying itself out of every sale, and transfers to and from the
 * bank. Only two of those are missing from the books — the loan repayment and
 * the fees — because the purchases and the transfers both show on the bank.
 *
 * The figures are taken from PayPal's own summary blocks, not by adding up the
 * 359 transaction rows. The rows wrap mid-word across lines and a payout once
 * leaked into the loan total that way, putting it out by 537,00 €. The summary
 * is one line per category and proves itself: opening plus every category
 * equals closing, and a parse that cannot show that is refused.
 *
 *   Verfügbares Guthaben (alt)   68,05
 *   Erhaltene Zahlungen       5.105,92
 *   Gesendete Zahlungen      -2.822,40
 *      PayPal Express-Zahlung       -1.320,55   purchases
 *      Allgemeine Zahlung           -1.438,81   the loan
 *      Zahlung mit Zahlungsrechnung    -63,04   subscriptions
 *   Abbuchungen und Belastungen -3.247,44
 *   Einzahlungen und Gutschriften 1.377,64
 *   Gebühren                   -207,45
 *   Verfügbares Guthaben (neu)  274,32
 */

const de = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

/** A labelled figure from the statement, or null when it is not there. */
function figure(flat: string, label: RegExp): number | null {
  const m = flat.match(new RegExp(label.source + String.raw`\s+(-?[\d.]*\d,\d{2})`, 'i'));
  return m ? de(m[1]) : null;
}

export interface PaypalStatement {
  from: string | null;
  to: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  /** Customers paying us. Already counted as revenue; here for completeness. */
  received: number;
  /** Purchases plus the loan. */
  sent: number;
  /** Paid out to the bank account, where it appears as an inflow. */
  withdrawals: number;
  /** Topped up from the bank, where it appears as an outflow. */
  deposits: number;
  /** PayPal's cut, netted off before anything reaches the bank. */
  fees: number;
  /**
   * The Working Capital loan repaying itself.
   *
   * It is taken as a share of each sale — 163 deductions in September — so it
   * never appears as an instalment anywhere and never reaches the bank.
   */
  workingCapital: number;
  /** What we bought: the part of `sent` that is not the loan. */
  purchases: number;
  /** Opening plus every category reaches closing. */
  balanced: boolean | null;
}

export function parsePaypalStatement(text: string): PaypalStatement {
  const flat = String(text ?? '').replace(/\s+/g, ' ');

  const period = flat.match(/Zusammenfassung\s*\((\d{2}\.\d{2}\.\d{2})\s*-\s*(\d{2}\.\d{2}\.\d{2})\)/);
  const iso = (d?: string) => {
    if (!d) return null;
    const [dd, mm, yy] = d.split('.');
    return `20${yy}-${mm}-${dd}`;
  };

  const openingBalance = figure(flat, /Verfügbares Guthaben \(alt\)/);
  const closingBalance = figure(flat, /Verfügbares Guthaben \(neu\)/);
  const received    = figure(flat, /Erhaltene Zahlungen/) ?? 0;
  const sent        = figure(flat, /Gesendete Zahlungen/) ?? 0;
  const withdrawals = figure(flat, /Abbuchungen und Belastungen/) ?? 0;
  const deposits    = figure(flat, /Einzahlungen und Gutschriften/) ?? 0;
  const fees        = figure(flat, /Gebühren/) ?? 0;

  /* Within "Gesendete Zahlungen", the loan is the Allgemeine Zahlung line.
     Every repayment goes to de-ppwc-repayment@paypal.com under that type, and
     nothing else does — a withdrawal is an "Allgemeine Abbuchung". */
  const workingCapital = figure(flat, /Allgemeine Zahlung/) ?? 0;

  const movement = received + sent + withdrawals + deposits + fees;
  const balanced = openingBalance !== null && closingBalance !== null
    ? Math.abs(Math.round((openingBalance + movement) * 100) / 100 - closingBalance) < 0.005
    : null;

  return {
    from: iso(period?.[1]), to: iso(period?.[2]),
    openingBalance, closingBalance,
    received, sent, withdrawals, deposits, fees,
    workingCapital,
    purchases: Math.round((sent - workingCapital) * 100) / 100,
    balanced,
  };
}
