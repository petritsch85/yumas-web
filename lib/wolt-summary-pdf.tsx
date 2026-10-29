import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import type { Style } from '@react-pdf/types';

/**
 * One page per restaurant: the month's Wolt periods side by side.
 *
 * Goes at the front of the Wolt section of the folder, so the Steuerberater
 * can check the month in one sheet — sales VAT from the self-billing invoices
 * (or Eschborn's Auszahlungsbericht), input VAT from Wolt's fee invoices, and
 * the payout each period ended in. It takes the place of the netting reports,
 * which say the same thing over twelve pages and are no Rechnung.
 */

export interface WoltSummaryRow {
  period: string;            // "16.09. – 20.09.2026"
  salesDoc: string;          // invoice number, or "Auszahlungsbericht"
  feeDoc: string | null;
  sales: Record<string, { net: number; vat: number }>;
  fees: { net: number; vat: number };
  capital: number | null;
  payout: number | null;
  bankDate: string | null;   // "23.09.2026"
}

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 7.5, fontFamily: 'Helvetica', color: '#111827' },
  h1: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sub: { fontSize: 8, color: '#6b7280', marginBottom: 12 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb', paddingVertical: 3 },
  head: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#111827', paddingBottom: 3, fontFamily: 'Helvetica-Bold' },
  total: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#111827', paddingTop: 3, fontFamily: 'Helvetica-Bold' },
  note: { marginTop: 12, fontSize: 7, color: '#6b7280', lineHeight: 1.4 },
});

const COLS: { label: string; w: number; right?: boolean }[] = [
  { label: 'Leistungszeitraum', w: 78 },
  { label: 'Umsatzbeleg', w: 92 },
  { label: 'Netto 7 %', w: 48, right: true },
  { label: 'USt 7 %', w: 40, right: true },
  { label: 'Netto 19 %', w: 46, right: true },
  { label: 'USt 19 %', w: 40, right: true },
  { label: 'Netto 0 %', w: 40, right: true },
  { label: 'Wolt-Rechnung', w: 92 },
  { label: 'Gebühr netto', w: 58, right: true },
  { label: 'Vorsteuer', w: 42, right: true },
  { label: 'Wolt Capital', w: 48, right: true },
  { label: 'Auszahlung', w: 50, right: true },
  { label: 'Bankeingang', w: 52, right: true },
];

const eur = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function cells(values: string[], style: Style) {
  return (
    <View style={style}>
      {values.map((v, i) => (
        <Text key={i} style={{ width: COLS[i].w, textAlign: COLS[i].right ? 'right' : 'left', paddingRight: 4 }}>{v}</Text>
      ))}
    </View>
  );
}

export async function renderWoltSummary(store: string, month: string, rows: WoltSummaryRow[]): Promise<Uint8Array> {
  const r = (x: WoltSummaryRow, k: string) => x.sales[k] ?? { net: 0, vat: 0 };
  const sum = (f: (x: WoltSummaryRow) => number | null) => rows.reduce((t, x) => t + (f(x) ?? 0), 0);

  const doc = (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.h1}>Wolt — Zusammenfassung {month} · Yumas {store}</Text>
        <Text style={s.sub}>Yumas GmbH · Feuerbachstr. 46 · 60325 Frankfurt am Main · alle Beträge in EUR</Text>
        {cells(COLS.map(c => c.label), s.head)}
        {rows.map((x, i) => (
          <View key={i}>
            {cells([
              x.period, x.salesDoc,
              eur(r(x, '7').net), eur(r(x, '7').vat), eur(r(x, '19').net), eur(r(x, '19').vat), eur(r(x, '0').net),
              x.feeDoc ?? '—', eur(x.fees.net), eur(x.fees.vat), eur(x.capital), eur(x.payout), x.bankDate ?? '—',
            ], s.row)}
          </View>
        ))}
        {cells([
          'Summe', '',
          eur(sum(x => r(x, '7').net)), eur(sum(x => r(x, '7').vat)), eur(sum(x => r(x, '19').net)),
          eur(sum(x => r(x, '19').vat)), eur(sum(x => r(x, '0').net)),
          '', eur(sum(x => x.fees.net)), eur(sum(x => x.fees.vat)),
          eur(sum(x => x.capital)), eur(sum(x => x.payout)), '',
        ], s.total)}
        <Text style={s.note}>
          Umsätze aus den Selbstfakturierungen (§ 14 Abs. 2 Satz 4 UStG){store === 'Eschborn' ? ' bzw. aus dem Wolt-Auszahlungsbericht, da Wolt für Eschborn keine Selbstfakturierung ausstellt' : ''};
          Gebühren und Vorsteuer aus den Rechnungen der Wolt Enterprises Deutschland GmbH. Die Rechnungen liegen
          hinter diesem Blatt. Netting- und Umsatzberichte (Einzelbestellungen) enthalten keine weiteren
          Steuerangaben; sie sind digital gespeichert und werden auf Anfrage nachgereicht.
          Bankeingang: Gutschrift von Wolt in Höhe der Auszahlung im Kontoauszug, wo eindeutig zuzuordnen.
        </Text>
      </Page>
    </Document>
  );
  return new Uint8Array(await renderToBuffer(doc));
}

/**
 * The same sheet for any platform, from plain columns and rows — Lieferando's
 * weekly statements have different figures from Wolt's, but the page is the
 * same idea: one line per statement, totals underneath, a note on what is
 * behind it and what was left out.
 */
export async function renderPlatformSummary({ title, columns, rows, note }: {
  title: string;
  columns: { label: string; w: number; right?: boolean; sum?: boolean }[];
  rows: (string | number | null)[][];
  note: string;
}): Promise<Uint8Array> {
  const show = (v: string | number | null) => typeof v === 'number' ? eur(v) : v ?? '—';
  const line = (values: string[], style: Style) => (
    <View style={style}>
      {values.map((v, i) => (
        <Text key={i} style={{ width: columns[i].w, textAlign: columns[i].right ? 'right' : 'left', paddingRight: 4 }}>{v}</Text>
      ))}
    </View>
  );
  const totals = columns.map((c, i) => i === 0 ? 'Summe'
    : c.sum ? eur(rows.reduce((t, r) => t + (typeof r[i] === 'number' ? (r[i] as number) : 0), 0)) : '');

  const doc = (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.h1}>{title}</Text>
        <Text style={s.sub}>Yumas GmbH · Feuerbachstr. 46 · 60325 Frankfurt am Main · alle Beträge in EUR</Text>
        {line(columns.map(c => c.label), s.head)}
        {rows.map((r, i) => <View key={i}>{line(r.map(show), s.row)}</View>)}
        {line(totals, s.total)}
        <Text style={s.note}>{note}</Text>
      </Page>
    </Document>
  );
  return new Uint8Array(await renderToBuffer(doc));
}
