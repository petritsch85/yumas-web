/**
 * Turning the month's records into postings — the Vorkontierung itself.
 *
 * Three kinds of posting come out of this business:
 *
 *  - **Revenue**, one posting per day per rate, from the till and the other
 *    sales channels. Posted against the account the money landed in, which
 *    for card and platform sales is a clearing account rather than the bank:
 *    the takings and the transfer that settles them are days apart, and
 *    posting both to the bank would double the cash.
 *  - **Purchases**, one per supplier invoice: the expense account against the
 *    supplier's own creditor account. That is what gives the Steuerberater
 *    open-item management — which invoices are still owed.
 *  - **Payments**, one per bank line that settles an invoice: the creditor
 *    account against the bank. Only where the cash flow is actually linked to
 *    a bill, because a payment posted against a guess is worse than one left
 *    for a person.
 *
 * Anything without a mapped account is not posted. It is returned as a gap,
 * named, so the mapping can be finished — a batch that quietly dumps a third
 * of the costs into a suspense account looks complete and is not.
 */

import type { DatevBooking, DatevSettings } from './datev-extf';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PostingSource {
  /** Daily till sales, already split by rate. */
  shifts: { report_date: string; location_id: string; gross_food: number; gross_beverages: number }[];
  /** Delivery and webshop sales, as gross by day and rate. */
  otherSales: { date: string; label: string; gross7: number; gross19: number; account?: string | null }[];
  /** Supplier invoices, approved or paid. */
  bills: {
    id: string; supplier_name: string; invoice_number: string | null; invoice_date: string | null;
    gross_amount: number; vat_amount: number; category: string | null; status: string;
    counterpartyId?: string | null; counterpartyName?: string | null;
  }[];
  /** Bank lines that settle one of those invoices. */
  payments: { date: string; amount: number; billId: string; counterparty: string }[];
  /** How a counterparty or a category is posted. */
  accounts: { scope: 'counterparty' | 'category'; ref: string; account: string | null; creditor_account: string | null; bu_key: string | null; cost_centre: string | null }[];
  /** Which restaurant a location id is, for the Kostenstelle. */
  costCentres: Record<string, string>;
}

/** Something that could not be posted, and what would fix it. */
export interface PostingGap {
  kind: 'supplier' | 'category' | 'revenue';
  name: string;
  count: number;
  amount: number;
  hint: string;
}

export interface PostingResult {
  bookings: DatevBooking[];
  gaps: PostingGap[];
  /** Totals for the preview, so a person can sanity-check before exporting. */
  revenueTotal: number;
  purchaseTotal: number;
  paymentTotal: number;
}

