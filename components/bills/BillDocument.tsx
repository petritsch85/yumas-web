import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';

// ── Fixed sender details ──────────────────────────────────────────────────────
const SENDER_LINE = 'Yumas GmbH · Feuerbachstraße 46 · 60325 Frankfurt /M';
const FOOTER_1    = 'Yumas GmbH │ Feuerbachstraße 46 │ 60325 Frankfurt';
const FOOTER_2    = 'Sparkasse Rhein-Nahe │ IBAN DE98 5605 0180 0017 1489 25 │ Steuernummer: 014 249 10458';
const PAYMENT     = 'Die Rechnung ist zahlbar innerhalb von 7 Tagen nach Rechnungseingang.';

// ── Types ─────────────────────────────────────────────────────────────────────
export type LineItem = { qty: number; item: string; unitPrice: number };

export type BillData = {
  invoiceNumber : string;
  date          : string;          // DD.MM.YYYY
  recipient     : {
    company     : string;
    extra?      : string;          // e.g. "Zweigniederlassung Deutschland"
    contact?    : string;          // contact name on its own line
    street      : string;
    postcode    : string;
    city        : string;
    poNumber?   : string;
    att?        : string;
  };
  introText     : string;
  type          : 'monthly' | 'dinner';
  // Type A – monthly
  lineItems?    : LineItem[];
  // Type B – dinner
  essenNetto?   : number;
  getraenkeNetto?: number;
  trinkgeld?    : number;
};

// ── German number formatter ───────────────────────────────────────────────────
const fmt = (n: number) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: {
    fontFamily   : 'Helvetica',
    fontSize     : 10,
    paddingTop   : 45,
    paddingBottom: 55,
    paddingLeft  : 55,
    paddingRight : 55,
    color        : '#111',
  },

  // Return-address line (tiny, underlined, above recipient block)
  returnLine: {
    fontSize          : 7,
    color             : '#555',
    borderBottomWidth : 0.5,
    borderBottomColor : '#999',
    paddingBottom     : 2,
    marginBottom      : 6,
  },

  // Recipient block
  recipient     : { fontSize: 10, lineHeight: 1.5, marginBottom: 28 },
  recipientBold : { fontFamily: 'Helvetica-Bold' },

  // Meta (date + invoice) — right-aligned block
  metaContainer : { alignItems: 'flex-end', marginBottom: 22 },
  metaRow       : { flexDirection: 'row', gap: 6, marginBottom: 2 },
  metaLabel     : { fontSize: 10, color: '#555', width: 110, textAlign: 'right' },
  metaValue     : { fontSize: 10, width: 100, textAlign: 'right' },

  // PO / Att block (left-aligned, appears below recipient)
  optionalMeta  : { marginBottom: 14, lineHeight: 1.5 },

  // Intro paragraph
  intro         : { lineHeight: 1.5, marginBottom: 16 },

  // ── Type A table ─────────────────────────────────────────────────────────
  tableHeaderRow: {
    flexDirection   : 'row',
    borderBottomWidth: 0.75,
    borderBottomColor: '#333',
    paddingBottom   : 4,
    marginBottom    : 4,
    fontFamily      : 'Helvetica-Bold',
  },
  tableRow : { flexDirection: 'row', marginBottom: 2.5 },
  colQty   : { width: 34, textAlign: 'right', paddingRight: 6 },
  colItem  : { flex: 1 },
  colUnit  : { width: 80, textAlign: 'right' },
  colTotal : { width: 72, textAlign: 'right' },

  // ── Totals section ───────────────────────────────────────────────────────
  totalsWrap  : { alignItems: 'flex-end', marginTop: 14 },
  totalRow    : { flexDirection: 'row', width: 230, justifyContent: 'space-between', marginBottom: 2 },
  totalBold   : {
    flexDirection   : 'row',
    width           : 230,
    justifyContent  : 'space-between',
    marginBottom    : 2,
    fontFamily      : 'Helvetica-Bold',
  },
  divider     : { width: 230, borderTopWidth: 0.5, borderTopColor: '#555', marginVertical: 3 },

  // Sign-off
  signOff     : { marginTop: 24 },

  // Footer (fixed at bottom of every page)
  footer      : {
    position    : 'absolute',
    bottom      : 20,
    left        : 55,
    right       : 55,
    borderTopWidth : 0.5,
    borderTopColor : '#aaa',
    paddingTop  : 5,
  },
  footerText  : { fontSize: 7.5, color: '#666', textAlign: 'center', lineHeight: 1.6 },
});

