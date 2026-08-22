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

/** Fetch ALL rows from a query that may exceed Supabase's 1000-row cap */
async function fetchAll(admin: ReturnType<typeof import('@/lib/supabase-admin').getSupabaseAdmin>, table: string, query: (q: any) => any): Promise<any[]> {
  const PAGE = 1000;
  let page = 0;
  const all: any[] = [];
  while (true) {
    const { data, error } = await query(
      admin.from(table).range(page * PAGE, (page + 1) * PAGE - 1)
    );
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
    txs = await fetchAll(admin, 'cashflow_transactions', (q) =>
      q.select('id, date, counterparty, amount_cents, direction')
       .is('bill_id', null)
       .eq('direction', 'out')
       .order('date', { ascending: false })
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  // 2. Fetch ALL bills and all linked bill_ids (paginated)
  let linkedRows: any[];
  let bills: any[];
  try {
    linkedRows = await fetchAll(admin, 'cashflow_transactions', (q) =>
      q.select('bill_id').not('bill_id', 'is', null)
    );
    bills = await fetchAll(admin, 'bills', (q) =>
      q.select('id, supplier_name, invoice_number, invoice_date, gross_amount')
       .order('invoice_date', { ascending: false })
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
