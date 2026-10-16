/**
 * Reading the monthly FiBu-Journal from Sage HR.
 *
 * The journal lists every payroll posting — Gehalt, the employer's share of
 * the four social insurances, the Umlagen, the Sachbezüge — and closes on page
 * 2 with the reconciliation of the wage clearing account:
 *
 *   Abstimmung Lohnverrechnungskonto: 3790
 *   Soll: 106.672,74
 *   Haben: 106.672,74
 *   OK!
 *
 * That figure is what the month's staff cost is taken to be. It is read rather
 * than recomputed from the lines: summing the expense accounts gives a
 * different number, because some of what runs through 3790 is booked to other
 * accounts, and second-guessing the payroll's own reconciliation would only
 * add a way to be wrong.
 *
 * Soll and Haben must agree. A journal where they do not has not reconciled,
 * and its figure is refused rather than trusted.
 */

const MONTHS: Record<string, string> = {
  januar: '01', februar: '02', märz: '03', maerz: '03', april: '04', mai: '05',
  juni: '06', juli: '07', august: '08', september: '09', oktober: '10',
  november: '11', dezember: '12',
};

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

export interface FibuJournal {
  /** First of the month, 2026-09-01. */
  month: string;
  total: number;
  totalHaben: number;
}

export class FibuParseError extends Error {}

export function parseFibuJournal(text: string, filename = ''): FibuJournal {
  const flat = String(text ?? '').replace(/\s+/g, ' ');

  /* The month is printed under the title: "FiBu-Journal September 2026". The
     filename ("… 26-09.pdf") is the fallback. */
  let month: string | null = null;
  const m = /FiBu-Journal\s+([A-Za-zäÄ]+)\s+(\d{4})/i.exec(flat);
  if (m && MONTHS[m[1].toLowerCase()]) month = `${m[2]}-${MONTHS[m[1].toLowerCase()]}-01`;
  if (!month) {
    const f = /(\d{2})-(\d{2})(?:\D|$)/.exec(filename);
    if (f) month = `20${f[1]}-${f[2]}-01`;
  }
  if (!month) throw new FibuParseError('Der Monat des Journals war nicht zu erkennen.');

  const rec = /Abstimmung Lohnverrechnungskonto[^]*?Soll:\s*([\d.]+,\d{2})[^]*?Haben:\s*([\d.]+,\d{2})/i.exec(flat);
  if (!rec) throw new FibuParseError('Die Abstimmung des Lohnverrechnungskontos (Seite 2) fehlt im Journal.');

  const total = num(rec[1]);
  const totalHaben = num(rec[2]);
  if (Math.abs(total - totalHaben) > 0.005) {
    throw new FibuParseError(
      `Das Journal ist nicht abgestimmt: Soll ${rec[1]} gegen Haben ${rec[2]}. Bitte die korrigierte Fassung hochladen.`);
  }
  return { month, total, totalHaben };
}
