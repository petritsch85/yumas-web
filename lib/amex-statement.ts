/**
 * Reading an American Express Akzeptanzpartner monthly statement.
 *
 * One statement per merchant number (Akzeptanzpartnernummer) — Yumas has three,
 * one per restaurant. Page 4 holds the payment summary, one line per transfer:
 *
 *   02.09.2026 32420264 47 1.541,10 0,00 35,45- 0,00 6,74- 1.498,91
 *   date       ref      n  gross    refunds fees other VAT  payout
 *
 * The bank's narrative for each transfer names the same merchant number
 * ("VU7041786070"), which is what lets a payout be matched to its statement
 * without guessing between three accounts paying similar amounts.
 */

export interface AmexPayout {
  date: string;          // 2026-09-02
  reference: string;
  transactions: number;
  gross: number;
  fees: number;          // service fees, positive, excl. VAT
  vat: number;           // VAT on the fees, positive
  payout: number;
}

export interface AmexStatement {
  merchantNumber: string;   // digits only, 7041786070
  periodStart: string | null;
  periodEnd: string | null;
  payouts: AmexPayout[];
  gross: number;
  feesNet: number;
  feesVat: number;
  payoutTotal: number;
}

export class AmexParseError extends Error {}

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.').replace(/-$/, ''));
const iso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;

export function parseAmexStatement(text: string): AmexStatement {
  const flat = String(text ?? '').replace(/\s+/g, ' ');
  if (!/AKZEPTANZPARTNER/i.test(flat)) throw new AmexParseError('Keine American-Express-Abrechnung.');

  const mn = /Akzeptanzpartnernummer\s+(?:Seite \d+ bis \d+\s+)?(?:\d{2}\.\d{2}\.\d{4}\s+)?(\d{3}\s?\d{3}\s?\d{3}\s?\d)/i.exec(flat)
    ?? /(\d{3} \d{3} \d{3} \d) RESTAURANT/i.exec(flat);
  if (!mn) throw new AmexParseError('Die Akzeptanzpartnernummer war nicht zu finden.');
  const merchantNumber = mn[1].replace(/\s+/g, '');

  const per = /Abrechnung vom (\d{1,2})\. (\w+) (\d{4}) bis zum (\d{1,2})\. (\w+)\s*(\d{4})/i.exec(flat);
  const MONTHS: Record<string, string> = { januar: '01', februar: '02', märz: '03', april: '04', mai: '05', juni: '06',
    juli: '07', august: '08', september: '09', oktober: '10', november: '11', dezember: '12' };
  const d = (day: string, mon: string, y: string) =>
    MONTHS[mon.toLowerCase()] ? `${y}-${MONTHS[mon.toLowerCase()]}-${day.padStart(2, '0')}` : null;

  /* The payment summary is the one table whose lines start with the payout
     date followed by the payment reference. */
  const sum = flat.split(/Zahlungszusammenfassung/i)[1] ?? '';
  const RE = /(\d{2}\.\d{2}\.\d{4}) (\d{6,10}) (\d+) ([\d.]+,\d{2}) ([\d.]+,\d{2}-?) ([\d.]+,\d{2}-?) ([\d.]+,\d{2}-?) ([\d.]+,\d{2}-?) ([\d.]+,\d{2})/g;
  const payouts: AmexPayout[] = [];
  for (const m of sum.matchAll(RE)) {
    payouts.push({
      date: iso(m[1]), reference: m[2], transactions: Number(m[3]),
      gross: num(m[4]), fees: num(m[6]), vat: num(m[8]), payout: num(m[9]),
    });
  }
  if (!payouts.length) throw new AmexParseError('Die Zahlungszusammenfassung (Auszahlungen) war nicht zu lesen.');

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const st: AmexStatement = {
    merchantNumber,
    periodStart: per ? d(per[1], per[2], per[3]) : null,
    periodEnd: per ? d(per[4], per[5], per[6]) : null,
    payouts,
    gross: r2(payouts.reduce((t, p) => t + p.gross, 0)),
    feesNet: r2(payouts.reduce((t, p) => t + p.fees, 0)),
    feesVat: r2(payouts.reduce((t, p) => t + p.vat, 0)),
    payoutTotal: r2(payouts.reduce((t, p) => t + p.payout, 0)),
  };
  /* The statement's own arithmetic: gross less fees and VAT is what was paid.
     A statement that does not add up is refused rather than half-trusted. */
  if (Math.abs(st.gross - st.feesNet - st.feesVat - st.payoutTotal) > 0.05) {
    throw new AmexParseError(`Die Abrechnung geht nicht auf: ${st.gross} − ${st.feesNet} − ${st.feesVat} ≠ ${st.payoutTotal}.`);
  }
  return st;
}
