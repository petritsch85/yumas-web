/**
 * Pluxee's monthly Gutschriftsanzeige, and the bank credit it explains.
 *
 * Pluxee pays out the vouchers we hand in, less its fees. The document's one
 * row reads paid-out amount, pickup fee, VAT, handling fee, admin fee, two
 * further fees, then the document number and the vouchers' face value — and
 * the row proves itself: face value less all deductions is the payout.
 *
 * A credit is matched on the amount to the cent, and a date close to the
 * document's. Nothing is guessed: no candidate, or several, is reported.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PluxeeStatement {
  number: string;
  /** Leistungsdatum, ISO. Decides the month: Pluxee's own "08-26" reference follows it. */
  serviceDate: string;
  documentDate: string;
  faceValue: number;
  payout: number;
  /** Deductions before VAT; the 19 % VAT on them is reclaimable. */
  feesNet: number;
  vat: number;
  balanced: boolean;
}

const MONEY = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;
const toNumber = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const iso = (d?: string) => (d ? d.split('.').reverse().join('-') : '');

export function parsePluxeeStatement(text: string): PluxeeStatement | null {
  const row = text.match(/([^\n]*?)\d{6}-\d{3}\s+(\d{7})\s+([\d.]+,\d{2})/);
  if (!row) return null;
  const amounts = (row[1].match(MONEY) ?? []).map(toNumber);
  if (amounts.length < 3) return null;
  const [payout, ...deductions] = amounts;
  const faceValue = toNumber(row[3]);
  const round = (n: number) => Math.round(n * 100) / 100;
  const total = round(deductions.reduce((s, n) => s + Math.abs(n), 0));
  const vat = Math.abs(deductions[1] ?? 0);
  return {
    number: row[2],
    serviceDate: iso(text.match(/Leistungsdatum:\s*(\d{2}\.\d{2}\.\d{4})/)?.[1]),
    documentDate: iso(text.match(/(\d{2}\.\d{2}\.\d{4})\s*Belegdatum/)?.[1]),
    faceValue, payout, vat,
    feesNet: round(total - vat),
    balanced: Math.abs(faceValue - total - payout) < 0.005,
  };
}

const plusDays = (d: string, n: number) => {
  const t = new Date(d + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** Ties the statement to its bank credit. Returns what happened, for the upload's answer. */
export async function linkPluxeeStatement(
  admin: SupabaseClient, documentId: string, st: PluxeeStatement,
): Promise<'linked' | 'already' | 'not found' | 'ambiguous'> {
  const { data } = await admin.from('cashflow_transactions')
    .select('id, statement_document_id')
    .eq('direction', 'in')
    .ilike('counterparty', '%pluxee%')
    .eq('amount_cents', Math.round(st.payout * 100))
    .gte('date', plusDays(st.documentDate, -10))
    .lte('date', plusDays(st.documentDate, 5));
  const rows = data ?? [];
  if (rows.length === 1 && rows[0].statement_document_id === documentId) return 'already';
  const free = rows.filter(r => !r.statement_document_id);
  if (free.length === 0) return 'not found';
  if (free.length > 1) return 'ambiguous';
  const { error } = await admin.from('cashflow_transactions')
    .update({ statement_document_id: documentId }).eq('id', free[0].id);
  if (error) throw new Error(error.message);
  return 'linked';
}
