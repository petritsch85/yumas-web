import type { getSupabaseAdmin } from '@/lib/supabase-admin';

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Fills in `amount` on bill links, where the column exists.
 *
 * It is fetched separately rather than named in the main select, because a
 * select naming a column the database does not have fails outright — and that
 * select is the one carrying every transaction on the page. Asking for it in
 * line once took the whole Cash Flow list down between the deploy and the
 * migration being run. Here the worst case is that links keep their old
 * meaning, the whole bill, which is exactly what they meant before.
 */
export async function attachLinkAmounts(
  admin: Admin,
  rows: { transaction_bill_links?: { id: string; amount?: number | null }[] | null }[],
): Promise<void> {
  const ids = rows.flatMap(r => (r.transaction_bill_links ?? []).map(l => l.id)).filter(Boolean);
  if (ids.length === 0) return;

  try {
    const amounts = new Map<string, number | null>();
    const PAGE = 500;
    for (let i = 0; i < ids.length; i += PAGE) {
      const { data, error } = await admin
        .from('transaction_bill_links')
        .select('id, amount')
        .in('id', ids.slice(i, i + PAGE));
      if (error) return;   // column not there yet: links stay whole-bill
      for (const r of data ?? []) amounts.set(r.id as string, (r as { amount?: number | null }).amount ?? null);
    }
    for (const r of rows) {
      for (const l of r.transaction_bill_links ?? []) {
        if (amounts.has(l.id)) l.amount = amounts.get(l.id) ?? null;
      }
    }
  } catch {
    // Same again: a missing column must never cost us the transaction list.
  }
}
