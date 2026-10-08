import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { matchByReference, normaliseRef } from '@/lib/payment-reference';
import type { RefBill, TakenBill } from '@/lib/payment-reference';
import { linkObjection } from '@/lib/match-rules';
import { payableAmounts } from '@/lib/skonto';
import { markBillsPaid, unmarkBillsIfUnlinked } from '@/lib/bill-payment-status';
import { partyPaid, foldName } from '@/lib/payment-intermediary';

type WoltMatch = {
  /** Which delivery platform's settlement the payout ties to. */
  platform:       'wolt' | 'lieferando';
  txId:           string;
  txDate:         string;
  txCounterparty: string;
  txAmountCents:  number;
  periodId:       string;
  invoiceNumber:  string;
  restaurant:     string | null;
  periodStart:    string;
  periodEnd:      string;
  payout:         number;
  daysDiff:       number;
};

/** A payment whose reference names the invoices it settles. */
type ReferenceMatch = {
  txId:           string;
  txDate:         string;
  txCounterparty: string;
  txAmountCents:  number;
  supplier:       string;
  bills:          { id: string; invoiceNumber: string | null; invoiceDate: string | null; gross: number }[];
  sum:            number;
  /** Numbers the bank quotes that no invoice in the system carries. */
  missing:        string[];
  /** Numbers the bank quotes whose invoice we hold, but another payment claims. */
  taken:          TakenBill[];
  complete:       boolean;
  /** True when this adds to links already saved rather than making new ones. */
  toppingUp?:     boolean;
};

/** One of several payments settling a single bill. */
type InstalmentMatch = {
  txId:           string;
  txDate:         string;
  txCounterparty: string | null;
  txAmountCents:  number;
  billId:         string;
  invoiceNumber:  string | null;
  invoiceDate:    string | null;
  supplier:       string;
  billGross:      number;
  /** What other payments have already settled of this bill. */
  alreadyPaid:    number;
  /** What is left owing once this payment is counted. */
  remaining:      number;
};

/** A customer's payment against an invoice we issued. */
type OutgoingMatch = {
  txId:           string;
  txDate:         string;
  txCounterparty: string | null;
  txAmountCents:  number;
  billId:         string;
  invoiceNumber:  string | null;
  invoiceDate:    string | null;
  customerName:   string | null;
  totalPayable:   number;
  /** How it was found: the invoice number the customer quoted, or the amount alone. */
  via:            'invoice' | 'amount';
  /** Payment minus invoice, in euros. Zero unless the customer rounded. */
  delta:          number;
  /** True when it can be applied unreviewed. */
  confident:      boolean;
  /** What a person should know before ticking it. */
  note:           string | null;
};

/** A link already saved that the matching rules would now refuse to make. */
type SuspectLink = {
  txId:            string;
  txDate:          string;
  txDescription:   string | null;
  txCounterparty:  string | null;
  txAmountCents:   number;
  billId:          string;
  billSupplier:    string;
  billInvoiceNo:   string | null;
  billInvoiceDate: string | null;
  billGross:       number;
  code:            string;
  reason:          string;
};

type Match = {
  txId:            string;
  txDate:          string;
  txCounterparty:  string;
  txAmountCents:   number;
  billId:          string;
  billSupplier:    string;
  billInvoiceNo:   string | null;
  billInvoiceDate: string | null;
  billGross:       number;
  daysDiff:        number;
  /** How the match was made: the bank quoted the invoice number, or amount + supplier + date alone. */
  via:             'invoice' | 'amount';
  /** Every bill the payment settles — more than one where it paid several
   *  invoices (credit notes included) in one transfer. */
  bills:           { id: string; invoiceNo: string | null; gross: number }[];
};

/* An invoice number counts as quoted when its digits stand on their own in
   the bank text — "RNR 171503", not the "171503" inside "91715033". Bank
   exports break text across fields and sometimes mid-word, so the whole
   number (letters included) must also appear once separators are removed. */
const alnum = (s: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
function quotes(text: string, invoiceNumber: string | null): boolean {
  if (!invoiceNumber) return false;
  const whole = alnum(invoiceNumber);
  const core = (invoiceNumber.match(/\d+/g) ?? []).sort((a, b) => b.length - a.length)[0];
  if (!core || core.length < 5 || whole.length < 5) return false;
  if (!alnum(text).includes(whole)) return false;
  return new RegExp(`(?<!\\d)${core}(?!\\d)`).test(text);
}

/* The old REFERENCE regex lived here. It required a keyword before the number
   ("Re-Nr. 4711") and so missed "RE 65221" — the commonest form in this book —
   which is how most of the wrong links were made. linkObjection in
   lib/match-rules.ts replaces it: it works off the number shape, not a vocabulary. */

/** Fetch ALL rows from a query that may exceed Supabase's 1000-row cap */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(buildQuery: (page: number, pageSize: number) => any): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await buildQuery(page, PAGE);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    page++;
  }
  return all;
}

