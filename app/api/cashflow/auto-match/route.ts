import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { markBillsPaid } from '@/lib/bill-payment-status';

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

/* A payment that names an invoice ("RNR 171503", "Re-Nr. 4711", "Rechnung
   12345") is about that invoice. Matching it to a different bill of the same
   amount would be a guess, so such a payment only matches by number. */
const REFERENCE = /\b(?:rnr|re\.?\s*-?\s*nr|rg\.?\s*-?\s*nr|rechnung(?:snummer|s-?nr)?|invoice|inv)\.?\s*:?\s*[a-z]*[-/]?\d{4,}/i;

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
  const { apply } = await req.json();
  const admin = getSupabaseAdmin();

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
        .select('transaction_id, bill_id')
        .order('id')
        .range(page * size, (page + 1) * size - 1)
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
  const multiLinkedTx = new Set(linkRows.map(r => r.transaction_id as string));
  txs = txs.filter(t => !multiLinkedTx.has(t.id));

  // 2. Fetch ALL bills and all linked bill_ids (paginated)
  let linkedRows: any[];
  let bills: any[];
  try {
    linkedRows = await fetchAll((page, size) =>
      admin.from('cashflow_transactions')
        .select('bill_id')
        .not('bill_id', 'is', null)
        .range(page * size, (page + 1) * size - 1)
    );
    bills = await fetchAll((page, size) =>
      admin.from('bills')
        .select('id, supplier_name, invoice_number, invoice_date, gross_amount')
        .order('invoice_date', { ascending: false })
        .range(page * size, (page + 1) * size - 1)
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  const linkedBillIds = new Set([
    ...linkedRows.map(r => r.bill_id as string),
    ...linkRows.map(r => r.bill_id as string),
  ]);
  const availableBills = bills.filter(b => !linkedBillIds.has(b.id));

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

  /** Whether a bill's supplier is the party the bank paid. */
  function sameSupplier(tx: any, b: any): boolean {
    const resolvedSupplier = matchedSupplier(tx.counterparty ?? '');
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
    const txLower = (tx.counterparty ?? '').toLowerCase();
    return bLower.split(' ').some((w: string) => w.length > 3 && txLower.includes(w));
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

  /* 4a. By invoice number. The bank quotes it, the supplier is the same, and
     the money agrees to the cent — one bill for the whole amount, or every
     quoted bill together (an invoice net of a credit note) for the whole
     amount. Nothing partial, nothing approximate. */
  for (const tx of txs) {
    const text = `${tx.counterparty ?? ''} ${tx.description ?? ''}`;
    const quoted = availableBills.filter(b => !usedBillIds.has(b.id) && quotes(text, b.invoice_number) && sameSupplier(tx, b));
    if (quoted.length === 0) continue;
    const paid = Math.abs(tx.amount_cents);
    if (quoted.length === 1) {
      if (cents(quoted[0].gross_amount) === paid) push(tx, quoted, 'invoice');
    } else if (quoted.reduce((s, b) => s + cents(b.gross_amount), 0) === paid) {
      push(tx, quoted, 'invoice');
    }
  }

  /* 4b. By amount, supplier and date — only where it cannot be anything else:
     the amount agrees to the cent, exactly one bill fits the payment, and no
     other payment fits that bill. Two bills of the same amount (a monthly
     subscription) are left for a person rather than decided by the nearer
     date. A payment naming an invoice is left out: it was matched above, or
     the invoice it names is not on file. */
  const fits = (tx: any, b: any) =>
    cents(b.gross_amount) === Math.abs(tx.amount_cents) &&
    !!b.invoice_date && days(b.invoice_date, tx.date) <= 45 &&
    sameSupplier(tx, b);

  const open = txs.filter(tx => !usedTxIds.has(tx.id) && !REFERENCE.test(`${tx.counterparty ?? ''} ${tx.description ?? ''}`));
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

  if (!apply) return NextResponse.json({ matches, woltMatches: [...woltMatches, ...lieferandoMatches] });

  // 5. Apply matches
  const errors: string[] = [];
  for (const m of matches) {
    // One transfer for several bills is recorded as links, the way the Cash Flow page does it
    const { error } = m.bills.length > 1
      ? await admin.from('transaction_bill_links').upsert(
          m.bills.map(b => ({ transaction_id: m.txId, bill_id: b.id, note: 'Auto-matched by invoice numbers in the transfer' })),
          { onConflict: 'transaction_id,bill_id', ignoreDuplicates: true })
      : await admin.from('cashflow_transactions').update({ bill_id: m.billId }).eq('id', m.txId).is('bill_id', null);
    if (error) errors.push(error.message);
    else await markBillsPaid(admin, m.bills.map(b => b.id));
  }

  for (const w of woltMatches) {
    const { error } = await admin
      .from('cashflow_transactions')
      .update({ wolt_period_id: w.periodId })
      .eq('id', w.txId);
    if (error) errors.push(error.message);
  }
  for (const l of lieferandoMatches) {
    const { error } = await admin
      .from('cashflow_transactions')
      .update({ lieferando_period_id: l.periodId })
      .eq('id', l.txId);
    if (error) errors.push(error.message);
  }

  return NextResponse.json({ applied: matches.length, appliedWolt: woltMatches.length + lieferandoMatches.length, errors });
}
