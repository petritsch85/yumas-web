/**
 * The DATEV Buchungsstapel — a posting batch as an EXTF CSV.
 *
 * This is the file a Steuerberater imports into Kanzlei-Rechnungswesen in one
 * step. It is two lines of header followed by one line per posting, and DATEV
 * is unforgiving about all three: the header describes the client and the
 * period, the second line names every column, and a posting that disagrees
 * with either is rejected without saying which.
 *
 * Conventions taken here, and why:
 *
 *  - **Automatikkonten rather than BU-Schlüssel.** 8400 in SKR03 is the 19%
 *    revenue account and carries that rate itself; so does 8300 for 7%, and
 *    3300/3400 on the purchase side. Using them means the tax rate is decided
 *    by the account a person chose, not by a key this code guessed. A BU key
 *    is written only where the mapping explicitly sets one.
 *  - **Gross amounts.** A Buchungsstapel posts gross and lets the account
 *    derive the tax. Posting net would silently drop the VAT.
 *  - **Soll/Haben from the posting's direction**, never from a negative
 *    amount: DATEV takes the amount unsigned and the S/H flag decides.
 *
 * Nothing here talks to DATEV. The file is downloaded and handed over.
 */

export type Skr = 'SKR03' | 'SKR04';

/** The accounts that do not depend on who the supplier is. */
export interface DatevSettings {
  consultantNumber: string;
  clientNumber:     string;
  chart:            Skr;
  accountLength:    number;
  fiscalYearStart:  string;
  accountBank:      string;
  accountCash:      string;
  accountRevenue7:  string;
  accountRevenue19: string;
  accountGoods7:    string;
  accountGoods19:   string;
  accountSuspense:  string;
  exportLabel:      string;
}

/** What each chart calls the accounts everyone needs. Confirm with the Steuerberater. */
export const CHART_DEFAULTS: Record<Skr, Omit<DatevSettings, 'consultantNumber' | 'clientNumber' | 'chart' | 'accountLength' | 'fiscalYearStart' | 'exportLabel'>> = {
  SKR03: {
    accountBank: '1200', accountCash: '1000',
    accountRevenue7: '8300', accountRevenue19: '8400',
    accountGoods7: '3300', accountGoods19: '3400',
    accountSuspense: '1590',
  },
  SKR04: {
    accountBank: '1800', accountCash: '1600',
    accountRevenue7: '4300', accountRevenue19: '4400',
    accountGoods7: '5300', accountGoods19: '5400',
    accountSuspense: '1370',
  },
};

