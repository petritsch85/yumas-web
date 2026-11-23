/**
 * Filing an Amex statement that arrived by email straight into the month-end
 * folder.
 *
 * American Express sends one Akzeptanzpartner statement per merchant number
 * each month. The email import read them as invoices — the service fee plus
 * VAT looks exactly like one — and filed October's three as bills, where they
 * would have counted the fee twice and sat as payables nobody owes. They are
 * statements: evidence for the bank's Amex credits and the source of the
 * P&L's Amex fee. So a PDF that reads as one is filed under the month-end
 * Amex position of the month it covers, exactly as an upload there would be.
 *
 * The payouts are linked now if the bank statement is already in, and again
 * each night (relinkAmexStatements) for those that arrive before it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractText, getDocumentProxy } from 'unpdf';
import { parseAmexStatement, type AmexStatement } from './amex-statement';
import { linkAmexStatement, replaceSameMerchant } from './amex-import';

async function readStatement(bytes: Uint8Array): Promise<AmexStatement | null> {
  try {
    const { text } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true });
    if (!/AKZEPTANZPARTNER/i.test(String(text))) return null;
    return parseAmexStatement(String(text));
  } catch {
    return null;
  }
}

/** Files `bytes` as an Amex statement if it is one; null when it is not. */
export async function fileAmexStatement(
  admin: SupabaseClient, bytes: Uint8Array, fileName: string,
): Promise<{ month: string; merchant: string; fees: number; linked: number; unmatched: string[] } | null> {
  const st = await readStatement(bytes);
  if (!st?.periodStart) return null;
  const month = st.periodStart.slice(0, 7);

  const filename = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `monatsabschluss/${month}/amex_${Date.now()}_${filename}`;
  const up = await admin.storage.from('cashflow-files').upload(path, bytes, { contentType: 'application/pdf' });
  if (up.error) throw new Error(`Amex statement upload failed: ${up.error.message}`);

  const { error } = await admin.from('month_documents').upsert({
    kind: 'amex', month: `${month}-01`, filename, file_path: path,
    bucket: 'cashflow-files', byte_size: bytes.length, fees: st.feesNet,
  }, { onConflict: 'kind,month,filename' });
  if (error) throw new Error(error.message);

  const { data: saved } = await admin.from('month_documents').select('id')
    .eq('kind', 'amex').eq('month', `${month}-01`).eq('filename', filename).single();
  await replaceSameMerchant(admin, saved!.id as string, st, month);
  const r = await linkAmexStatement(admin, saved!.id as string, st);
  return { month, merchant: st.merchantNumber, fees: st.feesNet, linked: r.linked + r.already, unmatched: r.unmatched };
}

/**
 * Links the payouts of recent Amex statements that were filed before the
 * bank statement showing them. Payouts already linked are left as they are.
 */
export async function relinkAmexStatements(admin: SupabaseClient, monthsBack = 3): Promise<number> {
  const from = new Date();
  from.setMonth(from.getMonth() - monthsBack);
  const { data } = await admin.from('month_documents').select('id,file_path,bucket')
    .eq('kind', 'amex').gte('month', from.toISOString().slice(0, 7) + '-01');
  let linked = 0;
  for (const d of data ?? []) {
    const { data: file } = await admin.storage.from((d.bucket as string) || 'cashflow-files').download(d.file_path as string);
    if (!file) continue;
    const st = await readStatement(new Uint8Array(await file.arrayBuffer()));
    if (!st) continue;
    linked += (await linkAmexStatement(admin, d.id as string, st)).linked;
  }
  return linked;
}