export function buildPostings(src: PostingSource, s: DatevSettings): PostingResult {
  const bookings: DatevBooking[] = [];
  const gaps = new Map<string, PostingGap>();
  const addGap = (kind: PostingGap['kind'], name: string, amount: number, hint: string) => {
    const key = `${kind}:${name}`;
    const g = gaps.get(key) ?? { kind, name, count: 0, amount: 0, hint };
    g.count += 1; g.amount = round2(g.amount + amount);
    gaps.set(key, g);
  };

  const byCounterparty = new Map(src.accounts.filter(a => a.scope === 'counterparty').map(a => [a.ref, a]));
  const byCategory     = new Map(src.accounts.filter(a => a.scope === 'category').map(a => [a.ref, a]));

  /* ── Revenue ──
     Till takings are posted against the cash account: the Z-report is the day's
     record and the card settlement arrives separately, which the bank side of
     the batch picks up. One posting per day per rate keeps the batch readable
     and still ties to the day. */
  let revenueTotal = 0;
  const byDate = new Map<string, { food: number; drinks: number; locations: Set<string> }>();
  for (const sh of src.shifts) {
    const d = byDate.get(sh.report_date) ?? { food: 0, drinks: 0, locations: new Set<string>() };
    d.food   += Number(sh.gross_food ?? 0);
    d.drinks += Number(sh.gross_beverages ?? 0);
    d.locations.add(sh.location_id);
    byDate.set(sh.report_date, d);
  }
  for (const [date, d] of [...byDate.entries()].sort()) {
    // One location that day means the Kostenstelle is unambiguous.
    const centre = d.locations.size === 1 ? src.costCentres[[...d.locations][0]] ?? null : null;
    if (round2(d.food) !== 0) {
      bookings.push({
        amount: round2(d.food), debitCredit: 'S',
        account: s.accountCash, contraAccount: s.accountRevenue7,
        date, text: 'Tageserloese Speisen 7%', costCentre: centre, source: 'Orderbird',
      });
      revenueTotal = round2(revenueTotal + d.food);
    }
    if (round2(d.drinks) !== 0) {
      bookings.push({
        amount: round2(d.drinks), debitCredit: 'S',
        account: s.accountCash, contraAccount: s.accountRevenue19,
        date, text: 'Tageserloese Getraenke 19%', costCentre: centre, source: 'Orderbird',
      });
      revenueTotal = round2(revenueTotal + d.drinks);
    }
  }

  /* The other channels settle through their own account — the platform owes us
     the money for days before it arrives — so each carries its own clearing
     account where the mapping gives one. */
  for (const r of src.otherSales) {
    const clearing = r.account ?? null;
    if (!clearing) {
      addGap('revenue', r.label, round2(r.gross7 + r.gross19),
        'Give this channel a clearing account, so its sales and its payout can be reconciled.');
      continue;
    }
    if (round2(r.gross7) !== 0) {
      bookings.push({
        amount: round2(r.gross7), debitCredit: 'S',
        account: clearing, contraAccount: s.accountRevenue7,
        date: r.date, text: `${r.label} Erloese 7%`.slice(0, 60), source: r.label,
      });
      revenueTotal = round2(revenueTotal + r.gross7);
    }
    if (round2(r.gross19) !== 0) {
      bookings.push({
        amount: round2(r.gross19), debitCredit: 'S',
        account: clearing, contraAccount: s.accountRevenue19,
        date: r.date, text: `${r.label} Erloese 19%`.slice(0, 60), source: r.label,
      });
      revenueTotal = round2(revenueTotal + r.gross19);
    }
  }

  /* ── Purchases ──
     The expense account is debited and the supplier's creditor account
     credited, which is what leaves an open item until it is paid. */
  let purchaseTotal = 0;
  const creditorFor = (billId: string) => {
    const b = src.bills.find(x => x.id === billId);
    if (!b) return null;
    const cp = b.counterpartyId ? byCounterparty.get(b.counterpartyId) : null;
    return cp?.creditor_account ?? null;
  };
  for (const b of src.bills) {
    if (!b.invoice_date || round2(b.gross_amount) === 0) continue;
    const cp  = b.counterpartyId ? byCounterparty.get(b.counterpartyId) : null;
    const cat = b.category ? byCategory.get(b.category) : null;

    const expense  = cp?.account ?? cat?.account ?? null;
    const creditor = cp?.creditor_account ?? null;

    if (!expense) {
      addGap('supplier', b.counterpartyName ?? b.supplier_name, Number(b.gross_amount),
        b.counterpartyId
          ? 'Give this counterparty an expense account.'
          : `No counterparty matches this supplier, so the category "${b.category ?? 'none'}" would have to carry it.`);
      continue;
    }
    if (!creditor) {
      addGap('supplier', b.counterpartyName ?? b.supplier_name, Number(b.gross_amount),
        'Give this counterparty a creditor account (Personenkonto), so the invoice stays an open item until it is paid.');
      continue;
    }
    bookings.push({
      amount: round2(Number(b.gross_amount)), debitCredit: 'S',
      account: expense, contraAccount: creditor,
      buKey: cp?.bu_key ?? cat?.bu_key ?? null,
      date: b.invoice_date,
      reference: b.invoice_number,
      text: `${b.counterpartyName ?? b.supplier_name}`,
      costCentre: cp?.cost_centre ?? cat?.cost_centre ?? null,
      source: 'Bill',
    });
    purchaseTotal = round2(purchaseTotal + Number(b.gross_amount));
  }

  /* ── Payments ──
     Only where the bank line is linked to an invoice. Debit the creditor,
     credit the bank: the open item closes and the cash moves. */
  let paymentTotal = 0;
  for (const p of src.payments) {
    const creditor = creditorFor(p.billId);
    if (!creditor) continue;   // the invoice itself is already reported as a gap
    const bill = src.bills.find(x => x.id === p.billId);
    bookings.push({
      amount: round2(Math.abs(p.amount)), debitCredit: 'S',
      account: creditor, contraAccount: s.accountBank,
      date: p.date,
      reference: bill?.invoice_number ?? null,
      text: `Zahlung ${bill?.counterpartyName ?? p.counterparty}`,
      source: 'Payment',
    });
    paymentTotal = round2(paymentTotal + Math.abs(p.amount));
  }

  return {
    bookings: bookings.sort((a, b) => a.date.localeCompare(b.date)),
    gaps: [...gaps.values()].sort((a, b) => b.amount - a.amount),
    revenueTotal, purchaseTotal, paymentTotal,
  };
}
