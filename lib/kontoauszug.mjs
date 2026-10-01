/**
 * Reading a Sparkasse Kontoauszug.
 *
 * The statement is the record: the CSV exports are a convenience and they lie
 * in one specific way, by carrying payments the bank has only earmarked. Those
 * turn up again in a later export under their real booking date, and the
 * ledger then holds the same money twice. Only the statement settles which
 * bookings actually happened, and on what day.
 *
 * The layout is a booking date, a kind, some wording, then the amount on its
 * own line — interrupted every page by a block of letterhead that has to be
 * dropped first, or the entries straddling a page break lose their amounts.
 */

/** Repeats on every page and interrupts entries at the breaks. */
const FURNITURE = /^(Sparkasse Rhein-Nahe|Mannheimer Stra|Anstalt des öffentlichen|mit Sitz in Bad|Sparkassen-Finanzgruppe|Vorstand:|Jörg Brendel|HR Nr\.|USt-IdNr\.|Telefon \d|www\.sparkasse|info@sk-rhein|SWIFT|BLZ:|Seite \d+ von|Kontoauszug \d+|BusinessGiroPro|Datum Erläuterung|S Sparkasse|Firma$|Yumas GmbH$|Feuerbachstr|60325 Frankfurt|Ihr Ansprechpartner|Oliver Dries|Vertriebsbereich|55543 Bad Kreuznach|oliver\.dries|Bitte prüfen|Einwendungen|Rechnungsabschluss|Guthaben sind|dem Informationsbogen|Dieser Brief|^l )/;

/** The words a booking line opens with, after its date. */
const KIND = /^(Lastschrift|Überweisung|Echtzeit|Zahlungseingang|Dauerauftrag|Kartenzahlung|Entgelt|Gutschrift|Storno|Rücklastschrift|Scheck|Bargeld|Abschluss|Abrechnung|SEPA|Rechnung|Auszahlung|Einzahlung|Zinsen|Gebühr|Kartenverfügung|Kontoführung)/i;

const deDe = s => Number(String(s).replace(/\./g, '').replace(',', '.'));

/**
 * @param {string} text  the statement's extracted text
 * @returns {{ entries: {date: string, kind: string, text: string, amount: number}[],
 *             from: string|null, to: string|null, number: string|null,
 *             openingBalance: number|null, closingBalance: number|null }}
 */
export function parseKontoauszug(text) {
  const lines = String(text ?? '').split('\n').map(l => l.trim()).filter(l => l && !FURNITURE.test(l));

  const entries = [];
  let cur = null;
  for (const l of lines) {
    const m = l.match(/^(\d{2})\.(\d{2})\.(\d{4})\s*(.*)$/);
    if (m && KIND.test(m[4] ?? '')) {
      if (cur) entries.push(cur);
      cur = { date: `${m[3]}-${m[2]}-${m[1]}`, kind: (m[4] ?? '').split(/\s+/)[0], text: [], amount: null };
      continue;
    }
    if (!cur) continue;
    const a = l.match(/^(-?[\d.]*\d,\d{2})$/);
    /* Only the first bare amount: a later one belongs to the next booking that
       the page break split away from its own date line. */
    if (a && cur.amount === null) { cur.amount = deDe(a[1]); continue; }
    cur.text.push(l);
  }
  if (cur) entries.push(cur);

  const booked = entries.filter(e => e.amount !== null)
    .map(e => ({ ...e, text: e.text.join(' ').replace(/\s+/g, ' ').trim() }));
  const dates = booked.map(e => e.date).sort();

  const flat = String(text ?? '').replace(/\s+/g, ' ');
  const balances = [...flat.matchAll(/Kontostand am (\d{2})\.(\d{2})\.(\d{4})[^-\d]*(-?[\d.]*\d,\d{2})/g)]
    .map(m => ({ date: `${m[3]}-${m[2]}-${m[1]}`, value: deDe(m[4]) }));
  const number = (flat.match(/Kontoauszug\s+(\d+\/\d{4})/) ?? [])[1] ?? null;

  return {
    entries: booked,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    number,
    openingBalance: balances[0]?.value ?? null,
    closingBalance: balances.length > 1 ? balances[balances.length - 1].value : null,
  };
}