// ── PDF Component ─────────────────────────────────────────────────────────────
export function BillDocument({ data }: { data: BillData }) {
  // Derived calculations
  const isMonthly = data.type === 'monthly';

  let gesamtNetto   = 0;
  let mwst7         = 0;
  let mwst19        = 0;
  let brutto        = 0;
  let gesamtBetrag  = 0;

  if (isMonthly && data.lineItems) {
    gesamtNetto  = data.lineItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    mwst7        = gesamtNetto * 0.07;
    brutto       = gesamtNetto + mwst7;
    gesamtBetrag = brutto;
  } else {
    const essen     = data.essenNetto     ?? 0;
    const getraenke = data.getraenkeNetto ?? 0;
    gesamtNetto  = essen + getraenke;
    mwst7        = essen * 0.07;
    mwst19       = getraenke * 0.19;
    brutto       = gesamtNetto + mwst7 + mwst19;
    gesamtBetrag = brutto + (data.trinkgeld ?? 0);
  }

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* Return-address line */}
        <Text style={s.returnLine}>{SENDER_LINE}</Text>

        {/* Recipient block */}
        <View style={s.recipient}>
          <Text style={s.recipientBold}>{data.recipient.company}</Text>
          {data.recipient.extra   && <Text>{data.recipient.extra}</Text>}
          {data.recipient.contact && <Text>{data.recipient.contact}</Text>}
          <Text>{data.recipient.street}</Text>
          <Text>{data.recipient.postcode} {data.recipient.city}</Text>
        </View>

        {/* Date + Invoice number (right-aligned) */}
        <View style={s.metaContainer}>
          <View style={s.metaRow}>
            <Text style={s.metaLabel}>Frankfurt, den</Text>
            <Text style={s.metaValue}>{data.date}</Text>
          </View>
          <View style={s.metaRow}>
            <Text style={s.metaLabel}>Rechnungsnummer</Text>
            <Text style={s.metaValue}>{data.invoiceNumber}</Text>
          </View>
        </View>

        {/* Optional PO / Att */}
        {(data.recipient.poNumber || data.recipient.att) && (
          <View style={s.optionalMeta}>
            {data.recipient.poNumber && <Text>PO {data.recipient.poNumber}</Text>}
            {data.recipient.att      && <Text>Att: {data.recipient.att}</Text>}
          </View>
        )}

        {/* Intro paragraph */}
        <Text style={s.intro}>{data.introText}</Text>

        {/* ── TYPE A: line items table ───────────────────────────── */}
        {isMonthly && data.lineItems && (
          <View>
            <View style={s.tableHeaderRow}>
              <Text style={s.colQty}>Anz.</Text>
              <Text style={s.colItem}>Artikel</Text>
              <Text style={s.colUnit}>Einzelpreis</Text>
              <Text style={s.colTotal}>Gesamt</Text>
            </View>
            {data.lineItems.map((item, i) => (
              <View key={i} style={s.tableRow}>
                <Text style={s.colQty}>{item.qty}x</Text>
                <Text style={s.colItem}>{item.item}</Text>
                <Text style={s.colUnit}>à {fmt(item.unitPrice)}</Text>
                <Text style={s.colTotal}>{fmt(item.qty * item.unitPrice)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Totals ────────────────────────────────────────────── */}
        <View style={s.totalsWrap}>
          {!isMonthly && (
            <>
              <View style={s.totalRow}>
                <Text>Gesamt Essen netto</Text>
                <Text>{fmt(data.essenNetto ?? 0)}</Text>
              </View>
              <View style={s.totalRow}>
                <Text>Gesamt Getränke netto</Text>
                <Text>{fmt(data.getraenkeNetto ?? 0)}</Text>
              </View>
            </>
          )}

          <View style={s.divider} />
          <View style={s.totalRow}>
            <Text>Gesamt Netto</Text>
            <Text>{fmt(gesamtNetto)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text>Mwst (7%)</Text>
            <Text>{fmt(mwst7)}</Text>
          </View>
          {!isMonthly && (
            <View style={s.totalRow}>
              <Text>Mwst (19%)</Text>
              <Text>{fmt(mwst19)}</Text>
            </View>
          )}
          <View style={s.divider} />
          <View style={s.totalRow}>
            <Text>Brutto (inkl. Mwst)</Text>
            <Text>{fmt(brutto)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text>Gesamt Brutto</Text>
            <Text>{fmt(brutto)}</Text>
          </View>
          {!isMonthly && (data.trinkgeld ?? 0) > 0 && (
            <View style={s.totalRow}>
              <Text>Trinkgeld</Text>
              <Text>{fmt(data.trinkgeld!)}</Text>
            </View>
          )}
          <View style={s.divider} />
          <View style={s.totalBold}>
            <Text>Gesamtbetrag (zu zahlen)</Text>
            <Text>{fmt(gesamtBetrag)}</Text>
          </View>
        </View>

        {/* Payment terms + sign-off */}
        <Text style={[s.signOff, { marginTop: 20 }]}>{PAYMENT}</Text>
        <Text style={[s.signOff, { marginTop: 12 }]}>Vielen Dank!</Text>

        {/* Fixed footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>{FOOTER_1}</Text>
          <Text style={s.footerText}>{FOOTER_2}</Text>
        </View>

      </Page>
    </Document>
  );
}