// POST { apply: false } → preview; POST { apply: true } → apply
export async function POST(req: NextRequest) {
  const { apply, only, unlink } = await req.json();
  /* Which payments to settle. The matching itself always runs in full and on
     the server, so the browser only ever chooses among proposals it was shown;
     it never says what a proposal contains. Omitting the list applies all. */
  const chosen: Set<string> | null = Array.isArray(only) ? new Set(only.filter((x: unknown) => typeof x === 'string')) : null;
  const picked = <T extends { txId: string }>(rows: T[]) => (chosen ? rows.filter(r => chosen.has(r.txId)) : rows);
  const admin = getSupabaseAdmin();

  /* Undoing links the audit flagged. The rule is re-checked here rather than
     taken on the browser's word: a link is only cut when the server agrees it
     is wrong, so a stale page cannot unpick a match someone made by hand. */
  if (Array.isArray(unlink) && unlink.length > 0) {
    const ids = unlink.filter((x: unknown) => typeof x === 'string') as string[];
    const { data: rows, error } = await admin
      .from('cashflow_transactions')
      .select('id, date, description, counterparty, bill:bills(id, invoice_number, invoice_date)')
      .in('id', ids)
      .not('bill_id', 'is', null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const cut: string[] = [];
    const freed: string[] = [];
    for (const tx of rows ?? []) {
      const bill = tx.bill as unknown as { id: string; invoice_number: string | null; invoice_date: string | null } | null;
      if (!bill || !linkObjection(tx, bill)) continue;
      cut.push(tx.id);
      freed.push(bill.id);
    }
    if (cut.length > 0) {
      const { error: upErr } = await admin.from('cashflow_transactions').update({ bill_id: null }).in('id', cut);
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
      await unmarkBillsIfUnlinked(admin, freed);
    }
    return NextResponse.json({ unlinked: cut.length, skipped: ids.length - cut.length });
  }

  // 1. Fetch ALL unlinked cost transactions (paginated to bypass 1000-row cap)
  let txs: any[];
  let linkRows: any[];
  try {
    txs = await fetchAll((page, size) =>
      admin.from('cashflow_transactions')
        .select('id, date, counterparty, description, amount_cents, direction')
        .is('bill_id', null)
        .eq('direction', 'out')
        .order('date', { ascending: false })
        .range(page * size, (page + 1) * size - 1)
    );
    // A transfer covering several bills is linked through transaction_bill_links, not bill_id
    linkRows = await fetchAll((page, size) =>
      admin.from('transaction_bill_links')
        .select('transaction_id, bill_id, amount')
        .order('id')
        .range(page * size, (page + 1) * size - 1)
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
  const multiLinkedTx = new Set(linkRows.map(r => r.transaction_id as string));
  /* Transactions already covered by links are kept aside: the amount passes
     must not touch them, but the reference pass below can still top one up
     when the invoices it was missing finally arrive. */
  const partiallyLinkedTxs = txs.filter(t => multiLinkedTx.has(t.id));
  txs = txs.filter(t => !multiLinkedTx.has(t.id));

  // 2. Fetch ALL bills and all linked bill_ids (paginated)
  let linkedRows: any[];
  let bills: any[];
  try {
    linkedRows = await fetchAll((page, size) =>
      admin.from('cashflow_transactions')
        // date and description name the payment holding a bill, so a link that
        // turns out to be the wrong one can be found and undone.
        .select('id, date, description, bill_id')
        .not('bill_id', 'is', null)
        .range(page * size, (page + 1) * size - 1)
    );
    /* settlement_amount arrives with supabase/add_bill_settlement.sql. Until
       that has been run the column is not there, and matching on the gross
       alone is still better than no matching at all. */
    const billColumns = 'id, supplier_name, invoice_number, invoice_date, gross_amount';
    try {
      bills = await fetchAll((page, size) =>
        admin.from('bills')
          .select(`${billColumns}, settlement_amount`)
          .order('invoice_date', { ascending: false })
          .range(page * size, (page + 1) * size - 1)
      );
    } catch {
      console.warn('[auto-match] bills.settlement_amount missing — run supabase/add_bill_settlement.sql');
      bills = await fetchAll((page, size) =>
        admin.from('bills')
          .select(billColumns)
          .order('invoice_date', { ascending: false })
          .range(page * size, (page + 1) * size - 1)
      );
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  const linkedBillIds = new Set([
    ...linkedRows.map(r => r.bill_id as string),
    ...linkRows.map(r => r.bill_id as string),
  ]);
  const availableBills = bills.filter(b => !linkedBillIds.has(b.id));

  /* A credit note is settled the other way round: the supplier sends the money
     back, so the evidence is a payment IN — "Kd.Nr.7148 GS 26003449" against a
     bill of −11,76 €. Every pass below looked only at money going out, so no
     credit note could ever match.
     Only refunds from a supplier that actually has an open credit note are
     pulled in. There are a handful of those against a thousand customer
     payments and platform payouts, and the amount passes compare every
     transaction with every other, so widening the pool wholesale would cost a
     great deal to find very little. */
  const openCreditNotes = availableBills.filter(b => Number(b.gross_amount) < 0);
  if (openCreditNotes.length > 0) {
    try {
      const refunds = await fetchAll((page, size) =>
        admin.from('cashflow_transactions')
          .select('id, date, counterparty, description, amount_cents, direction')
          .is('bill_id', null)
          .eq('direction', 'in')
          .order('id')
          .range(page * size, (page + 1) * size - 1)
      );
      const creditNoteParty = (tx: { counterparty: string | null }) =>
        openCreditNotes.some(b => {
          const words: string[] = (b.supplier_name ?? '').toLowerCase().split(/[^a-zà-ÿ0-9]+/).filter((w: string) => w.length > 3);
          const cp = (tx.counterparty ?? '').toLowerCase();
          return words.some((w: string) => cp.includes(w));
        });
      const relevant = refunds.filter(t => !multiLinkedTx.has(t.id) && creditNoteParty(t));
      txs = [...txs, ...relevant];
    } catch (e) {
      console.error('[auto-match] refund pass failed (non-fatal):', e);
    }
  }

  // 3. Fetch counterparties for keyword matching
  const { data: cps } = await admin
    .from('counterparties')
    .select('name, keywords');
  const counterparties = cps ?? [];

  function matchedSupplier(raw: string): string | null {
    const lower = raw.toLowerCase();
    for (const cp of counterparties) {
      const terms = cp.keywords?.length ? cp.keywords : [cp.name];
      if (terms.some((kw: string) => kw && lower.includes(kw.toLowerCase()))) {
        return cp.name.toLowerCase();
      }
    }
    return null;
  }

  /**
   * The same supplier, beyond doubt.
   *
   * sameSupplier below falls back to any shared word over three letters, and
   * "GmbH" is four — so against a counterparty called "Perola GmbH" it accepts
   * a bill from every other GmbH in the book. That is tolerable where the
   * invoice number has already identified the bill, and not at all where the
   * supplier is the only thing narrowing the field. This wants the
   * counterparty's own keywords, or failing those a word that actually names a
   * business.
   */
  const LEGAL_FORMS = new Set([
    'gmbh', 'mbh', 'ohg', 'kgaa', 'gmbhcokg', 'kg', 'gbr', 'ltd', 'limited', 'inh',
    'co', 'und', 'the', 'ag', 'se', 'ev', 'bv', 'nv', 'sarl', 'srl', 'spa',
    'deutschland', 'germany', 'group', 'holding', 'international', 'service', 'services',
    'vertrieb', 'handel', 'grosshandel', 'gastronomie', 'company',
  ]);
  function definitelySameSupplier(tx: any, b: { supplier_name: string }): boolean {
    /* partyPaid, not tx.counterparty: a PayPal purchase names PayPal in the
       counterparty and the merchant only in the narrative, so comparing the
       counterparty compared PayPal against thirteen different merchants and
       matched none of them. See lib/payment-intermediary.ts. */
    const party = partyPaid(tx);
    const resolved = matchedSupplier(party);
    if (resolved) return matchedSupplier(b.supplier_name ?? '') === resolved;
    /* Folded, so the bank's "Bottcher" reaches the invoice's "Böttcher". */
    const txFolded = foldName(party);
    return (b.supplier_name ?? '').toLowerCase()
      .split(/[^a-zà-ÿ0-9]+/)
      .some((w: string) => {
        if (LEGAL_FORMS.has(w)) return false;
        const f = foldName(w);
        return f.length > 3 && txFolded.includes(f);
      });
  }

  /** Whether a bill's supplier is the party the bank paid. */
  function sameSupplier(tx: any, b: any): boolean {
    const party = partyPaid(tx);
    const resolvedSupplier = matchedSupplier(party);
    const bLower = (b.supplier_name ?? '').toLowerCase();
    if (resolvedSupplier) {
      /* The bill's supplier goes through the same keywords as the bank's
         counterparty. A bill headed "vertical cloud solution GmbH" and a
         transfer to the same name both resolve to Gastromatic; comparing the
         resolved name against the raw one would miss it, because neither
         string contains the other. */
      const resolvedBill = matchedSupplier(b.supplier_name ?? '');
      if (resolvedBill) return resolvedBill === resolvedSupplier;
      return bLower.includes(resolvedSupplier) || resolvedSupplier.includes(bLower);
    }
    const txFolded = foldName(party);
    return bLower.split(' ').some((w: string) => {
      const f = foldName(w);
      return f.length > 3 && txFolded.includes(f);
    });
  }

  const cents = (euros: number) => Math.round(Number(euros) * 100);
  const days = (a: string, b: string) => Math.round(Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000);

  const matches: Match[] = [];
  const usedBillIds = new Set<string>();
  const usedTxIds = new Set<string>();

  const push = (tx: any, settled: any[], via: Match['via']) => {
    const first = settled[0];
    matches.push({
      txId:            tx.id,
      txDate:          tx.date,
      txCounterparty:  tx.counterparty,
      txAmountCents:   tx.amount_cents,
      billId:          first.id,
      billSupplier:    first.supplier_name,
      billInvoiceNo:   settled.map(b => b.invoice_number ?? '—').join(' + '),
      billInvoiceDate: first.invoice_date,
      billGross:       settled.reduce((s, b) => s + Number(b.gross_amount), 0),
      daysDiff:        first.invoice_date ? days(first.invoice_date, tx.date) : 0,
      via,
      bills:           settled.map(b => ({ id: b.id, invoiceNo: b.invoice_number, gross: Number(b.gross_amount) })),
    });
    settled.forEach(b => usedBillIds.add(b.id));
    usedTxIds.add(tx.id);
  };

  /* What a bill can show up as in the bank. A supplier taking Skonto collects
     the discounted figure printed on the invoice and nothing else, so a bill
     with a settlement amount has two faces and matching must accept either.
     See lib/skonto.ts. */
  const payable = (b: any) => payableAmounts(b).map(cents);
  /** Every signed total this set of bills could come to, Skonto taken or not. */
  const payableSums = (bs: any[]): number[] =>
    bs.reduce<number[]>((sums, b) => {
      const next = new Set<number>();
      for (const s of sums) for (const a of payable(b)) next.add(s + a);
      return [...next];
    }, [0]);

  /* Money has to move the way the paperwork points: an invoice is settled by a
     payment out, a credit note by a refund in. Amounts are then compared as
     magnitudes, since a transaction's amount_cents carries no sign. */
  const runsRight = (tx: any, signedCents: number) =>
    signedCents === 0 ? false
    : signedCents > 0 ? tx.direction === 'out'
    : tx.direction === 'in';
  /** Does any of these signed totals settle this transaction, the right way round? */
  const settles = (tx: any, signedTotals: number[]) =>
    signedTotals.some(s => Math.abs(s) === Math.abs(tx.amount_cents) && runsRight(tx, s));

  /* 4a. By invoice number. The bank quotes it, the supplier is the same, and
     the money agrees to the cent — one bill for the whole amount, or every
     quoted bill together (an invoice net of a credit note) for the whole
     amount. Nothing partial, nothing approximate. */
  for (const tx of txs) {
    const text = `${tx.counterparty ?? ''} ${tx.description ?? ''}`;
    const quoted = availableBills.filter(b => !usedBillIds.has(b.id) && quotes(text, b.invoice_number) && sameSupplier(tx, b));
    if (quoted.length === 0) continue;
    if (quoted.length === 1) {
      if (settles(tx, payable(quoted[0]))) push(tx, quoted, 'invoice');
    } else if (settles(tx, payableSums(quoted))) {
      push(tx, quoted, 'invoice');
    }
  }

  /* 4b. By amount, supplier and date — only where it cannot be anything else:
     the amount agrees to the cent, exactly one bill fits the payment, and no
     other payment fits that bill. Two bills of the same amount (a monthly
     subscription) are left for a person rather than decided by the nearer
     date. A payment naming an invoice is left out: it was matched above, or
     the invoice it names is not on file. */
  /* The amount has to agree and the supplier has to be right, but neither is
     enough on its own: linkObjection holds the two vetoes that the amount
     cannot argue with — the invoice number the bank names, and the direction
     of time. See lib/match-rules.ts. */
  const fits = (tx: any, b: any) =>
    settles(tx, payable(b)) &&
    !!b.invoice_date && days(b.invoice_date, tx.date) <= 45 &&
    sameSupplier(tx, b) &&
    !linkObjection(tx, b);

  const open = txs.filter(tx => !usedTxIds.has(tx.id));
  const freeBills = availableBills.filter(b => !usedBillIds.has(b.id));
  for (const tx of open) {
    const candidates = freeBills.filter(b => fits(tx, b));
    if (candidates.length !== 1) continue;
    const bill = candidates[0];
    const rivals = open.filter(other => other.id !== tx.id && fits(other, bill));
    if (rivals.length > 0) continue;
    push(tx, [bill], 'amount');
  }

  /* ── Wolt payouts are evidenced by their settlement period, not a bill ──
     Wolt sends no invoice we file under incoming bills; the netting report in
     Sales Reports is the document, and its Nettoauszahlung is exactly what
     lands in the bank. Matching on that figure ties the credit to the period
     that produced it. */
  const woltMatches: WoltMatch[] = [];
  try {
    const inTxs = await fetchAll((page, size) =>
      admin.from('cashflow_transactions')
        .select('id, date, counterparty, amount_cents, direction')
        .is('wolt_period_id', null)
        .eq('direction', 'in')
        .ilike('counterparty', '%wolt%')
        .order('date', { ascending: false })
        .range(page * size, (page + 1) * size - 1)
    );

    const periods = await fetchAll((page, size) =>
      admin.from('wolt_periods')
        .select('id, invoice_number, restaurant, period_start, period_end, payout_net, reported_endbetrag, contract')
        .range(page * size, (page + 1) * size - 1)
    );
    const takenRows = await fetchAll((page, size) =>
      admin.from('cashflow_transactions')
        .select('wolt_period_id')
        .not('wolt_period_id', 'is', null)
        .range(page * size, (page + 1) * size - 1)
    );
    const taken = new Set(takenRows.map(r => r.wolt_period_id as string));
    const usedPeriods = new Set<string>();

    for (const tx of inTxs) {
      const amt = tx.amount_cents / 100;
      const txTime = new Date(tx.date).getTime();
      const candidates = periods.filter(p => {
        if (taken.has(p.id) || usedPeriods.has(p.id)) return false;
        // The self-billing contract states a Nettoauszahlung; the self-delivery
        // one pays its Zahlungsbetrag, already stored as the Endbetrag.
        const payout = p.payout_net != null ? Number(p.payout_net) : Number(p.reported_endbetrag);
        if (Math.abs(payout - amt) > 0.005) return false;
        // Wolt transfers a couple of days after the period closes. A window
        // stops an identical amount months away from being claimed.
        const days = (txTime - new Date(p.period_end).getTime()) / 86400000;
        return days >= -1 && days <= 21;
      });
      if (candidates.length === 0) continue;

      const best = candidates.reduce((a, b) =>
        Math.abs(txTime - new Date(a.period_end).getTime()) <= Math.abs(txTime - new Date(b.period_end).getTime()) ? a : b);
      const payout = best.payout_net != null ? Number(best.payout_net) : Number(best.reported_endbetrag);

      woltMatches.push({
        platform: 'wolt',
        txId: tx.id, txDate: tx.date, txCounterparty: tx.counterparty, txAmountCents: tx.amount_cents,
        periodId: best.id, invoiceNumber: best.invoice_number, restaurant: best.restaurant,
        periodStart: best.period_start, periodEnd: best.period_end, payout,
        daysDiff: Math.round((txTime - new Date(best.period_end).getTime()) / 86400000),
      });
      usedPeriods.add(best.id);
    }
  } catch {
    // The Wolt columns may not exist before the migration; bill matching stands alone.
  }

  /* ── Lieferando payouts, the same way ──
     The weekly statement carries the Auszahlung. Lieferando does not pay out
     every week: a transfer can settle several weeks, and its amount is stated
     on the last of them, so that is the week the transaction links to. */
  const lieferandoMatches: WoltMatch[] = [];
  try {
    const inTxs = await fetchAll((page, size) =>
      admin.from('cashflow_transactions')
        .select('id, date, counterparty, amount_cents, direction')
        .is('lieferando_period_id', null)
        .eq('direction', 'in')
        // The bank names the payer Takeaway.com / Stichting Derdengelden, not Lieferando.
        .or('counterparty.ilike.%lieferando%,counterparty.ilike.%yourdelivery%,counterparty.ilike.%takeaway%,counterparty.ilike.%derdengelden%')
        .order('date', { ascending: false })
        .range(page * size, (page + 1) * size - 1)
    );
    const periods = await fetchAll((page, size) =>
      admin.from('lieferando_periods')
        .select('id, invoice_number, restaurant, period_start, period_end, payout')
        .not('payout', 'is', null)
        .range(page * size, (page + 1) * size - 1)
    );
    const takenRows = await fetchAll((page, size) =>
      admin.from('cashflow_transactions')
        .select('lieferando_period_id')
        .not('lieferando_period_id', 'is', null)
        .range(page * size, (page + 1) * size - 1)
    );
    const taken = new Set(takenRows.map(r => r.lieferando_period_id as string));
    const usedPeriods = new Set<string>();

    for (const tx of inTxs) {
      const amt = tx.amount_cents / 100;
      const txTime = new Date(tx.date).getTime();
      const candidates = periods.filter(p => {
        if (taken.has(p.id) || usedPeriods.has(p.id)) return false;
        if (Math.abs(Number(p.payout) - amt) > 0.005) return false;
        // The statement is dated the Sunday after the week; the transfer follows within days.
        const days = (txTime - new Date(p.period_end).getTime()) / 86400000;
        return days >= -1 && days <= 21;
      });
      if (candidates.length === 0) continue;
      const best = candidates.reduce((a, b) =>
        Math.abs(txTime - new Date(a.period_end).getTime()) <= Math.abs(txTime - new Date(b.period_end).getTime()) ? a : b);
      lieferandoMatches.push({
        platform: 'lieferando',
        txId: tx.id, txDate: tx.date, txCounterparty: tx.counterparty, txAmountCents: tx.amount_cents,
        periodId: best.id, invoiceNumber: best.invoice_number, restaurant: best.restaurant,
        periodStart: best.period_start, periodEnd: best.period_end, payout: Number(best.payout),
        daysDiff: Math.round((txTime - new Date(best.period_end).getTime()) / 86400000),
      });
      usedPeriods.add(best.id);
    }
  } catch {
    // Before the migration the column is missing; the other matches stand alone.
  }

  /* ── Payments whose reference names their invoices ──
     A supplier collecting a fortnight of deliveries by direct debit writes
     every invoice number into the Verwendungszweck. That is the only thing
     that can match one debit to sixteen bills: no single amount equals the
     payment, so the amount pass above cannot see it at all. */
  const referenceMatches: ReferenceMatch[] = [];
  try {
    const linkRows = await fetchAll((page, size) =>
      admin.from('transaction_bill_links').select('transaction_id, bill_id').range(page * size, (page + 1) * size - 1)
    );
    const linkedByAnything = new Set<string>([
      ...linkedBillIds,
      ...linkRows.map(r => r.bill_id as string),
    ]);
    /* What each part-linked payment already has against it, so a top-up is
       measured against the shortfall rather than the whole amount. */
    const grossById = new Map(bills.map(b => [b.id as string, Number(b.gross_amount)]));
    const numberById = new Map(bills.map(b => [b.id as string, normaliseRef(b.invoice_number as string | null)]));
    const linkedSum = new Map<string, number>();
    /* The invoice numbers a payment already holds. Without these a top-up
       reports the bills it is already attached to as missing. */
    const linkedNumbers = new Map<string, Set<string>>();
    for (const r of linkRows) {
      const txId = r.transaction_id as string;
      const g = grossById.get(r.bill_id as string);
      if (g === undefined) continue;
      linkedSum.set(txId, (linkedSum.get(txId) ?? 0) + g);
      const n = numberById.get(r.bill_id as string);
      if (n) {
        if (!linkedNumbers.has(txId)) linkedNumbers.set(txId, new Set());
        linkedNumbers.get(txId)!.add(n);
      }
    }

    /* Which payment already holds a bill. An invoice the bank names for this
       payment but that something else holds is not a missing invoice — it is
       very likely a link made on a coincidence of amount, and saying so is the
       only way the wrong one gets noticed. */
    const heldBy = new Map<string, { date: string; description: string | null }>();
    for (const r of linkedRows) {
      if (r.bill_id) heldBy.set(r.bill_id as string, { date: r.date as string, description: (r.description as string) ?? null });
    }

    const claimed = new Set<string>(matches.map(m => m.billId));
    /* Part-linked payments come first: closing one is worth more than opening a
       new one, and the bills it wants must not be claimed by something else in
       the meantime. */
    for (const tx of [...partiallyLinkedTxs, ...txs]) {
      if (matches.some(m => m.txId === tx.id)) continue;  // matched one-to-one above

      /* A payment that already has links is only revisited while it is short.
         The invoices it was missing arrive weeks later — fifteen Fruveg ones
         did — and nothing could ever attach them once the partial link was
         saved. */
      const already = linkedSum.get(tx.id) ?? 0;
      const shortfall = Math.round((Math.abs(tx.amount_cents) / 100 - already) * 100) / 100;
      const toppingUp = multiLinkedTx.has(tx.id);
      if (toppingUp && Math.abs(shortfall) < 0.01) continue;   // nothing left owing

      const resolved = matchedSupplier(partyPaid(tx));
      const sameParty = (b: { supplier_name: string }) => {
        const bLower = b.supplier_name.toLowerCase();
        if (resolved) {
          const resolvedBill = matchedSupplier(b.supplier_name);
          return resolvedBill ? resolvedBill === resolved : bLower.includes(resolved);
        }
        const txFolded = foldName(partyPaid(tx));
        return bLower.split(' ').some((w: string) => {
          const f = foldName(w);
          return f.length > 3 && txFolded.includes(f);
        });
      };

      const free = (b: { id: string }) => !linkedByAnything.has(b.id) && !claimed.has(b.id);
      const pool = availableBills.filter(b => free(b) && sameParty(b)) as RefBill[];
      if (pool.length === 0) continue;

      const held = bills
        .filter(b => !free(b) && sameParty(b))
        .map(b => ({ ...(b as RefBill), heldBy: heldBy.get(b.id) ?? null }));

      /* When topping up, the bills already attached are not in the pool, so
         the match is judged against what is still owing rather than the whole
         payment. */
      const asIfOwing = toppingUp
        ? { ...tx, amount_cents: Math.round(Math.abs(shortfall) * 100) }
        : tx;
      const hit = matchByReference(asIfOwing, pool, held);
      if (!hit) continue;

      for (const b of hit.bills) claimed.add(b.id);
      referenceMatches.push({
        txId: tx.id, txDate: tx.date, txCounterparty: tx.counterparty,
        txAmountCents: tx.amount_cents,
        supplier: hit.bills[0].supplier_name,
        bills: hit.bills.map(b => ({
          id: b.id, invoiceNumber: b.invoice_number, invoiceDate: b.invoice_date, gross: Number(b.gross_amount),
        })),
        sum: Math.round((already + hit.sum) * 100) / 100,
        /* A number this payment already holds is not missing from it. */
        missing: hit.missing.filter(m => !(linkedNumbers.get(tx.id)?.has(normaliseRef(m)) ?? false)),
        taken: hit.taken, complete: hit.complete,
        toppingUp,
      });
    }
  } catch {
    // The link table may not exist on an older database; the rest still stands.
  }

  /* ── One bill, several payments ──────────────────────────────────────────
     Every rule above assumes a payment settles whole bills. This is the
     inverse: Perola's invoice 161077 prints "Zahlung 4.250€ nach 30 Tagen,
     4.250€ nach 60 Tagen, 4.309,16€ nach 90 Tagen" and the bank pays exactly
     that, so 12.809,16 € arrives as three transfers and no rule could see any
     of them.

     Only a payment that names one bill outright qualifies, and only for what
     that bill still has owing. Without the number this would be guesswork —
     any payment smaller than any bill would "fit". */
  const instalmentMatches: InstalmentMatch[] = [];
  try {
    const grossOf = new Map<string, number>(bills.map(b => [b.id as string, Number(b.gross_amount)]));
    const settledSoFar = new Map<string, number>();
    for (const r of linkRows) {
      const part = typeof r.amount === 'number' ? r.amount : grossOf.get(r.bill_id as string);
      if (part === undefined) continue;
      settledSoFar.set(r.bill_id as string, (settledSoFar.get(r.bill_id as string) ?? 0) + part);
    }
    for (const r of linkedRows) {
      if (!r.bill_id) continue;
      const g = grossOf.get(r.bill_id as string);
      if (g !== undefined) settledSoFar.set(r.bill_id as string, (settledSoFar.get(r.bill_id as string) ?? 0) + g);
    }

    const alreadyProposed = new Set<string>([
      ...matches.map(m => m.txId),
      ...referenceMatches.map(m => m.txId),
    ]);
    const takenThisRun = new Map<string, number>();

    for (const tx of txs) {
      if (alreadyProposed.has(tx.id) || multiLinkedTx.has(tx.id)) continue;
      const text = `${tx.counterparty ?? ''} ${tx.description ?? ''}`;
      const paid = Math.abs(tx.amount_cents) / 100;
      const owedOn = (b: { id: string; gross_amount: number }) => {
        const before = (settledSoFar.get(b.id) ?? 0) + (takenThisRun.get(b.id) ?? 0);
        return { before, owing: Math.round((Number(b.gross_amount) - before) * 100) / 100 };
      };

      const named = bills.filter(b => quotes(text, b.invoice_number) && sameSupplier(tx, b));
      let bill: typeof bills[number] | null = null;

      if (named.length === 1) {
        bill = named[0];
      } else if (named.length === 0) {
        /* The closing instalment, whose reference went astray. Perola's third
           payment quotes "Rechnung Nr. 157001", an invoice that exists
           nowhere, while 4.309,16 € is to the cent what invoice 161077 still
           had owing.

           Allowed only where there is no guesswork left: the supplier has
           exactly one bill part-paid already, and the payment is exactly what
           that bill still owes. A part-paid bill means an instalment plan is
           already running and recorded — this closes one rather than inventing
           one, which is why an unnamed payment can be trusted here and nowhere
           else. */
        const partPaid = bills.filter(b => {
          if (!definitelySameSupplier(tx, b)) return false;
          const { before, owing } = owedOn(b);
          return before > 0.01 && owing > 0.01;
        });
        const exact = partPaid.filter(b => Math.abs(owedOn(b).owing - paid) < 0.01);
        if (partPaid.length !== 1 || exact.length !== 1) continue;
        bill = exact[0];
      } else {
        continue;                                  // several named: not an instalment
      }

      const gross = Number(bill.gross_amount);
      if (!(gross > 0)) continue;
      if (paid >= gross - 0.01) continue;          // settles the lot: not an instalment

      const { before, owing } = owedOn(bill);
      if (owing <= 0.01) continue;                 // nothing left on it
      if (paid > owing + 0.01) continue;           // more than is owed: not this bill

      takenThisRun.set(bill.id, (takenThisRun.get(bill.id) ?? 0) + paid);
      instalmentMatches.push({
        txId: tx.id, txDate: tx.date, txCounterparty: tx.counterparty,
        txAmountCents: tx.amount_cents,
        billId: bill.id, invoiceNumber: bill.invoice_number, invoiceDate: bill.invoice_date,
        supplier: bill.supplier_name, billGross: gross,
        alreadyPaid: Math.round(before * 100) / 100,
        remaining: Math.round((owing - paid) * 100) / 100,
      });
    }
  } catch (e) {
    console.error('[auto-match] instalment pass failed (non-fatal):', e);
  }

  /* ── Customers paying the invoices we issued ──
     Until now matching only ever looked at money going out, so not one
     incoming payment was ever tied to an outgoing invoice. Customers quote the
     invoice number — "133-26", "Rech.Nr.106-26/15.6.2026", "Rg 123-26, 122-26"
     — which is the strongest evidence there is, and the amount usually agrees
     to the cent. */
  const outgoingMatches: OutgoingMatch[] = [];
  try {
    const obs = await fetchAll((page, size) =>
      admin.from('outgoing_bills')
        .select('id, invoice_number, invoice_date, customer_name, total_payable')
        .order('invoice_date', { ascending: false })
        .range(page * size, (page + 1) * size - 1)
    );
    const inTxs = await fetchAll((page, size) =>
      admin.from('cashflow_transactions')
        .select('id, date, counterparty, description, amount_cents')
        .eq('direction', 'in')
        .is('outgoing_bill_id', null)
        .order('date', { ascending: false })
        .range(page * size, (page + 1) * size - 1)
    );
    const claimedObs = await fetchAll((page, size) =>
      admin.from('cashflow_transactions')
        .select('outgoing_bill_id')
        .not('outgoing_bill_id', 'is', null)
        .range(page * size, (page + 1) * size - 1)
    );
    const spokenFor = new Set(claimedObs.map(r => r.outgoing_bill_id as string));
    const freeObs = obs.filter(b => !spokenFor.has(b.id));

    /* "133-26" is short, so it only counts standing on its own — not as the
       tail of "1133-26" nor the head of "133-260". */
    const quotesInvoice = (text: string, no: string | null) => {
      const n = (no ?? '').trim();
      if (n.length < 4) return false;
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, 'i').test(text);
    };
    /* A customer's bank name and the name on our invoice rarely match word for
       word ("MOBIS PARTS EUROPE N.V." against "Mobis Parts Europe N.V. –
       Zweigniederlassung"), so a shared distinctive word is enough. */
    const sameCustomer = (tx: { counterparty: string | null }, b: { customer_name: string | null }) => {
      const a = (tx.counterparty ?? '').toLowerCase();
      const words = (b.customer_name ?? '').toLowerCase().split(/[^a-zà-ÿ0-9]+/).filter(w => w.length > 3);
      return words.some(w => a.includes(w));
    };

    const usedObs = new Set<string>();
    const usedTx = new Set<string>();

    /* 1. The customer named the invoice. */
    for (const tx of inTxs) {
      if (usedTx.has(tx.id)) continue;
      const text = `${tx.description ?? ''} ${tx.counterparty ?? ''}`;
      const named = freeObs.filter(b => !usedObs.has(b.id) && quotesInvoice(text, b.invoice_number));
      if (named.length !== 1) continue;   // several invoices on one payment needs a person
      const b = named[0];
      const paid = Math.abs(tx.amount_cents) / 100;
      const delta = Math.round((paid - Number(b.total_payable)) * 100) / 100;
      outgoingMatches.push({
        txId: tx.id, txDate: tx.date, txCounterparty: tx.counterparty, txAmountCents: tx.amount_cents,
        billId: b.id, invoiceNumber: b.invoice_number, invoiceDate: b.invoice_date,
        customerName: b.customer_name, totalPayable: Number(b.total_payable),
        via: 'invoice', delta,
        confident: Math.abs(delta) <= 0.01,
        note: Math.abs(delta) <= 0.01 ? null
          : `Paid ${delta > 0 ? 'over' : 'under'} by ${Math.abs(delta).toFixed(2)} € — the customer names this invoice but did not pay its amount.`,
      });
      usedObs.add(b.id);
      usedTx.add(tx.id);
    }

    /* 2. No number quoted: the amount and the customer must both be unique. */
    for (const tx of inTxs) {
      if (usedTx.has(tx.id)) continue;
      const paid = Math.abs(tx.amount_cents);
      const fitsOb = (b: (typeof freeObs)[number]) =>
        !usedObs.has(b.id) &&
        Math.round(Number(b.total_payable) * 100) === paid &&
        !!b.invoice_date && new Date(tx.date) >= new Date(b.invoice_date) &&
        sameCustomer(tx, b);
      const cands = freeObs.filter(fitsOb);
      if (cands.length !== 1) continue;
      const b = cands[0];
      const rivals = inTxs.filter(o => o.id !== tx.id && !usedTx.has(o.id) && fitsOb(b) &&
        Math.abs(o.amount_cents) === paid && sameCustomer(o, b));
      if (rivals.length > 0) continue;
      outgoingMatches.push({
        txId: tx.id, txDate: tx.date, txCounterparty: tx.counterparty, txAmountCents: tx.amount_cents,
        billId: b.id, invoiceNumber: b.invoice_number, invoiceDate: b.invoice_date,
        customerName: b.customer_name, totalPayable: Number(b.total_payable),
        via: 'amount', delta: 0, confident: false,
        note: 'The amount and the customer agree, but no invoice number was quoted — worth a glance.',
      });
      usedObs.add(b.id);
      usedTx.add(tx.id);
    }
  } catch (e) {
    console.error('[auto-match] outgoing-invoice pass failed (non-fatal):', e);
  }

  /* ── Links already in the database that the rules above would refuse ──
     The vetoes read backwards. Most of these were made before the reference
     rule could see "RE 65221", and each one does double harm: the payment is
     wrong, and the bill it wrongly holds is marked paid, so the payment that
     really did settle it reports the invoice as missing. */
  const suspectLinks: SuspectLink[] = [];
  try {
    const linkedTxs = await fetchAll((page, size) =>
      admin.from('cashflow_transactions')
        .select('id, date, description, counterparty, amount_cents, bill:bills(id, supplier_name, invoice_number, invoice_date, gross_amount)')
        .not('bill_id', 'is', null)
        .order('date', { ascending: false })
        .range(page * size, (page + 1) * size - 1)
    );
    for (const tx of linkedTxs) {
      const bill = tx.bill as { id: string; supplier_name: string; invoice_number: string | null; invoice_date: string | null; gross_amount: number } | null;
      if (!bill) continue;
      const objection = linkObjection(tx, bill);
      if (!objection) continue;
      suspectLinks.push({
        txId: tx.id, txDate: tx.date, txDescription: tx.description,
        txCounterparty: tx.counterparty, txAmountCents: tx.amount_cents,
        billId: bill.id, billSupplier: bill.supplier_name,
        billInvoiceNo: bill.invoice_number, billInvoiceDate: bill.invoice_date,
        billGross: Number(bill.gross_amount),
        code: objection.code, reason: objection.reason,
      });
    }
  } catch (e) {
    console.error('[auto-match] link audit failed (non-fatal):', e);
  }

  if (!apply) return NextResponse.json({ matches, woltMatches: [...woltMatches, ...lieferandoMatches], referenceMatches, instalmentMatches, outgoingMatches, suspectLinks });

  // 5. Apply matches
  const errors: string[] = [];
  const applyBills = picked(matches);
  const applyWolt = picked(woltMatches);
  const applyLieferando = picked(lieferandoMatches);
  const applyReference = picked(referenceMatches);
  const applyOutgoing = picked(outgoingMatches);
  const applyInstalments = picked(instalmentMatches);

  for (const m of applyBills) {
    // One transfer for several bills is recorded as links, the way the Cash Flow page does it
    const { error } = m.bills.length > 1
      ? await admin.from('transaction_bill_links').upsert(
          m.bills.map(b => ({ transaction_id: m.txId, bill_id: b.id, note: 'Auto-matched by invoice numbers in the transfer' })),
          { onConflict: 'transaction_id,bill_id', ignoreDuplicates: true })
      : await admin.from('cashflow_transactions').update({ bill_id: m.billId }).eq('id', m.txId).is('bill_id', null);
    if (error) errors.push(error.message);
    else await markBillsPaid(admin, m.bills.map(b => b.id));
  }

  for (const w of applyWolt) {
    const { error } = await admin
      .from('cashflow_transactions')
      .update({ wolt_period_id: w.periodId })
      .eq('id', w.txId);
    if (error) errors.push(error.message);
  }
  for (const l of applyLieferando) {
    const { error } = await admin
      .from('cashflow_transactions')
      .update({ lieferando_period_id: l.periodId })
      .eq('id', l.txId);
    if (error) errors.push(error.message);
  }

  /* One payment, many invoices: the link table carries those, and the note
     records what the bank said so a gap stays visible afterwards. */
  let appliedReference = 0;
  for (const r of applyReference) {
    const note = `${r.bills.length} Rechnung${r.bills.length === 1 ? '' : 'en'} laut Verwendungszweck`
      + (r.toppingUp ? ' (nachgetragen)' : '')
      + (r.complete ? '' : ` · ${r.sum.toFixed(2)} € von ${(Math.abs(r.txAmountCents) / 100).toFixed(2)} €`)
      + (r.missing.length ? ` · nicht im System: ${r.missing.join(', ')}` : '')
      + (r.taken.length ? ` · bereits anderweitig zugeordnet: ${r.taken.map(t => t.invoiceNumber ?? '—').join(', ')}` : '');
    const { error } = await admin.from('transaction_bill_links').insert(
      r.bills.map(b => ({ transaction_id: r.txId, bill_id: b.id, note })),
    );
    if (error) { errors.push(error.message); continue; }
    /* Topping up closes the gap the earlier links recorded, so their note is
       brought up to date too — otherwise the row keeps claiming a shortfall
       that has just been filled. */
    if (r.toppingUp && r.complete) {
      await admin.from('transaction_bill_links')
        .update({ note })
        .eq('transaction_id', r.txId);
    }
    // A collected invoice is paid, whatever anyone does next.
    await admin.from('bills').update({ status: 'paid' }).in('id', r.bills.map(b => b.id));
    appliedReference++;
  }

  /* An instalment: the link carries the part it settles, and the bill only
     counts as paid once the parts add up to it. */
  let appliedInstalments = 0;
  for (const i of applyInstalments) {
    const note = `Teilzahlung ${(Math.abs(i.txAmountCents) / 100).toFixed(2)} € von ${i.billGross.toFixed(2)} €`
      + (i.remaining > 0.01 ? ` · offen ${i.remaining.toFixed(2)} €` : ' · vollständig beglichen');
    const { error } = await admin.from('transaction_bill_links').insert({
      transaction_id: i.txId, bill_id: i.billId, note,
      amount: Math.abs(i.txAmountCents) / 100,
    });
    if (error) { errors.push(error.message); continue; }
    if (i.remaining <= 0.01) {
      await admin.from('bills').update({ status: 'paid' }).eq('id', i.billId);
    }
    appliedInstalments++;
  }

  /* A customer's payment against an invoice we issued. Mirrors what the Cash
     Flow page does by hand: the credit points at the invoice, and the invoice
     stops being pending. */
  let appliedOutgoing = 0;
  for (const o of applyOutgoing) {
    const { error } = await admin
      .from('cashflow_transactions')
      .update({ outgoing_bill_id: o.billId })
      .eq('id', o.txId);
    if (error) { errors.push(error.message); continue; }
    await admin.from('outgoing_bills').update({ status: 'paid' }).eq('id', o.billId).eq('status', 'pending');
    appliedOutgoing++;
  }

  return NextResponse.json({
    applied: applyBills.length,
    appliedWolt: applyWolt.length + applyLieferando.length,
    appliedReference,
    appliedInstalments,
    appliedOutgoing,
    errors,
  });
}
