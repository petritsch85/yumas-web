/**
 * Counterparties that pay us, and never invoice us.
 *
 * Pluxee issues meal vouchers. A guest settles with one, the POS books the sale,
 * and Pluxee later transfers the face value less its commission. The document it
 * sends is a remittance advice — five of the seven we had received are named
 * "Gutschrift" outright — but it carries an amount, a date and a reference, so
 * extraction filed each one as a payable. That put 38.494,93 € of debt in the
 * ledger that nobody owed, against which not one euro ever left the account.
 *
 * The money itself is already handled: `cashflow-categorize` groups Pluxee with
 * Bambora, Mollie and Amex as in-house sales settling, which is what it is. Only
 * the document needed stopping, so it is stopped at the point a bill is created.
 *
 * This list is deliberately short. Wolt, Lieferando and Too Good To Go also
 * remit money, but they genuinely invoice commission as well, so a document
 * from them can legitimately be a payable. Only add a name here when every
 * document it sends is a remittance.
 */

/** Matched against the extracted supplier name, case-insensitively. */
const REMITTERS = [
  /\bpluxee\b/i,
  /\bsodexo\b/i,   // what Pluxee was called before the 2024 rebrand
];

/**
 * Yumas is never its own supplier.
 *
 * Wolt settles by self-billing — "Rechnung (Selbstfakturierung)", with Yumas as
 * the seller and Wolt billed — so extraction reads the supplier as Yumas, quite
 * correctly. The document still records a payout: goods sold, less commission,
 * equals the money Wolt transfers. Filed as a bill it became a payable, and
 * seven of them put 5.181,18 € of our own revenue into the cost of goods.
 *
 * Any document naming us as the seller is one we issued or one issued for us,
 * and neither is something we owe.
 */
const OURSELVES = /^\s*yumas\b/i;

/**
 * True when a document comes from a counterparty that only ever pays us, and
 * so must not be filed as a bill however much it looks like one.
 */
export function isRemitter(supplierName: string | null | undefined): boolean {
  const name = (supplierName ?? '').trim();
  if (name === '') return false;
  return OURSELVES.test(name) || REMITTERS.some(re => re.test(name));
}
