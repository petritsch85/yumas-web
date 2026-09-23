/**
 * A counterparty decides its transactions' category.
 *
 * The keyword rules in cashflow-categorize.ts read the bank's own wording and
 * are only ever a guess — Nexi's daily transfers arrive with nothing to say
 * they are in-house card takings. A counterparty, once defined, knows: it
 * carries the category a person chose for it, and every transaction that
 * matches it inherits that, unless a person set the row's category by hand.
 */

export interface CategorySource {
  id: string;
  name: string;
  category: string | null;
  keywords: string[] | null;
}

/** The counterparty a bank line belongs to, by pinned id or by keyword. */
export function counterpartyFor(
  tx: { counterparty: string | null; counterparty_id?: string | null },
  counterparties: CategorySource[],
): CategorySource | null {
  if (tx.counterparty_id) {
    const pinned = counterparties.find(c => c.id === tx.counterparty_id);
    if (pinned) return pinned;
  }
  const raw = (tx.counterparty ?? '').toLowerCase();
  if (!raw) return null;
  for (const cp of counterparties) {
    const terms = cp.keywords?.length ? cp.keywords : [cp.name];
    if (terms.some(kw => kw && raw.includes(kw.toLowerCase()))) return cp;
  }
  return null;
}

/**
 * The category a row should carry, or null to leave it alone.
 *
 * A row whose category a person set by hand is never moved: one Nexi line a
 * month is the fee for the service, not takings, and that correction has to
 * survive the next upload.
 */
export function categoryFor(
  tx: { counterparty: string | null; counterparty_id?: string | null; category?: string | null; category_manual?: boolean | null },
  counterparties: CategorySource[],
): string | null {
  if (tx.category_manual) return null;
  const cp = counterpartyFor(tx, counterparties);
  if (!cp?.category || cp.category === tx.category) return null;
  return cp.category;
}
