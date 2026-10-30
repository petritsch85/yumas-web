/**
 * The Too Good To Go monthly statement.
 *
 * TGTG sells our bags, credits us their price and invoices its fee on the same
 * document. The fee invoice is filed as a bill; the credits are our sales, one
 * line per store and bag type:
 *
 *   "30/09/2026 115 Überraschungstüten gerettet, Yumas - Eschborn (Überraschungstüte) 14797958 -397,77 €"
 *
 * The amount is what the customers paid — gross, at 7 % (food to take away).
 * A Mittagstüte is lunch; an Abendtüte or Überraschungstüte is dinner.
 */

export const TGTG_VAT = 0.07;

export interface TgtgLine {
  date: string;          // 2026-09-30, the statement's booking date
  store: string;         // "Eschborn", "Westend", "Taunus"
  bagType: string;       // "Überraschungstüte", "Mittagstüte", …
  shift: 'lunch' | 'dinner';
  bags: number;
  gross: number;
  net: number;
}

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

/* The statement spells the store as TGTG has it; the app's names are shorter. */
const STORE = (raw: string) => {
  const s = raw.trim();
  if (/taunus/i.test(s)) return 'Taunus';
  if (/eschborn/i.test(s)) return 'Eschborn';
  if (/westend/i.test(s)) return 'Westend';
  return s;
};

export function parseTgtgStatement(raw: string): { month: string | null; lines: TgtgLine[] } {
  const t = raw.replace(/\s+/g, ' ');
  const re = /(\d{2})\/(\d{2})\/(\d{4}) (\d+) Überraschungstüten? gerettet, Yumas - ([^()]+?) \(([^)]+)\) \d+ (-?[\d.]+,\d{2}) €/g;
  const lines: TgtgLine[] = [];
  for (const m of t.matchAll(re)) {
    const gross = Math.abs(num(m[7]));
    const bagType = m[6].trim();
    lines.push({
      date: `${m[3]}-${m[2]}-${m[1]}`,
      store: STORE(m[5]),
      bagType,
      shift: /mittag/i.test(bagType) ? 'lunch' : 'dinner',
      bags: Number(m[4]),
      gross,
      net: Math.round((gross / (1 + TGTG_VAT)) * 100) / 100,
    });
  }
  /* The month the bags were sold in: the statement closes on its last day. */
  const month = lines.length ? lines.map(l => l.date).sort().at(-1)!.slice(0, 7) : null;
  return { month, lines };
}
