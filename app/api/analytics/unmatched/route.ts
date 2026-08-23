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
  try {
    const admin = getSupabaseAdmin();

    // 1. Get all transaction IDs that have a junction-table link (fast — small table)
    const junctionLinks = await fetchAll((from, to) =>
      admin.from('transaction_bill_links').select('transaction_id, bill_id').range(from, to)
    );
    const junctionTxIds  = new Set(junctionLinks.map((r: any) => r.transaction_id));
    const junctionBillIds = new Set(junctionLinks.map((r: any) => r.bill_id));

    // 2. Get all cash flows with no direct bill_id
    const nullBillTxs = await fetchAll((from, to) =>
      admin.from('cashflow_transactions')
        .select('id, date, description, counterparty, amount_cents, direction, category, location, counterparty_id')
        .is('bill_id', null)
        .order('date', { ascending: false })
        .range(from, to)
    );

    // Unmatched = no direct bill_id AND no junction link
    const unmatchedCashFlows = nullBillTxs.filter((tx: any) => !junctionTxIds.has(tx.id));

    // 3. Get all bill_ids referenced directly in cashflow_transactions
    const directLinkedRows = await fetchAll((from, to) =>
      admin.from('cashflow_transactions')
        .select('bill_id')
        .not('bill_id', 'is', null)
        .range(from, to)
    );
    const directLinkedBillIds = new Set(directLinkedRows.map((r: any) => r.bill_id));

    // 4. Fetch all bills
    const allBills = await fetchAll((from, to) =>
      admin.from('bills')
        .select('id, supplier_name, invoice_number, invoice_date, gross_amount, net_amount, status, location_label, category')
        .order('invoice_date', { ascending: false })
        .range(from, to)
    );

    // Unmatched bills = not referenced by any cash flow (direct or junction)
    const unmatchedBills = allBills.filter((b: any) =>
      !directLinkedBillIds.has(b.id) && !junctionBillIds.has(b.id)
    );

    return NextResponse.json({ unmatchedCashFlows, unmatchedBills });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
