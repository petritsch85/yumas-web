/**
 * Who was really paid, when the bank only names the middleman.
 *
 * A PayPal purchase reaches the statement as a debit to "PayPal Europe
 * S.a.r.l. et Cie S.C.A", every time, whoever the money was actually for. The
 * matching rules compare the bank's counterparty against the bill's supplier,
 * so against thirteen different merchants they all compared PayPal against
 * Labelident, Canva, Böttcher — and not one PayPal purchase could ever match.
 *
 * The merchant is in the narrative, in a shape PayPal has never varied:
 *
 *   1052735420909/PP.1178.PP/. Labelident GmbH, Ihr Einkauf bei Labelident GmbH
 *   1053075995406/. Bottcher AG, Ihr Einkauf bei Bottcher AG
 *
 * So the name is read from there instead. Deliberately narrow: it fires only
 * when the counterparty is the intermediary itself and the narrative carries
 * the phrase. Widening the supplier comparison to the whole narrative would
 * have matched on any word that happened to appear in it, which is how wrong
 * links get made.
 */

/**
 * A spelling of a name that an umlaut cannot change.
 *
 * The bank writes "Bottcher AG"; the invoice is headed "Böttcher AG"; a third
 * system would write "Boettcher". Comparing any two of those as written finds
 * nothing, which is why a 312,66 € purchase sat in the gap list while its
 * invoice sat in the bills table, a day apart and to the cent.
 *
 * Both of the usual ways of losing an umlaut are collapsed: the diaeresis is
 * dropped, and the "oe" that German transliteration puts in its place is
 * folded back to "o". So all three spellings meet at "bottcher". It also folds
 * "Goethe" to "gothe", which is wrong as German and harmless here — this is a
 * comparison key, never anything anybody reads.
 */
export const foldName = (s: string | null | undefined): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u').replace(/ß|ss/g, 's')
    .replace(/[^a-z0-9]/g, '');

/** The payment services that appear on the statement in place of the payee. */
const INTERMEDIARY = /\bpaypal\b/i;

/* "Ihr Einkauf bei X" — X runs to the end, since a merchant name may hold
   commas of its own ("BAUHAUS E-Business … mbH & Co. KG"). */
const PURCHASE_AT = /ihr\s+einkauf\s+bei\s+(.+)$/i;

/**
 * The merchant behind an intermediary's debit, or null when there is none.
 *
 * Null means "nothing to add" — the caller then uses the counterparty as
 * before, so a payment this does not recognise behaves exactly as it did.
 */
export function merchantBehind(tx: {
  counterparty?: string | null;
  description?: string | null;
}): string | null {
  if (!INTERMEDIARY.test(tx.counterparty ?? '')) return null;
  const hit = PURCHASE_AT.exec(String(tx.description ?? '').trim());
  if (!hit) return null;
  const name = hit[1].trim();
  /* PayPal masks some merchants as "..........." — a name made only of
     punctuation identifies nobody and would match on nothing anyway. */
  if (!/[a-zà-ÿ0-9]/i.test(name)) return null;
  return name;
}

/**
 * The name to compare a bill's supplier against.
 *
 * The merchant where the bank named a middleman, the counterparty otherwise.
 */
export const partyPaid = (tx: { counterparty?: string | null; description?: string | null }): string =>
  merchantBehind(tx) ?? (tx.counterparty ?? '');

/* PayPal opens every narrative with its own transaction id:
     1053075995406/. Bottcher AG, …
     1052735420909/PP.1178.PP/. Labelident GmbH, …
   Thirteen digits, sometimes with the merchant account between slashes. */
const OWN_REFERENCE = /^\s*\d{10,}\s*\/(?:PP\.[\d.]+\.PP\/)?\.?\s*/i;

/**
 * The narrative with the intermediary's own reference taken out.
 *
 * The veto on matching reads any number the bank prints as a possible invoice
 * number, and refuses the match when it is not the bill's. That is right for a
 * supplier's own transfer and wrong here: PayPal's transaction id is not an
 * invoice and never was. Böttcher's happened to be twelve digits, the same
 * length as the invoice it was paying, so the rule declared the bank had named
 * a different invoice and forbade a match that agreed to the cent one day
 * apart.
 *
 * Only the leading reference is removed, and only from an intermediary's
 * narrative. Anything a merchant writes after it — a genuine invoice number
 * among it — still counts, because that veto is worth keeping.
 */
export function narrativeWithoutOwnRef(tx: {
  counterparty?: string | null;
  description?: string | null;
}): string {
  const d = String(tx.description ?? '');
  if (!INTERMEDIARY.test(tx.counterparty ?? '')) return d;
  return d.replace(OWN_REFERENCE, '');
}
