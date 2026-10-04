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
 * @returns {{ entries: {date: string, kind: string, text: string, amount: number, page: number}[],
 *             from: string|null, to: string|null, number: string|null,
 *             openingBalance: number|null, closingBalance: number|null,
 *             net: number, balanced: boolean|null }}
 */
export function parseKontoauszug(text) {
  /**
   * The page a booking sits on, kept as the lines are filtered.
   *
   * The statement is printed and the invoices are filed behind the page that
   * shows their payment, so which page a booking is on is the whole point for
   * whoever assembles the folder. "Seite 3 von 12" is dropped as furniture a
   * line later, so it has to be read on the way past.
   */
  const raw = String(text ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const lines = [];
  let pageNo = 1;
  for (const l of raw) {
    const p = l.match(/^Seite (\d+) von \d+/);
    if (p) { pageNo = Number(p[1]); continue; }
    if (FURNITURE.test(l)) continue;
    lines.push({ text: l, page: pageNo });
  }

  const entries = [];
  let cur = null;
  for (const { text: l, page } of lines) {
    const m = l.match(/^(\d{2})\.(\d{2})\.(\d{4})\s*(.*)$/);
    if (m && KIND.test(m[4] ?? '')) {
      if (cur) entries.push(cur);
      cur = { date: `${m[3]}-${m[2]}-${m[1]}`, kind: (m[4] ?? '').split(/\s+/)[0], text: [], amount: null, page };
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
  /* "Kontostand am 31.08.2026, Auszug Nr. 35 15.382,00" and
     "Kontostand am 30.09.2026 um 20:04 Uhr 838,01" — whatever sits between the
     date and the figure, the figure is the last money token before the line
     ends. */
  const balances = [...flat.matchAll(/Kontostand am (\d{2})\.(\d{2})\.(\d{4})(.{0,60}?)(-?[\d.]*\d,\d{2})/g)]
    .map(m => ({ date: `${m[3]}-${m[2]}-${m[1]}`, value: deDe(m[5]) }));
  const number = (flat.match(/Kontoauszug\s+(\d+\/\d{4})/) ?? [])[1] ?? null;

  const openingBalance = balances[0]?.value ?? null;
  const closingBalance = balances.length > 1 ? balances[balances.length - 1].value : null;
  const net = Math.round(booked.reduce((s, e) => s + e.amount, 0) * 100) / 100;

  /* The statement checks itself: its own opening and closing balances must be
     exactly the bookings apart. If they are not, the parse dropped or invented
     something and nothing downstream should trust it. */
  const balanced = openingBalance !== null && closingBalance !== null
    ? Math.abs(Math.round((openingBalance + net) * 100) / 100 - closingBalance) < 0.005
    : null;

  return {
    entries: booked,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    number,
    openingBalance,
    closingBalance,
    net,
    balanced,
  };
}
