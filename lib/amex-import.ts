/**
 * Tying an Amex statement to the bank payments it evidences.
 *
 * Each payout on the statement arrives in the bank as one credit whose
 * narrative names the merchant number — "American Express/VU7041786070/…" —
 * so a payout is matched on three things at once: that number, the amount to
 * the cent, and a date within a few days of the payout date. Three merchant
 * accounts pay the same bank account, often similar sums on the same day, and
 * the number is what keeps them apart.
 *
 * Nothing is guessed: a payout with no candidate, or more than one, is left
 * and reported. The statement's net fee is stored for the P&L's payment fee
 * line; Amex charges 19 % VAT on its service fee, which is reclaimable, so the
 * net is the cost.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractText, getDocumentProxy } from 'unpdf';
import { parseAmexStatement, type AmexStatement } from './amex-statement';

const plusDays = (d: string, n: number) => {
  const t = new Date(d + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/**
 * One statement per merchant number and month.
 *
 * Files in this position are told apart by name, so September's statement
 * uploaded a second time under another name sat beside the first, and its fee
 * counted twice in the P&L. An older copy for the same merchant now gives way
 * to the new one, and hands over the bank credits tied to it.
 */
export async function replaceSameMerchant(
  admin: SupabaseClient, documentId: string, st: AmexStatement, month: string,
): Promise<string[]> {
  const { data } = await admin.from('month_documents')
    .select('id, filename, file_path, bucket').eq('kind', 'amex').eq('month', `${month}-01`).neq('id', documentId);
  const replaced: string[] = [];
  for (const old of data ?? []) {
    const bucket = (old.bucket as string) || 'cashflow-files';
    const { data: file } = await admin.storage.from(bucket).download(old.file_path as string);
    if (!file) continue;
    let merchant: string | null = null;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: true });
      merchant = parseAmexStatement(String(text)).merchantNumber;
    } catch { /* one that cannot be read cannot be said to be the same: it stays */ }
    if (!merchant || merchant !== st.merchantNumber) continue;

    const { error: moved } = await admin.from('cashflow_transactions')
      .update({ statement_document_id: documentId }).eq('statement_document_id', old.id as string);
    if (moved) throw new Error(moved.message);
    const { error } = await admin.from('month_documents').delete().eq('id', old.id as string);
    if (error) throw new Error(error.message);
    await admin.storage.from(bucket).remove([old.file_path as string]);
    replaced.push(old.filename as string);
  }
  return replaced;
}

export async function linkAmexStatement(
  admin: SupabaseClient, documentId: string, st: AmexStatement,
): Promise<{ linked: number; already: number; unmatched: string[] }> {
  await admin.from('month_documents').update({ fees: st.feesNet }).eq('id', documentId);

  let linked = 0, already = 0;
  const unmatched: string[] = [];
  for (const p of st.payouts) {
    const { data } = await admin.from('cashflow_transactions')
      .select('id, statement_document_id')
      .eq('direction', 'in')
      .ilike('counterparty', '%american express%')
      .ilike('description', `%VU${st.merchantNumber}%`)
      .eq('amount_cents', Math.round(p.payout * 100))
      .gte('date', plusDays(p.date, -1))
      .lte('date', plusDays(p.date, 4));
    const rows = data ?? [];
    if (rows.length === 1 && rows[0].statement_document_id === documentId) { already++; continue; }
    const free = rows.filter(r => !r.statement_document_id);
    if (free.length !== 1) {
      unmatched.push(`${p.date} ${p.payout.toFixed(2)} € (${free.length ? 'mehrdeutig' : 'nicht im Kontoauszug'})`);
      continue;
    }
    const { error } = await admin.from('cashflow_transactions')
      .update({ statement_document_id: documentId }).eq('id', free[0].id);
    if (error) unmatched.push(`${p.date} ${p.payout.toFixed(2)} €: ${error.message}`);
    else linked++;
  }
  return { linked, already, unmatched };
}
