import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

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

// POST { apply: false } → preview; POST { apply: true } → apply
export async function POST(req: NextRequest) {
  const { apply } = await req.json();
  const admin = getSupabaseAdmin();

  // 1. Fetch all unlinked cost transactions
  const { data: txs, error: txErr } = await admin
    .from('cashflow_transactions')
    .select('id, date, counterparty, amount_cents, direction')
    .is('bill_id', null)
    .eq('direction', 'out');
  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });

  // 2. Fetch all bills not yet linked to a transaction
  const { data: linkedRows } = await admin
    .from('cashflow_transactions')
    .select('bill_id')
    .not('bill_id', 'is', null);
  const linkedBillIds = new Set((linkedRows ?? []).map(r => r.bill_id as string));

  const { data: bills, error: billErr } = await admin
    .from('bills')
    .select('id, supplier_name, invoice_number, invoice_date, gross_amount');
  if (billErr) return NextResponse.json({ error: billErr.message }, { status: 500 });

  const availableBills = (bills ?? []).filter(b => !linkedBillIds.has(b.id));

  // 3. Fetch counterparties for keyword matching
  const { data: cps } = await admin
    .from('counterparties')
    .select('name, keywords');
  const counterparties = cps ?? [];

  // Resolve raw bank name → supplier name using keyword matching
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

  for (const tx of txs ?? []) {
    const txGross = Math.abs(tx.amount_cents) / 100;
    const txDate  = new Date(tx.date);
    const resolvedSupplier = matchedSupplier(tx.counterparty);

    const candidates = availableBills.filter(b => {
      if (usedBillIds.has(b.id)) return false;
      // Amount must match exactly (within 1 cent rounding)
      if (Math.abs(b.gross_amount - txGross) > 0.01) return false;
      // Supplier must match counterparty keywords
      const bLower = b.supplier_name.toLowerCase();
      if (resolvedSupplier) {
        if (!bLower.includes(resolvedSupplier) && !resolvedSupplier.includes(bLower)) return false;
      } else {
        // No counterparty mapping — try direct partial match
        const txLower = tx.counterparty.toLowerCase();
        if (!bLower.split(' ').some((w: string) => w.length > 3 && txLower.includes(w))) return false;
      }
      // Date within 45 days
      if (!b.invoice_date) return false;
      const diff = Math.abs((new Date(b.invoice_date).getTime() - txDate.getTime()) / 86400000);
      return diff <= 45;
    });

    if (candidates.length === 0) continue;

    // Pick closest date
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

  if (!apply) return NextResponse.json({ matches });

  // 5. Apply matches
  const errors: string[] = [];
  for (const m of matches) {
    const { error } = await admin
      .from('cashflow_transactions')
      .update({ bill_id: m.billId })
      .eq('id', m.txId);
    if (error) errors.push(error.message);
  }

  return NextResponse.json({ applied: matches.length, errors });
}