/** One posting, in the terms DATEV uses. */
export interface DatevBooking {
  /** Gross, always positive. The S/H flag carries the direction. */
  amount: number;
  /** 'S' debits the Konto, 'H' credits it. */
  debitCredit: 'S' | 'H';
  /** The account being posted. */
  account: string;
  /** The other side. */
  contraAccount: string;
  /** Only where the account is not an Automatikkonto. */
  buKey?: string | null;
  /** ISO. Written as DDMM — DATEV takes the year from the header. */
  date: string;
  /** Belegfeld 1 — the invoice number, what open items are matched on. */
  reference?: string | null;
  /** Belegfeld 2 — a second reference, where there is one. */
  reference2?: string | null;
  /** Buchungstext, 60 characters. */
  text: string;
  /** Kostenstelle. */
  costCentre?: string | null;
  /** What this posting came from, for the preview. Not exported. */
  source?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** DATEV writes an amount with a decimal comma and no thousands separator. */
const amount = (n: number) => round2(Math.abs(n)).toFixed(2).replace('.', ',');

/** "2026-08-29" → "2908". The year comes from the header's date range. */
const ddmm = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;

/** DATEV's own quoting: double quotes, doubled inside. */
const q = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;

/** A Buchungstext is 60 characters and carries no semicolons or quotes. */
export const bookingText = (raw: string) =>
  (raw ?? '').replace(/[";\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

/** Belegfeld 1 is 36 characters and a restricted set. */
export const bookingRef = (raw: string) =>
  (raw ?? '').replace(/[^A-Za-z0-9$%&*+\-/ ]/g, '-').trim().slice(0, 36);

/**
 * The 125 columns of a Buchungsstapel, version 13.
 *
 * Every one has to be present even when empty, which is why they are listed
 * rather than generated: a batch one column short imports as nonsense.
 */
const COLUMNS = [
  'Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs',
  'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto', 'Gegenkonto (ohne BU-Schlüssel)',
  'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext',
  'Postensperre', 'Diverse Adressnummer', 'Geschäftspartnerbank', 'Sachverhalt',
  'Zinssperre', 'Beleglink',
  'Beleginfo - Art 1', 'Beleginfo - Inhalt 1', 'Beleginfo - Art 2', 'Beleginfo - Inhalt 2',
  'Beleginfo - Art 3', 'Beleginfo - Inhalt 3', 'Beleginfo - Art 4', 'Beleginfo - Inhalt 4',
  'Beleginfo - Art 5', 'Beleginfo - Inhalt 5', 'Beleginfo - Art 6', 'Beleginfo - Inhalt 6',
  'Beleginfo - Art 7', 'Beleginfo - Inhalt 7', 'Beleginfo - Art 8', 'Beleginfo - Inhalt 8',
  'KOST1 - Kostenstelle', 'KOST2 - Kostenstelle', 'KOST-Menge',
  'EU-Land u. UStID', 'EU-Steuersatz', 'Abw. Versteuerungsart',
  'Sachverhalt L+L', 'Funktionsergänzung L+L', 'BU 49 Hauptfunktionstyp',
  'BU 49 Hauptfunktionsnummer', 'BU 49 Funktionsergänzung',
  'Zusatzinformation - Art 1', 'Zusatzinformation- Inhalt 1',
  'Zusatzinformation - Art 2', 'Zusatzinformation- Inhalt 2',
  'Zusatzinformation - Art 3', 'Zusatzinformation- Inhalt 3',
  'Zusatzinformation - Art 4', 'Zusatzinformation- Inhalt 4',
  'Zusatzinformation - Art 5', 'Zusatzinformation- Inhalt 5',
  'Zusatzinformation - Art 6', 'Zusatzinformation- Inhalt 6',
  'Zusatzinformation - Art 7', 'Zusatzinformation- Inhalt 7',
  'Zusatzinformation - Art 8', 'Zusatzinformation- Inhalt 8',
  'Zusatzinformation - Art 9', 'Zusatzinformation- Inhalt 9',
  'Zusatzinformation - Art 10', 'Zusatzinformation- Inhalt 10',
  'Zusatzinformation - Art 11', 'Zusatzinformation- Inhalt 11',
  'Zusatzinformation - Art 12', 'Zusatzinformation- Inhalt 12',
  'Zusatzinformation - Art 13', 'Zusatzinformation- Inhalt 13',
  'Zusatzinformation - Art 14', 'Zusatzinformation- Inhalt 14',
  'Zusatzinformation - Art 15', 'Zusatzinformation- Inhalt 15',
  'Zusatzinformation - Art 16', 'Zusatzinformation- Inhalt 16',
  'Zusatzinformation - Art 17', 'Zusatzinformation- Inhalt 17',
  'Zusatzinformation - Art 18', 'Zusatzinformation- Inhalt 18',
  'Zusatzinformation - Art 19', 'Zusatzinformation- Inhalt 19',
  'Zusatzinformation - Art 20', 'Zusatzinformation- Inhalt 20',
  'Stück', 'Gewicht', 'Zahlweise', 'Forderungsart', 'Veranlagungsjahr',
  'Zugeordnete Fälligkeit', 'Skontotyp', 'Auftragsnummer', 'Buchungstyp',
  'USt-Schlüssel (Anzahlungen)', 'EU-Land (Anzahlungen)',
  'Sachverhalt L+L (Anzahlungen)', 'EU-Steuersatz (Anzahlungen)',
  'Erlöskonto (Anzahlungen)', 'Herkunft-Kz', 'Buchungs GUID',
  'KOST-Datum', 'SEPA-Mandatsreferenz', 'Skontosperre', 'Gesellschaftername',
  'Beteiligtennummer', 'Identifikationsnummer', 'Zeichnernummer',
  'Postensperre bis', 'Bezeichnung SoBil-Sachverhalt', 'Kennzeichen SoBil-Buchung',
  'Festschreibung', 'Leistungsdatum', 'Datum Zuord. Steuerperiode',
  'Fälligkeit', 'Generalumkehr (GU)', 'Steuersatz', 'Land',
  'Abrechnungsreferenz', 'BVV-Position', 'EU-Land u. UStID (Ursprung)', 'EU-Steuersatz (Ursprung)',
];

/** Index of a column by name, so a row is built by name and not by counting. */
const COL = new Map(COLUMNS.map((c, i) => [c, i]));

export interface BatchOptions {
  settings: DatevSettings;
  from: string;
  to: string;
  bookings: DatevBooking[];
  /** A name the Steuerberater will see in the batch list. */
  label?: string;
  /**
   * Festschreibung. Left off: a batch that arrives already locked cannot be
   * corrected by the Steuerberater, and the first ones will need correcting.
   */
  locked?: boolean;
}

/**
 * Builds the file.
 *
 * Returns Windows-1252-safe text: DATEV reads the batch as ANSI, so umlauts
 * are written as they are and the caller encodes. A BOM would be read as data.
 */
export function buildBuchungsstapel(opts: BatchOptions): string {
  const { settings: s, from, to, bookings } = opts;
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T.]/g, '').slice(0, 17).padEnd(17, '0');
  const ymd = (iso: string) => iso.replace(/-/g, '');

  const header = [
    q('EXTF'), '700', '21', q('Buchungsstapel'), '13',
    stamp, '', q('RE'), q(s.exportLabel.slice(0, 25)), '',
    s.consultantNumber, s.clientNumber, ymd(s.fiscalYearStart),
    String(s.accountLength), ymd(from), ymd(to),
    q((opts.label ?? `Yumas ${from.slice(0, 7)}`).slice(0, 30)),
    q(''), '1', '0', opts.locked ? '1' : '0', q('EUR'),
    '', '', '', '', q(''), '', '', '',
  ].join(';');

  const rows = bookings.map(b => {
    const row = new Array(COLUMNS.length).fill('');
    const put = (name: string, value: string) => { row[COL.get(name)!] = value; };
    put('Umsatz (ohne Soll/Haben-Kz)', amount(b.amount));
    put('Soll/Haben-Kennzeichen', q(b.debitCredit));
    put('WKZ Umsatz', q('EUR'));
    put('Konto', b.account);
    put('Gegenkonto (ohne BU-Schlüssel)', b.contraAccount);
    if (b.buKey) put('BU-Schlüssel', q(b.buKey));
    put('Belegdatum', ddmm(b.date));
    if (b.reference)  put('Belegfeld 1', q(bookingRef(b.reference)));
    if (b.reference2) put('Belegfeld 2', q(bookingRef(b.reference2)));
    put('Buchungstext', q(bookingText(b.text)));
    if (b.costCentre) put('KOST1 - Kostenstelle', q(b.costCentre));
    // The day the supply happened, which is what the tax period follows.
    put('Leistungsdatum', ymd(b.date));
    return row.join(';');
  });

  return [header, COLUMNS.map(q).join(';'), ...rows].join('\r\n') + '\r\n';
}

/** DATEV expects ANSI, and a UTF-8 byte would arrive as two wrong characters. */
export function toWindows1252(text: string): Uint8Array {
  const map: Record<string, number> = {
    '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
    'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
    '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
    '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
  };
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i] = c <= 0xff ? c : (map[text[i]] ?? 0x3f); // '?' for anything else
  }
  return out;
}

export const buchungsstapelFilename = (from: string, to: string) =>
  `EXTF_Buchungsstapel_${from.replace(/-/g, '')}_${to.replace(/-/g, '')}.csv`;
