import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { YUMAS_LOGO } from './yumasLogo';

// ── Location-specific sender addresses ───────────────────────────────────────
const LOCATION_DATA: Record<string, { sender: string[]; footer1: string }> = {
  Westend: {
    sender:  ['Yumas GmbH', 'Feuerbachstraße 46', '60325 Frankfurt'],
    footer1: 'Yumas GmbH │ Feuerbachstraße 46│ 60325 Frankfurt',
  },
  Eschborn: {
    sender:  ['Yumas GmbH', 'Rahmannstraße 11', '65760 Eschborn'],
    footer1: 'Yumas GmbH │ Rahmannstraße 11│ 65760 Eschborn',
  },
  Taunus: {
    sender:  ['Yumas GmbH', 'Taunusstraße 43', '60329 Frankfurt'],
    footer1: 'Yumas GmbH │ Taunusstraße 43│ 60329 Frankfurt',
  },
};
const DEFAULT_LOCATION = LOCATION_DATA['Westend'];
const FOOTER_2 = 'Sparkasse Rhein-Nahe│ IBAN DE98 5605 0180 0017 1489 25│ Steuernummer: 014 249 10458';
const PAYMENT  = 'Die Rechnung ist zahlbar innerhalb von 7 Tagen nach Rechnungseingang.';

// ── Types ─────────────────────────────────────────────────────────────────────
export type LineItem = { qty: number; item: string; unitPrice: number };

export type BillData = {
  invoiceNumber   : string;
  date            : string;    // DD.MM.YYYY  — invoice date
  eventDate?      : string;    // DD.MM.YYYY  — date of the event
  issuingLocation?: string;    // 'Westend' | 'Eschborn' | 'Taunus'
  type            : 'monthly' | 'dinner';
  recipient       : {
    company  : string;
    extra?   : string;
    contact? : string;
    street   : string;
    postcode : string;
    city     : string;
    poNumber?: string;
    att?     : string;
  };
  introText      : string;
  // Type A – monthly orders
  lineItems?     : LineItem[];
  // Type B – dinner / event
  essenNetto?    : number;
  getraenkeNetto?: number;
  trinkgeld?     : number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: {
    fontFamily   : 'Courier',
    fontSize     : 10,
    paddingTop   : 36,
    paddingBottom: 70,
    paddingLeft  : 55,
    paddingRight : 55,
    color        : '#000',
  },

  // Header: [spacer] [logo centred] [sender address right-aligned]
  headerRow: {
    flexDirection: 'row',
    alignItems   : 'flex-start',
    marginBottom : 22,
  },
  headerSpacer: { width: 110 },
  headerLogoWrap: {
    flex       : 1,
    alignItems : 'center',
  },
  logo: { width: 88, height: 88 },
  senderBlock: {
    width     : 110,
    textAlign : 'right',
    lineHeight: 1.55,
    fontSize  : 10,
  },

  // Recipient block
  recipient: {
    lineHeight  : 1.55,
    marginBottom: 26,
  },

  // Date + invoice number — right-aligned
  metaWrap: {
    alignItems  : 'flex-end',
    marginBottom: 18,
    lineHeight  : 1.55,
  },

  // Intro paragraph
  intro: { lineHeight: 1.55, marginBottom: 16 },

  // Amount rows — label left, value right
  amountRow: {
    flexDirection : 'row',
    justifyContent: 'space-between',
    marginBottom  : 1.5,
  },
  // Spacing between logical groups
  groupGap: { marginBottom: 7 },

  // Footer fixed at bottom
  footer: {
    position: 'absolute',
    bottom  : 22,
    left    : 55,
    right   : 55,
  },
  footerText: { fontSize: 9, textAlign: 'center', lineHeight: 1.55 },
});

// ── Amount row helper ─────────────────────────────────────────────────────────
function AmtRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.amountRow}>
      <Text>{label}</Text>
      <Text>{fmt(value)}</Text>
    </View>
  );
}

