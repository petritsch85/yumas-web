/**
 * What a month owes the Steuerberater, and how to assemble it.
 *
 * Until the DATEV link arrives in 2027 the handover is a printed folder, put
 * together by hand each month and therefore incomplete in a different way each
 * month. This declares the contents once: every item, where it comes from, and
 * whether a month is allowed to be without it.
 *
 * Two kinds of item. Some are already records in the system — the bills, the
 * invoices we write, the delivery notes — and are collected automatically.
 * The rest arrive only as a PDF and are uploaded against the month; those live
 * in `month_documents`.
 *
 * Adding to the list is a line here. Nothing else needs to know.
 */

export type ItemSource = 'collected' | 'uploaded';


export interface ManifestItem {
  /** Stable key — also the `kind` stored in month_documents. */
  key: string;
  /** The folder it lands in, numbered so the printout follows this order. */
  folder: string;
  label: string;
  source: ItemSource;
  /** What it is, in one line, for the checklist the folder carries. */
  note: string;
  /** A month without it is incomplete; shown as a warning, never blocks. */
  required: boolean;
}

export const MANIFEST: ManifestItem[] = [
  { key: 'kontoauszug', folder: '01_Kontoauszug', label: 'Kontoauszug (Sparkasse)',
    source: 'uploaded', required: true,
    note: 'Der offizielle Monatsauszug — die Grundlage, gegen die alles andere abgeglichen wird.' },

  { key: 'eingangsrechnungen', folder: '02_Eingangsrechnungen', label: 'Eingangsrechnungen',
    source: 'collected', required: true,
    note: 'Lieferantenrechnungen auf Abgrenzungsbasis: Rechnungsdatum im Monat, auch unbezahlt, '
        + 'zuzüglich älterer Rechnungen, die in diesem Monat bezahlt wurden. '
        + 'Dateiname = Seite und Position im Kontoauszug.' },

  { key: 'ausgangsrechnungen', folder: '03_Ausgangsrechnungen', label: 'Ausgangsrechnungen',
    source: 'collected', required: true,
    note: 'Eigene Rechnungen auf Abgrenzungsbasis: Rechnungsdatum im Monat, auch ohne '
        + 'Zahlungseingang, zuzüglich älterer Rechnungen, die in diesem Monat bezahlt wurden. '
        + 'Dateiname = Seite und Position im Kontoauszug.' },

  { key: 'nexi', folder: '04_Nexi', label: 'Nexi Monatsabrechnung',
    source: 'uploaded', required: true,
    note: 'Kartenumsätze im Haus, monatliche Abrechnung.' },

  { key: 'amex', folder: '05_Amex', label: 'Amex Monatsabrechnung',
    source: 'uploaded', required: true,
    note: 'American Express, monatliche Abrechnung.' },

  { key: 'paypal', folder: '06_PayPal', label: 'PayPal Monatsübersicht',
    source: 'uploaded', required: true,
    note: 'PayPal, monatliche Übersicht.' },

  { key: 'toogoodtogo', folder: '07_TooGoodToGo', label: 'Too Good To Go Abrechnung',
    source: 'uploaded', required: true,
    note: 'Too Good To Go, monatliche Abrechnung.' },

  { key: 'webshop', folder: '08_Webshop', label: 'Webshop Monatsbericht',
    source: 'uploaded', required: true,
    note: 'Monatsbericht des Webshops.' },

  { key: 'wolt', folder: '09_Wolt', label: 'Wolt Abrechnungen',
    source: 'uploaded', required: true,
    note: 'Wolt Selbstfakturierungen des Monats — Lieferbelege.' },

  { key: 'lieferando', folder: '10_Lieferando', label: 'Lieferando Abrechnungen',
    source: 'uploaded', required: true,
    note: 'Lieferando Abrechnungen des Monats — Lieferbelege.' },
];

export const itemFor = (key: string) => MANIFEST.find(i => i.key === key) ?? null;

/**
 * A record that was never going to have a document behind it.
 *
 * The landlords bill once in the lease and never again, so the monthly rent
 * entries are Ersatzbelege written from the payment. Counting them as "missing
 * a PDF" leaves five permanent warnings on every month that no one can clear,
 * and a warning nobody can act on is one everybody learns to ignore. The lease
 * itself is the document, and the Steuerberater already holds it.
 */
export const isSubstituteRecord = (notes: string | null | undefined) =>
  /ersatzbeleg/i.test(notes ?? '');

/** 2026-09 -> "September 2026", for headings and filenames. */
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${y}`;
};

/** The first and last day of a 2026-09 style month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/**
 * A filename that means something on paper.
 *
 * A folder of `4f2a….pdf` is useless the moment anything has to be checked by
 * hand, which is the whole point of a printed folder. Date first so the folder
 * sorts chronologically when it is opened on screen.
 */
export function documentName(parts: {
  date?: string | null; party?: string | null; number?: string | null; fallback: string;
}): string {
  const safe = (s: string) => s.replace(/[^\p{L}\p{N}._ -]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 48);
  const bits = [
    parts.date ? String(parts.date).slice(0, 10) : null,
    parts.party ? safe(String(parts.party)) : null,
    parts.number ? safe(String(parts.number)) : null,
  ].filter(Boolean);
  return (bits.length ? bits.join('_') : safe(parts.fallback)) || 'Beleg';
}

export interface ItemStatus {
  item: ManifestItem;
  /** How many documents were found. */
  count: number;
  /** Records that exist but carry no file — the gap worth chasing. */
  missingFiles: number;
  detail?: string;
}

/** Whether the month can be handed over, and what is still open. */
export function manifestSummary(statuses: ItemStatus[]) {
  const missing = statuses.filter(s => s.item.required && s.count === 0);
  const partial = statuses.filter(s => s.missingFiles > 0);
  return {
    ready: missing.length === 0,
    missing,
    partial,
    documents: statuses.reduce((t, s) => t + s.count, 0),
  };
}
