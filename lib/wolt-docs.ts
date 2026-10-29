/**
 * The documents Wolt sends for every five-day period, and which of them the
 * Steuerberater needs on paper.
 *
 * Per restaurant and period Wolt sends four PDFs: its own invoice for fees and
 * advertising, the self-billing invoice for our sales, a netting report and a
 * sales report. Only the two invoices carry VAT. The netting report says of
 * itself "Diese Seite stellt keine Rechnung dar" and the sales report lists
 * every order, so neither adds a tax figure, and between them they were half
 * of the ninety-nine pages September printed.
 *
 * Eschborn is the exception: Wolt sends it no self-billing invoice, and its
 * sales VAT appears only on the Auszahlungsbericht, so that one is printed.
 */

export type WoltDocType = 'fee_invoice' | 'self_billing' | 'payout_report' | 'netting_report' | 'sales_report' | 'other';

export function woltDocType(filename: string): WoltDocType {
  const f = filename.toUpperCase();
  if (/WOLT_TO_MERCHANT/.test(f)) return 'fee_invoice';
  if (/MERCHANT_TO_WOLT/.test(f)) return 'self_billing';
  if (/PAYOUT_REPORT/.test(f)) return 'payout_report';
  if (/NETTING_REPORT/.test(f)) return 'netting_report';
  if (/SALES_REPORT/.test(f)) return 'sales_report';
  return 'other';
}

/** Whether a document goes into the printed folder. Unknown documents do, to be safe. */
export const woltForPrint = (t: WoltDocType) => t !== 'netting_report' && t !== 'sales_report';

/** "1_Yumas Westend_WOLT_TO_…" or "Yumas Eschborn__payout_report__…" → "Westend". */
export function woltStore(filename: string): string {
  return filename.match(/Yumas[ _]([A-Za-zÄÖÜäöüß]+)/)?.[1] ?? '—';
}

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const N = String.raw`(-?[\d.]+,\d{2})`;

export type VatSplit = Record<string, { net: number; vat: number }>;
export interface WoltDocFigures {
  type: WoltDocType;
  invoiceNumber: string | null;
  periodFrom: string | null;   // 2026-09-16
  periodTo: string | null;
  /** Sales (self-billing, payout report) or fees (fee invoice), by VAT rate. */
  split: VatSplit;
  /** What Wolt paid out, from the netting or payout report. */
  payout: number | null;
  /** Wolt Capital repayments deducted before the payout. */
  capital: number | null;
}

const iso = (d: string) => { const [dd, mm, yy] = d.split('.'); return `${yy}-${mm}-${dd}`; };
const add = (s: VatSplit, rate: string, net: number, vat: number) => {
  const k = String(Number(rate));
  s[k] = { net: (s[k]?.net ?? 0) + net, vat: (s[k]?.vat ?? 0) + vat };
};

/** The figures the monthly Wolt summary needs, read from one document's text. */
export function parseWoltDoc(type: WoltDocType, raw: string): WoltDocFigures {
  const t = raw.replace(/\s+/g, ' ');
  const period = t.match(/Leistungszeitraum (\d{2}\.\d{2}\.\d{4}) - (\d{2}\.\d{2}\.\d{4})/);
  const out: WoltDocFigures = {
    type,
    invoiceNumber: t.match(/Rechnungsnummer (DEU\/\d+\/HRB\w+\/\d+\/\d+)/)?.[1] ?? null,
    periodFrom: period ? iso(period[1]) : null,
    periodTo: period ? iso(period[2]) : null,
    split: {}, payout: null, capital: null,
  };

  if (type === 'self_billing') {
    /* "Summe Nettopreis (A - B) mit Umsatzsteuer 7.00 % 1.060,11 7.00 74,20 1.134,31", once per rate. */
    for (const m of t.matchAll(new RegExp(String.raw`mit Umsatzsteuer (\d+\.\d+) % ${N} \d+\.\d+ ${N} ${N}`, 'g'))) {
      add(out.split, m[1], num(m[2]), num(m[3]));
    }
  } else if (type === 'fee_invoice') {
    /* Two layouts. The longer one closes with a VAT table before "Gesamtbetrag";
       the short one (advertising only) with a single "Summe net vat gross". */
    const table = t.match(new RegExp(String.raw`Summe \(inkl\. USt\)((?: \d+\.\d+ ${N} ${N} ${N})+) Gesamtbetrag`));
    if (table) {
      for (const m of table[1].matchAll(new RegExp(String.raw`(\d+\.\d+) ${N} ${N} ${N}`, 'g'))) add(out.split, m[1], num(m[2]), num(m[3]));
    } else {
      const rates = [...t.matchAll(/(\d+\.\d+)% /g)].map(m => m[1]);
      const sums = [...t.matchAll(new RegExp(String.raw`Summe ${N} ${N} ${N}`, 'g'))];
      const last = sums.at(-1);
      if (last) add(out.split, rates[0] ?? '19.00', num(last[1]), num(last[2]));
    }
  } else if (type === 'payout_report') {
    /* Line items carry their rate ("243,45 7.00% 17,05 260,50"); subtotals do not. */
    const sales = t.split('Rechnung von Wolt an Händler')[0];
    for (const m of sales.matchAll(new RegExp(String.raw`${N} (\d+\.\d+)% ${N} ${N}`, 'g'))) add(out.split, m[2], num(m[1]), num(m[3]));
    const p = t.match(new RegExp(String.raw`Zahlungsbetrag ${N}`));
    out.payout = p ? num(p[1]) : null;
  } else if (type === 'netting_report') {
    const p = t.match(new RegExp(String.raw`Nettoauszahlung ${N}`));
    out.payout = p ? num(p[1]) : null;
    const c = t.match(new RegExp(String.raw`Wolt capital \d{2}\.\d{2}\.\d{4} - \d{2}\.\d{2}\.\d{4} ${N}`, 'i'));
    out.capital = c ? num(c[1]) : null;
  }
  return out;
}
