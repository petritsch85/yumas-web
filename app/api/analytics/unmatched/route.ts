import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

async function fetchAll(buildQuery: (from: number, to: number) => any): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await buildQuery(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    page++;
  }
  return all;
}

export async function GET() {
  const admin = getSupabaseAdmin();

  // Unmatched cash flows: no bill_id AND no entry in transaction_bill_links
  const [allTxs, linkedTxIds, unmatchedBills] = await Promise.all([
    fetchAll((from, to) =>
      admin.from('cashflow_transactions')
        .select('id, date, description, counterparty, amount_cents, direction, category, location, counterparty_id, bill_id')
        .is('bill_id', null)
        .order('date', { ascending: false })
        .range(from, to)
    ),
    fetchAll((from, to) =>
      admin.from('transaction_bill_links')
        .select('transaction_id')
        .range(from, to)
    ),
    fetchAll((from, to) =>
      admin.from('bills')
        .select('id, supplier_name, invoice_number, invoice_date, gross_amount, net_amount, status, location')
        .order('invoice_date', { ascending: false })
        .range(from, to)
    ),
  ]);

  // Tx IDs that have at least one junction link
  const junctionLinkedTxIds = new Set(linkedTxIds.map((r: any) => r.transaction_id));

  // Cash flows with no bill_id AND no junction link
  const unmatchedTxs = allTxs.filter((tx: any) => !junctionLinkedTxIds.has(tx.id));

  // For bills: find which bill IDs are referenced in cashflow_transactions.bill_id or transaction_bill_links
  const [linkedBillIdRows, junctionBillIdRows] = await Promise.all([
    fetchAll((from, to) =>
      admin.from('cashflow_transactions')
        .select('bill_id')
        .not('bill_id', 'is', null)
        .range(from, to)
    ),
    fetchAll((from, to) =>
      admin.from('transaction_bill_links')
        .select('bill_id')
        .range(from, to)
    ),
  ]);

  const linkedBillIds = new Set([
    ...linkedBillIdRows.map((r: any) => r.bill_id),
    ...junctionBillIdRows.map((r: any) => r.bill_id),
  ]);

  const unmatchedBillsFiltered = unmatchedBills.filter((b: any) => !linkedBillIds.has(b.id));

  return NextResponse.json({
    unmatchedCashFlows: unmatchedTxs,
    unmatchedBills: unmatchedBillsFiltered,
  });
}
