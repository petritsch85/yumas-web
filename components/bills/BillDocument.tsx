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
  invoiceNumber    : string;
  date             : string;    // DD.MM.YYYY  — invoice date
  eventDate?       : string;    // DD.MM.YYYY  — date of the event
  issuingLocation? : string;    // 'Westend' | 'Eschborn' | 'Taunus'
  type             : 'monthly' | 'dinner';
  recipient        : {
    company  : string;
    extra?   : string;
    contact? : string;
    street   : string;
    postcode : string;
    city     : string;
    poNumber?: string;
    att?     : string;
  };
  introText       : string;
  // Type A – monthly orders
  lineItems?      : LineItem[];
  // Type B – dinner / event
  essenBrutto?    : number;
  getraenkeBrutto?: number;
  mwstEssenPct?   : number;   // e.g. 7
  mwstGetraenkePct?: number;  // e.g. 19
  essenNetto?     : number;
  getraenkeNetto? : number;
  trinkgeld?      : number;
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
  const tip = data.trinkgeld ?? 0;

  // Monthly
  let gesamtNetto  = 0;
  let mwst7monthly = 0;
  let bruttoMonthly = 0;

  // Dinner – use passed-in values; fall back to deriving from netto if brutto not provided
  const mwstEssenRate     = (data.mwstEssenPct    ?? 7)  / 100;
  const mwstGetraenkeRate = (data.mwstGetraenkePct ?? 19) / 100;
  const essenBrutto       = data.essenBrutto     ?? (data.essenNetto     ?? 0) * (1 + mwstEssenRate);
  const getraenkeBrutto   = data.getraenkeBrutto ?? (data.getraenkeNetto ?? 0) * (1 + mwstGetraenkeRate);
  const gesamtBrutto      = essenBrutto + getraenkeBrutto;
  const essenNetto        = data.essenNetto     ?? essenBrutto     / (1 + mwstEssenRate);
  const getraenkeNetto    = data.getraenkeNetto ?? getraenkeBrutto / (1 + mwstGetraenkeRate);
  const gesamtNettoD      = essenNetto + getraenkeNetto;
  const mwstEssenAmt      = essenBrutto     - essenNetto;
  const mwstGetraenkeAmt  = getraenkeBrutto - getraenkeNetto;
  const mwstGesamtAmt     = mwstEssenAmt + mwstGetraenkeAmt;
  const gesamtBetrag      = isMonthly ? 0 : gesamtBrutto + tip;

  if (isMonthly && data.lineItems) {
    gesamtNetto   = data.lineItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    mwst7monthly  = gesamtNetto * 0.07;
    bruttoMonthly = gesamtNetto + mwst7monthly;
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
            {/* Group 1: Brutto split */}
            <View style={s.groupGap}>
              <AmtRow label="Essen Brutto (€)"    value={essenBrutto} />
              <AmtRow label="Getränke Brutto (€)" value={getraenkeBrutto} />
              <AmtRow label="Gesamt Brutto (€)"   value={gesamtBrutto} />
            </View>

            {/* Group 2: MwSt */}
            <View style={s.groupGap}>
              <AmtRow label={`Mwst Essen (${data.mwstEssenPct ?? 7}%)`}    value={mwstEssenAmt} />
              <AmtRow label={`Mwst Getränke (${data.mwstGetraenkePct ?? 19}%)`} value={mwstGetraenkeAmt} />
              <AmtRow label="Mwst Gesamt"                                   value={mwstGesamtAmt} />
            </View>

            {/* Group 3: Netto split */}
            <View style={s.groupGap}>
              <AmtRow label="Essen Netto (€)"    value={essenNetto} />
              <AmtRow label="Getränke Netto (€)" value={getraenkeNetto} />
              <AmtRow label="Gesamt Netto (€)"   value={gesamtNettoD} />
            </View>

            {/* Group 4: Trinkgeld (only if > 0) */}
            {tip > 0 && (
              <View style={s.groupGap}>
                <AmtRow label="Trinkgeld (€)" value={tip} />
              </View>
            )}

            {/* Final: Gesamtbetrag */}
            <AmtRow label="Gesamtbetrag (€, zu zahlen)" value={gesamtBetrag} />
          </View>
        )}

        {/* ── TYPE A totals ────────────────────────────────────────── */}
        {isMonthly && (
          <View style={{ marginTop: 6 }}>
            <View style={s.groupGap}>
              <AmtRow label="Gesamt Netto" value={gesamtNetto} />
            </View>
            <View style={s.groupGap}>
              <AmtRow label="Mwst 7%" value={mwst7monthly} />
            </View>
            <AmtRow label="Gesamtbetrag (zu zahlen)" value={bruttoMonthly} />
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
