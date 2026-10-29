import type { SupabaseClient } from '@supabase/supabase-js';
import { extractText, getDocumentProxy } from 'unpdf';
import { monthRange, monthLabel } from '@/lib/month-folder';
import { woltDocType, woltStore, parseWoltDoc, type WoltDocFigures } from '@/lib/wolt-docs';
import { renderWoltSummary, type WoltSummaryRow } from '@/lib/wolt-summary-pdf';

/**
 * The one-page Wolt summary per restaurant, read from the month's own Wolt PDFs.
 *
 * Every document of a period is read — the netting report too, for the payout
 * and the Wolt Capital it deducted, although it is not printed. A period is
 * keyed by the number Wolt puts in the file name (…_2026_54.pdf), which all
 * four documents of one period share. The bank date is the Wolt credit of
 * exactly the payout amount after the period ended; left blank when there is
 * none, or more than one.
 */
export async function woltSummaries(admin: SupabaseClient, month: string): Promise<{ store: string; bytes: Uint8Array }[]> {
  const { from, to } = monthRange(month);
  const { data } = await admin.from('month_documents')
    .select('filename,file_path,bucket').eq('kind', 'wolt').eq('month', from);
  const pdfs = (data ?? []).filter(d => !/\.zip$/i.test(d.filename as string));
  if (!pdfs.length) return [];

  const periods = new Map<string, { store: string; docs: WoltDocFigures[] }>();
  for (const d of pdfs) {
    const type = woltDocType(d.filename as string);
    if (type === 'sales_report' || type === 'other') continue;
    try {
      const { data: f } = await admin.storage.from((d.bucket as string) || 'cashflow-files').download(d.file_path as string);
      if (!f) continue;
      const { text } = await extractText(await getDocumentProxy(new Uint8Array(await f.arrayBuffer())), { mergePages: true });
      const fig = parseWoltDoc(type, String(text));
      const store = woltStore(d.filename as string);
      const no = (d.filename as string).match(/_(\d+)\.pdf$/i)?.[1] ?? fig.periodFrom ?? d.filename;
      const key = `${store}|${no}`;
      const p = periods.get(key) ?? { store, docs: [] };
      p.docs.push(fig);
      periods.set(key, p);
    } catch { /* an unreadable document is still in the folder; it just has no row */ }
  }

  /* Wolt's credits in the month and a fortnight after, for the bank date. */
  const end = new Date(to + 'T12:00:00Z'); end.setUTCDate(end.getUTCDate() + 15);
  const { data: credits } = await admin.from('cashflow_transactions')
    .select('id,date,amount_cents').eq('direction', 'in').ilike('counterparty', '%wolt%')
    .gte('date', from).lte('date', end.toISOString().slice(0, 10)).order('date');
  const used = new Set<string>();
  const de = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

  const byStore = new Map<string, (WoltSummaryRow & { sort: string })[]>();
  for (const { store, docs } of periods.values()) {
    const sales = docs.find(x => x.type === 'self_billing') ?? docs.find(x => x.type === 'payout_report');
    const fee = docs.find(x => x.type === 'fee_invoice');
    const net = docs.find(x => x.type === 'netting_report') ?? docs.find(x => x.type === 'payout_report');
    const pf = sales?.periodFrom ?? fee?.periodFrom ?? null;
    const pt = sales?.periodTo ?? fee?.periodTo ?? null;
    const payout = net?.payout ?? null;
    let bankDate: string | null = null;
    if (payout !== null && pt) {
      const hits = (credits ?? []).filter(c => !used.has(String(c.id))
        && Number(c.amount_cents) === Math.round(payout * 100) && String(c.date) >= pt);
      if (hits.length >= 1) { used.add(String(hits[0].id)); bankDate = de(String(hits[0].date)); }
    }
    const feeSplit = Object.values(fee?.split ?? {});
    const row = {
      sort: pf ?? '9999',
      period: pf && pt ? `${de(pf).slice(0, 6)} – ${de(pt)}` : '—',
      salesDoc: sales?.type === 'self_billing' ? (sales.invoiceNumber ?? '—') : sales ? 'Auszahlungsbericht' : '—',
      feeDoc: fee?.invoiceNumber ?? null,
      sales: sales?.split ?? {},
      fees: { net: feeSplit.reduce((t, v) => t + v.net, 0), vat: feeSplit.reduce((t, v) => t + v.vat, 0) },
      capital: net?.capital ?? null,
      payout,
      bankDate,
    };
    byStore.set(store, [...(byStore.get(store) ?? []), row]);
  }

  const out: { store: string; bytes: Uint8Array }[] = [];
  for (const [store, rows] of [...byStore.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.sort((a, b) => a.sort.localeCompare(b.sort));
    out.push({ store, bytes: await renderWoltSummary(store, monthLabel(month), rows) });
  }
  return out;
}

