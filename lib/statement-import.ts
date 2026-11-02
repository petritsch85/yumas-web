/**
 * Turning a Kontoauszug booking into a ledger row, as the CSV import would.
 *
 * The PDF runs the payee and the purpose together on one line — "Wohnraum
 * Entwicklungs GmbH Miete Yumas GmbH DATUM 01.09.2026" — where the CSV has them
 * in two columns. Bill matching reads the payee, so it has to be split off.
 *
 * Most payees recur, so the split is taken from the names the ledger already
 * knows: the longest known name the booking text starts with, compared without
 * case, spaces or umlauts (the PDF breaks words at line ends, "PIZA RRO", and
 * spells "GEMÜSE" where the CSV wrote "GEMUESE"). A payee never seen before is
 * cut at the first word that starts a purpose — an invoice number, "Rechnung",
 * "DATUM" and the like.
 */

const foldChar = (c: string) => {
  const l = c.toLowerCase();
  if (l === 'ä') return 'ae';
  if (l === 'ö') return 'oe';
  if (l === 'ü') return 'ue';
  if (l === 'ß') return 'ss';
  return /[a-z0-9]/.test(l) ? l : '';
};
export const foldName = (s: string) => [...s].map(foldChar).join('');

/** Where, in the original text, the first `n` folded characters end. */
function cutAfter(text: string, n: number): number {
  let got = 0;
  for (let i = 0; i < text.length; i++) {
    got += foldChar(text[i]).length;
    if (got >= n) return i + 1;
  }
  return text.length;
}

const PURPOSE_START = /^(\d|RG\b|ReNr|Rg\.|RE-|RNR\b|Rechnung|Miete|Lohn|Abschlag|DATUM\b|INIT:|Kd\.|Kunden|SEPA|Gläubiger|MANDATS|Vertrag|EREF|Ihr\b|Rate\b|LS:|Beitrag|Zins|Darl|Erstattung|Gutschrift|Auszahlung|Doppel|Kartenzahlung|Abrechnung)/i;

export function splitPayee(text: string, known: string[]): { counterparty: string; description: string } {
  const t = text.trim();
  const ft = foldName(t);
  let best = '';
  for (const k of known) {
    const fk = foldName(k);
    if (fk.length >= 4 && fk.length > foldName(best).length && ft.startsWith(fk)) best = k;
  }
  if (best) {
    const at = cutAfter(t, foldName(best).length);
    return { counterparty: best, description: t.slice(at).trim() };
  }
  const words = t.split(/\s+/);
  const i = words.findIndex((w, j) => j > 0 && PURPOSE_START.test(w));
  if (i > 0) return { counterparty: words.slice(0, i).join(' '), description: words.slice(i).join(' ') };
  return { counterparty: t.slice(0, 120), description: t };
}
