import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type WoltMatch = {
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
};

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
  try {
    txs = await fetchAll((page, size) =>
      admin.from('cashflow_transactions')
        .select('id, date, counterparty, amount_cents, direction')
        .is('bill_id', null)
        .eq('direction', 'out')
        .order('date', { ascending: false })
        .range(page * size, (page + 1) * size - 1)
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

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

  const linkedBillIds = new Set(linkedRows.map(r => r.bill_id as string));
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

  // 4. Match each transaction to a bill
  const matches: Match[] = [];
  const usedBillIds = new Set<string>();

  for (const tx of txs) {
    const txGross = Math.abs(tx.amount_cents) / 100;
    const txDate  = new Date(tx.date);
    const resolvedSupplier = matchedSupplier(tx.counterparty);

    const candidates = availableBills.filter(b => {
      if (usedBillIds.has(b.id)) return false;
      if (Math.abs(b.gross_amount - txGross) > 0.01) return false;
      const bLower = b.supplier_name.toLowerCase();
      if (resolvedSupplier) {
        if (!bLower.includes(resolvedSupplier) && !resolvedSupplier.includes(bLower)) return false;
      } else {
        const txLower = tx.counterparty.toLowerCase();
        if (!bLower.split(' ').some((w: string) => w.length > 3 && txLower.includes(w))) return false;
      }
      if (!b.invoice_date) return false;
      const diff = Math.abs((new Date(b.invoice_date).getTime() - txDate.getTime()) / 86400000);
      return diff <= 45;
    });

    if (candidates.length === 0) continue;

    const best = candidates.reduce((a, b) => {
      const da = Math.abs(new Date(a.invoice_date!).getTime() - txDate.getTime());
      const db = Math.abs(new Date(b.invoice_date!).getTime() - txDate.getTime());
      return da <= db ? a : b;
    });

    const daysDiff = Math.round(Math.abs(new Date(best.invoice_date!).getTime() - txDate.getTime()) / 86400000);

    matches.push({
      txId:            tx.id,
      txDate:          tx.date,
      txCounterparty:  tx.counterparty,
      txAmountCents:   tx.amount_cents,
      billId:          best.id,
      billSupplier:    best.supplier_name,
      billInvoiceNo:   best.invoice_number,
      billInvoiceDate: best.invoice_date,
      billGross:       best.gross_amount,
      daysDiff,
    });
    usedBillIds.add(best.id);
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

  if (!apply) return NextResponse.json({ matches, woltMatches });

  // 5. Apply matches
  const errors: string[] = [];
  for (const m of matches) {
    const { error } = await admin
      .from('cashflow_transactions')
      .update({ bill_id: m.billId })
      .eq('id', m.txId);
    if (error) errors.push(error.message);
  }

  for (const w of woltMatches) {
    const { error } = await admin
      .from('cashflow_transactions')
      .update({ wolt_period_id: w.periodId })
      .eq('id', w.txId);
    if (error) errors.push(error.message);
  }

  return NextResponse.json({ applied: matches.length, appliedWolt: woltMatches.length, errors });
}
