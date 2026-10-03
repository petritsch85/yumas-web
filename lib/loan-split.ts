/**
 * Interest and capital, read out of the bank's own wording.
 *
 * The Sparkasse Darlehen leaves as one payment of 7.206,00 € a month, which is
 * why the P&L carried no interest at all: calling the whole of it interest
 * would be wrong, and the split was thought to need the loan statement. It does
 * not. The bank prints it on every booking:
 *
 *   Rechnung Darl.-Leistung 6091829611 Für 01.08.2026 - 30.08.2026
 *   Saldo: 213.555,33-  Tilgung 6.505,47  Zinsen 700,53
 *
 * Tilgung and Zinsen add to the payment exactly, on all eight bookings of 2026,
 * so nothing has to be estimated.
 *
 * Two further kinds of interest are easy to miss. The shareholder loans are
 * serviced by payments narrated "Zinsrückzahlung", and the monthly Abrechnung
 * bundles overdraft interest together with the account fees — only the interest
 * part of that charge belongs here, the rest is a cost of banking.
 */

/** German decimals: 6.505,47 -> 6505.47 */
const de = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

export interface LoanSplit {
  /** The cost of the borrowing. */
  interest: number;
  /** Debt repaid, which is not a cost at all. */
  capital: number;
}

const NONE: LoanSplit = { interest: 0, capital: 0 };

/**
 * What a bank line contributes to interest and to capital repaid.
 *
 * `amount` is the absolute amount of the payment, used only where the whole of
 * it is interest.
 */
export function splitFinancing(description: string | null | undefined, amount: number): LoanSplit {
  const d = description ?? '';

  /* The amortising loan: both halves are printed. */
  const loan = d.match(/Tilgung\s+([\d.]+,\d{2})\s+Zinsen\s+([\d.]+,\d{2})/i);
  if (loan) return { capital: de(loan[1]), interest: de(loan[2]) };

  /* Servicing the shareholder loans; the narrative says what it is. */
  if (/zinsr[üu]ckzahlung/i.test(d)) return { interest: Math.abs(amount), capital: 0 };

  /* The monthly Abrechnung is mostly account fees. Only the overdraft interest
     inside it is a financing cost — 141,43 € across 2026, against a thousand
     euros of Entgelte that belong in SG&A. */
  const overdraft = d.match(/Zinsen f[üu]r Konto-\/Kredit[^\d]{0,24}([\d.]+,\d{2})-/i);
  if (overdraft) return { interest: de(overdraft[1]), capital: 0 };

  return NONE;
}

/** True where a line carries financing at all, so callers can skip the rest. */
export const isFinancing = (description: string | null | undefined) =>
  /Tilgung\s+[\d.]+,\d{2}\s+Zinsen|zinsr[üu]ckzahlung|Zinsen f[üu]r Konto-\/Kredit/i.test(description ?? '');