// ── PDF Component ─────────────────────────────────────────────────────────────
export function BillDocument({ data }: { data: BillData }) {
  const isMonthly = data.type === 'monthly';
  const loc = (data.issuingLocation && LOCATION_DATA[data.issuingLocation])
    ? LOCATION_DATA[data.issuingLocation]
    : DEFAULT_LOCATION;

  // Derived totals
  const essen     = data.essenNetto     ?? 0;
  const getraenke = data.getraenkeNetto ?? 0;
  const tip       = data.trinkgeld      ?? 0;

  let gesamtNetto  = 0;
  let mwst7        = 0;
  let mwst19       = 0;
  let brutto       = 0;
  let gesamtBetrag = 0;

  if (isMonthly && data.lineItems) {
    gesamtNetto  = data.lineItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    mwst7        = gesamtNetto * 0.07;
    brutto       = gesamtNetto + mwst7;
    gesamtBetrag = brutto;
  } else {
    gesamtNetto  = essen + getraenke;
    mwst7        = essen * 0.07;
    mwst19       = getraenke * 0.19;
    brutto       = gesamtNetto + mwst7 + mwst19;
    gesamtBetrag = brutto + tip;
  }

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── Header: logo + sender ────────────────────────────────── */}
        <View style={s.headerRow}>
          <View style={s.headerSpacer} />
          <View style={s.headerLogoWrap}>
            <Image style={s.logo} src={YUMAS_LOGO} />
          </View>
          <View style={s.senderBlock}>
            {loc.sender.map((line) => <Text key={line}>{line}</Text>)}
          </View>
        </View>

        {/* ── Recipient ────────────────────────────────────────────── */}
        <View style={s.recipient}>
          <Text>{data.recipient.company}</Text>
          {data.recipient.extra   && <Text>{data.recipient.extra}</Text>}
          {data.recipient.contact && <Text>{data.recipient.contact}</Text>}
          <Text>{data.recipient.street}</Text>
          <Text>{data.recipient.postcode} {data.recipient.city}</Text>
        </View>

        {/* ── Date + invoice number ────────────────────────────────── */}
        <View style={s.metaWrap}>
          <Text>Frankfurt, den {data.date}</Text>
          <Text>Rechnungsnummer {data.invoiceNumber}</Text>
        </View>

        {/* ── Optional PO / Att ────────────────────────────────────── */}
        {(data.recipient.poNumber || data.recipient.att) && (
          <View style={{ marginBottom: 12, lineHeight: 1.55 }}>
            {data.recipient.poNumber && <Text>PO {data.recipient.poNumber}</Text>}
            {data.recipient.att      && <Text>Att: {data.recipient.att}</Text>}
          </View>
        )}

        {/* ── Intro text ───────────────────────────────────────────── */}
        <Text style={s.intro}>{data.introText}</Text>

        {/* ── TYPE A: line items table ─────────────────────────────── */}
        {isMonthly && data.lineItems && (
          <View style={{ marginBottom: 10 }}>
            <View style={[s.amountRow, {
              borderBottomWidth: 0.5,
              borderBottomColor: '#000',
              paddingBottom: 3,
              marginBottom: 4,
            }]}>
              <Text style={{ width: 28 }}>Anz.</Text>
              <Text style={{ flex: 1 }}>Artikel</Text>
              <Text style={{ width: 85, textAlign: 'right' }}>Einzelpreis</Text>
              <Text style={{ width: 75, textAlign: 'right' }}>Gesamt</Text>
            </View>
            {data.lineItems.map((item, i) => (
              <View key={i} style={s.amountRow}>
                <Text style={{ width: 28 }}>{item.qty}x</Text>
                <Text style={{ flex: 1 }}>{item.item}</Text>
                <Text style={{ width: 85, textAlign: 'right' }}>à {fmt(item.unitPrice)}</Text>
                <Text style={{ width: 75, textAlign: 'right' }}>{fmt(item.qty * item.unitPrice)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── TYPE B: dinner amounts ───────────────────────────────── */}
        {!isMonthly && (
          <View>
            {/* Group 1: Essen + Getränke netto */}
            <View style={s.groupGap}>
              <AmtRow label="Gesamt Essen netto"    value={essen} />
              <AmtRow label="Gesamt Getränke netto" value={getraenke} />
            </View>

            {/* Group 2: Gesamt Netto */}
            <View style={s.groupGap}>
              <AmtRow label="Gesamt Netto" value={gesamtNetto} />
            </View>

            {/* Group 3: MwSt */}
            <View style={s.groupGap}>
              <AmtRow label="Mwst 7%"  value={mwst7} />
              <AmtRow label="Mwst 19%" value={mwst19} />
            </View>

            {/* Group 4: Brutto */}
            <View style={s.groupGap}>
              <AmtRow label="Brutto (19% Mwst)" value={brutto} />
              <AmtRow label="Gesamt Brutto"      value={brutto} />
            </View>

            {/* Group 5: Trinkgeld (only if > 0) */}
            {tip > 0 && (
              <View style={s.groupGap}>
                <AmtRow label="Trinkgeld" value={tip} />
              </View>
            )}

            {/* Final: Gesamtbetrag */}
            <AmtRow label="Gesamtbetrag (zu zahlen)" value={gesamtBetrag} />
          </View>
        )}

        {/* ── TYPE A totals ────────────────────────────────────────── */}
        {isMonthly && (
          <View style={{ marginTop: 6 }}>
            <View style={s.groupGap}>
              <AmtRow label="Gesamt Netto" value={gesamtNetto} />
            </View>
            <View style={s.groupGap}>
              <AmtRow label="Mwst 7%" value={mwst7} />
            </View>
            <AmtRow label="Gesamtbetrag (zu zahlen)" value={gesamtBetrag} />
          </View>
        )}

        {/* ── Payment terms ─────────────────────────────────────────── */}
        <Text style={{ marginTop: 20, lineHeight: 1.55 }}>{PAYMENT}</Text>

        {/* ── Vielen Dank! ──────────────────────────────────────────── */}
        <Text style={{ marginTop: 18, textAlign: 'center' }}>Vielen Dank!</Text>

        {/* ── Footer (fixed at bottom of every page) ───────────────── */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>{loc.footer1}</Text>
          <Text style={s.footerText}>{FOOTER_2}</Text>
        </View>

      </Page>
    </Document>
  );
}
