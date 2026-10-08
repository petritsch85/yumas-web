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
