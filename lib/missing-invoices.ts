/**
 * Payments with no invoice behind them.
 *
 * A booking on the statement that nothing explains is the gap that matters for
 * the Steuerberater: a page of the folder with nothing to file behind it. The
 * count of documents says nothing about this — September had 220 invoices and
 * 66 unexplained payments at the same time, which is why a full folder could
 * still show a green tick.
 *
 * Not every unmatched payment is a missing document. Wages, the health funds,
 * the Finanzamt and the loan never had an invoice; they are evidenced by the
 * payroll run, the contribution statements and the loan agreement. Listing
 * those would bury the few that are real — 113 of September's 179 unmatched
 * payments are of that kind.
 */

export interface Gap {
  id: string;
  date: string;
  counterparty: string;
  description: string;
  /** Always positive; these are payments out. */
  amount: number;
  /** Where it sits in the printed Kontoauszug, when that has been filed. */
  page?: number;
  seq?: number;
}

/** Payments that never have an invoice, and what they are instead. */
const NO_INVOICE_EXPECTED: [RegExp, string][] = [
  [/lohn|gehalt|abschlag|vorschuss|finale? zahlung gehalt/i, 'Lohn/Gehalt'],
  [/aok|techniker krankenkasse|barmer|dak|ikk |bkk |hkk |knappschaft|meine krankenkasse|hek -/i, 'Krankenkasse'],
  [/^fa ffm|steuernr|lohnst|ums\.st/i, 'Finanzamt'],
  [/berufsgenossenschaft/i, 'Berufsgenossenschaft'],
  [/darl\.-leistung|zinsr[üu]ckzahlung|gesellschafterdarlehen/i, 'Darlehen/Zinsen'],
  /* Benjamin Peters lends the company money short-term and is repaid: financing, no invoice. */
  [/^benjamin peters\b/i, 'Gesellschafterdarlehen (kurzfristig)'],
  [/abrechnung \d{2}\.\d{2}\.\d{4}|kontof[üu]hrung|entgelte vom|rechnung firmenkundenportal/i, 'Bankentgelte'],
  [/bundeskasse|stadtkasse|gemeinschaftskasse|landeswohlfahrt|rundfunk/i, 'Behörden/Gebühren'],
  /* The landlords bill once in the lease; the Ersatzbelege stand in for it. */
  [/^wohnraum|^strabag|^patricia wohninveste|^laura klein/i, 'Miete (Ersatzbeleg)'],
  /* Leases and financing: one contract, a fixed rate every month, no monthly
     invoice — the contract is the document. */
  [/^targo leasing|^abcfinance|^vw leasing|^otto payments|^ford bank/i, 'Leasing/Finanzierung (Vertrag)'],
  /* Energy: a monthly Abschlag against the yearly bill, which is filed when it comes. */
  [/^suewag|^süwag|^schwarzwald energy/i, 'Energie-Abschlag'],
  /* Money paid back to a guest charged twice at the till — 'Doppelt Berechnung',
     'Doppel Buchung - Erstattung'. A refund, not a purchase: there is no invoice. */
  [/^matteo russo|^christin wueste|doppelt? ?(berechnung|buchung)/i, 'Erstattung an Gast (Doppelbuchung)'],
  /* The Steuerberater's own invoice: he issues it, so he has it. */
  [/^dipl\.?-?\s*kfm\.?\s*r\.?\s*nientiedt|^nientiedt\b/i, 'Steuerberater (eigene Rechnung)'],
  /* A payment marked on the Cash Flow page as paid twice: the invoice is
     already behind the first payment, and the money is to come back. */
  [/doppelzahlung/i, 'Doppelzahlung (Erstattung erwartet)'],
  /**
   * The card acquirers send a monthly statement, never an invoice.
   *
   * Nexi's debit of 03.09. quotes its own figures in the narrative —
   * "ENTG1256,24:UST235,62" — and the August Monatsabrechnung carries exactly
   * those, netting to the 1.491,86 € that left the account. The document is on
   * file, in position 05 of the month folder; it is simply not a bill, so
   * looking for one found nothing and called it a gap.
   *
   * PayPal is deliberately NOT here. Its debits are purchases from merchants —
   * Böttcher, Canva, Walch Food — and each of those does want an invoice. Only
   * an acquirer that debits its own fee belongs in this line.
   */
  [/^nexi|^concardis|^payone|american express|^amex\b|^stripe/i,
    'Zahlungsdienstleister (Monatsabrechnung)'],
];

/** Why no invoice is expected for this payment, or null if one should exist. */
export function noInvoiceExpected(counterparty: string | null, description: string | null): string | null {
  const s = `${counterparty ?? ''} ${description ?? ''}`;
  for (const [re, label] of NO_INVOICE_EXPECTED) if (re.test(s)) return label;
  return null;
}

/** The share of a month's payments that genuinely want an invoice. */
export function findGaps(
  transactions: { id: string; date: string; direction: string; counterparty: string | null;
                  description: string | null; amount_cents: number; notes?: string | null }[],
  linked: Set<string>,
  place?: (date: string, cents: number) => { page: number; seq: number } | undefined,
): Gap[] {
  return transactions
    .filter(t => t.direction !== 'in' && !linked.has(String(t.id)))
    /* The booking's own note counts too: "Doppelzahlung" written on it by hand. */
    .filter(t => !noInvoiceExpected(t.counterparty, `${t.description ?? ''} ${t.notes ?? ''}`))
    .map(t => {
      const at = place?.(t.date, -Math.abs(t.amount_cents));
      return {
        id: String(t.id), date: t.date,
        counterparty: t.counterparty ?? '—',
        description: t.description ?? '',
        amount: Math.abs(t.amount_cents) / 100,
        page: at?.page, seq: at?.seq,
      };
    })
    .sort((a, b) => (a.page ?? 999) - (b.page ?? 999) || (a.seq ?? 0) - (b.seq ?? 0) || b.amount - a.amount);
}
