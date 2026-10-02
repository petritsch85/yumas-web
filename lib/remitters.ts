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
 * True when a document comes from a counterparty that only ever pays us, and
 * so must not be filed as a bill however much it looks like one.
 */
export function isRemitter(supplierName: string | null | undefined): boolean {
  const name = (supplierName ?? '').trim();
  return name !== '' && REMITTERS.some(re => re.test(name));
}
