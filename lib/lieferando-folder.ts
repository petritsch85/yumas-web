import type { SupabaseClient } from '@supabase/supabase-js';
import { extractText, getDocumentProxy } from 'unpdf';
import { PDFDocument } from 'pdf-lib';
import { monthRange, monthLabel } from '@/lib/month-folder';
import { parseLieferandoStatement } from '@/lib/lieferando-statement';
import { renderPlatformSummary } from '@/lib/wolt-summary-pdf';

/**
 * The Lieferando part of the folder: page one of each weekly statement, and a
 * summary page per restaurant in front of them.
 *
 * Lieferando sends one PDF per restaurant and week, three pages each. Only the
 * first is a Rechnung — its fees with 19 % VAT, the week's turnover and what
 * was set off against it. The second lists every order and the third every
 * tip; neither carries a tax figure. So page one is cut out and printed, and
 * the full PDF stays stored here.
 */
export async function lieferandoFolder(admin: SupabaseClient, month: string): Promise<{ name: string; bytes: Uint8Array }[]> {
  const { from, to } = monthRange(month);
  const { data } = await admin.from('month_documents')
    .select('filename,file_path,bucket').eq('kind', 'lieferando').eq('month', from);

  type Row = { store: string; start: string; end: string; invoice: string; orders: number;
    turnover: number; feesNet: number; feesVat: number; invoiceGross: number; payout: number | null; page1: Uint8Array; filename: string };
  const rows: Row[] = [];
  const unread: { name: string; bytes: Uint8Array }[] = [];

  for (const d of data ?? []) {
    const { data: f } = await admin.storage.from((d.bucket as string) || 'cashflow-files').download(d.file_path as string);
    if (!f) continue;
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      const { text } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true });
      const st = parseLieferandoStatement(String(text));
      const src = await PDFDocument.load(bytes);
      const one = await PDFDocument.create();
      const [p] = await one.copyPages(src, [0]);
      one.addPage(p);
      rows.push({
        store: st.restaurant.replace(/^Yumas\s+/i, '').replace(/\s*\(\d+\)$/, '').trim() || 'Restaurant',
        start: st.periodStart, end: st.periodEnd, invoice: st.invoiceNumber, orders: st.orderCount,
        turnover: st.orderValueGross, feesNet: st.feesNet, feesVat: st.feesVat, invoiceGross: st.invoiceGross,
        payout: st.payout, page1: await one.save(), filename: d.filename as string,
      });
    } catch {
      /* Not readable as a statement: it goes in whole rather than not at all. */
      unread.push({ name: `nicht_gelesen/${d.filename}`, bytes });
    }
  }

  /* Bank date: Lieferando's credit names the payout and the restaurant number. */
  const end = new Date(to + 'T12:00:00Z'); end.setUTCDate(end.getUTCDate() + 15);
  const { data: credits } = await admin.from('cashflow_transactions')
    .select('id,date,amount_cents').eq('direction', 'in')
    .or('counterparty.ilike.%takeaway%,counterparty.ilike.%lieferando%,counterparty.ilike.%yourdelivery%')
    .gte('date', from).lte('date', end.toISOString().slice(0, 10)).order('date');
  const used = new Set<string>();
  const de = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

  const out: { name: string; bytes: Uint8Array }[] = [];
  const stores = [...new Set(rows.map(r => r.store))].sort();
  for (const store of stores) {
    const mine = rows.filter(r => r.store === store).sort((a, b) => a.start.localeCompare(b.start));
    const lines = mine.map(r => {
      let bank: string | null = null;
      if (r.payout !== null) {
        const hit = (credits ?? []).find(c => !used.has(String(c.id))
          && Number(c.amount_cents) === Math.round(r.payout! * 100) && String(c.date) >= r.end);
        if (hit) { used.add(String(hit.id)); bank = de(String(hit.date)); }
      }
      return [
        `${de(r.start).slice(0, 6)} – ${de(r.end)}`, r.invoice, String(r.orders),
        r.turnover, r.feesNet, r.feesVat, r.invoiceGross, r.payout, bank ?? '—',
      ] as const;
    });
    out.push({
      name: `${store}/00_Zusammenfassung_Lieferando_${store}.pdf`,
      bytes: await renderPlatformSummary({
        title: `Lieferando — Zusammenfassung ${monthLabel(month)} · Yumas ${store}`,
        columns: [
          { label: 'Leistungszeitraum', w: 100 }, { label: 'Rechnung', w: 80 }, { label: 'Bestellungen', w: 60, right: true },
          { label: 'Umsatz brutto', w: 75, right: true, sum: true }, { label: 'Gebühren netto', w: 75, right: true, sum: true },
          { label: 'MwSt 19 %', w: 60, right: true, sum: true }, { label: 'Rechnung brutto', w: 75, right: true, sum: true },
          { label: 'Auszahlung', w: 75, right: true, sum: true }, { label: 'Bankeingang', w: 70, right: true },
        ],
        rows: lines.map(l => [...l]),
        note: 'Gebühren und Vorsteuer aus den Rechnungen der yd.yourdelivery GmbH (Lieferando); hinter diesem Blatt liegt '
          + 'jeweils Seite 1 der Wochenabrechnung, die Rechnung. Die Einzelauflistung der Bestellungen und die '
          + 'Trinkgeldliste (Seiten 2–3) enthalten keine Steuerangaben; sie sind digital gespeichert und werden auf '
          + 'Anfrage nachgereicht. Bankeingang: Auszahlung von Lieferando im Kontoauszug, wo eindeutig zuzuordnen.',
      }),
    });
    for (const r of mine) out.push({ name: `${store}/${r.start}_Rechnung_${r.invoice}.pdf`, bytes: r.page1 });
  }
  return [...out, ...unread];
}
