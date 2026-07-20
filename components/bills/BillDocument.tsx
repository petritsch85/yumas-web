import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { YUMAS_LOGO_PATH } from './yumasLogo';

const YUMAS_LOGO = typeof window !== 'undefined'
  ? `${window.location.origin}${YUMAS_LOGO_PATH}`
  : YUMAS_LOGO_PATH;

// ── Company address (always shown, regardless of event location) ─────────────
const COMPANY_SENDER  = ['Yumas GmbH', 'Feuerbachstraße 46', '60325 Frankfurt'];
const FOOTER_1 = 'Yumas GmbH  ·  Feuerbachstraße 46  ·  60325 Frankfurt';
const FOOTER_2 = 'Sparkasse Rhein-Nahe  ·  IBAN DE98 5605 0180 0017 1489 25  ·  Steuernummer: 014 249 10458';
const PAYMENT  = 'Die Rechnung ist zahlbar innerhalb von 7 Tagen nach Rechnungseingang.';

// ── Types ─────────────────────────────────────────────────────────────────────
export type LineItem = { qty: number; item: string; unitPrice: number };

export type BillData = {
  invoiceNumber    : string;
  date             : string;    // DD.MM.YYYY  — invoice date
  eventDate?       : string;    // DD.MM.YYYY  — date of the event
  issuingLocation? : string;    // 'Westend' | 'Eschborn' | 'Taunus'
  type             : 'monthly' | 'dinner';
  storno?          : { originalRef: string; originalDate: string };
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
  trinkgeld?           : number;
  receiptImageDataUrl? : string;  // base64 data URL — appended as page 2 when set
  // Deductions
  anzahlungBrutto? : number;   // deposit brutto — deducted from total payable
  anzahlungNetto?  : number;   // deposit netto — shown for reference / MwSt visibility
  anzahlungVat7?   : number;   // deposit VAT 7%
  anzahlungVat19?  : number;   // deposit VAT 19%
  anzahlungRef?    : string;   // invoice number of the deposit bill
  ermaessigung?    : number;   // discount amount
  // Catering mode (mutually exclusive with essenBrutto/getraenkeBrutto)
  cateringNetto?        : number;
  cateringBrutto?       : number;
  cateringDescription?  : string;
  cateringLines?        : { description: string; amount: number }[];
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
  logo: { width: 72, height: 91 },
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
    lineHeight  : 1.15,
  },

  // Intro paragraph
  intro: { lineHeight: 1.15, marginBottom: 18 },

  // Amount rows — label left, value right
  amountRow: {
    flexDirection : 'row',
    justifyContent: 'space-between',
    marginBottom  : 2,
  },
  amountRowBold: {
    flexDirection : 'row',
    justifyContent: 'space-between',
    marginBottom  : 2,
  },
  // Spacing between logical groups
  groupGap: { marginBottom: 10 },

  // Footer fixed at bottom
  footer: {
    position: 'absolute',
    bottom  : 22,
    left    : 55,
    right   : 55,
  },
  footerText: { fontSize: 9, textAlign: 'center', lineHeight: 1.55 },
});

// ── Amount row helpers ────────────────────────────────────────────────────────
function AmtRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.amountRow}>
      <Text>{label}</Text>
      <Text>{fmt(value)}</Text>
    </View>
  );
}

function AmtRowBold({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.amountRowBold}>
      <Text style={{ fontFamily: 'Courier-Bold' }}>{label}</Text>
      <Text style={{ fontFamily: 'Courier-Bold' }}>{fmt(value)}</Text>
    </View>
  );
}

// ── PDF Component ─────────────────────────────────────────────────────────────
export function BillDocument({ data }: { data: BillData }) {
  const isMonthly = data.type === 'monthly';

  // Derived totals
  const tip = data.trinkgeld ?? 0;

  // Monthly
  let gesamtNetto  = 0;
  let mwst7monthly = 0;
  let bruttoMonthly = 0;

  // Catering mode
  const isCatering        = data.cateringNetto != null;
  const cateringNettoVal  = data.cateringNetto  ?? 0;
  const cateringBruttoVal = data.cateringBrutto ?? cateringNettoVal * 1.07;
  const cateringMwstAmt   = cateringBruttoVal - cateringNettoVal;

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
  const gesamtBetrag      = isMonthly ? 0 : isCatering ? cateringBruttoVal : gesamtBrutto + tip;

  if (isMonthly && data.lineItems) {
    gesamtNetto   = data.lineItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    mwst7monthly  = gesamtNetto * 0.07;
    bruttoMonthly = gesamtNetto + mwst7monthly;
  }

  // Deductions
  const anzBrutto   = data.anzahlungBrutto ?? 0;
  const anzNetto    = data.anzahlungNetto  ?? 0;
  const anzVat7     = data.anzahlungVat7   ?? 0;
  const anzVat19    = data.anzahlungVat19  ?? 0;
  const ermaess     = data.ermaessigung    ?? 0;
  const hasDeduct   = anzBrutto > 0 || ermaess > 0;
  const basePayable = isMonthly ? bruttoMonthly : gesamtBetrag;
  const restbetrag  = basePayable - anzBrutto - ermaess;

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
            {COMPANY_SENDER.map((line) => <Text key={line}>{line}</Text>)}
          </View>
        </View>

        {/* ── Recipient ────────────────────────────────────────────── */}
        <View style={s.recipient}>
          {[
            data.recipient.company,
            data.recipient.extra   || null,
            data.recipient.contact || null,
            data.recipient.street,
            `${data.recipient.postcode} ${data.recipient.city}`,
          ].filter(Boolean).map((line, i) => (
            <Text key={i} style={{ fontSize: 10, lineHeight: 1.3, marginBottom: 0 }}>{line as string}</Text>
          ))}
        </View>

        {/* ── Stornorechnung title (only for cancellation invoices) ── */}
        {data.storno && (
          <View style={{ marginBottom: 10 }}>
            <Text style={{ fontFamily: 'Courier-Bold', fontSize: 11 }}>
              STORNORECHNUNG der Rechnungsnummer {data.storno.originalRef}
            </Text>
          </View>
        )}

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
              <Text style={{ width: 28, fontFamily: 'Courier-Bold' }}>Anz.</Text>
              <Text style={{ flex: 1, fontFamily: 'Courier-Bold' }}>Artikel</Text>
              <Text style={{ width: 85, textAlign: 'right', fontFamily: 'Courier-Bold' }}>Einzelpreis</Text>
              <Text style={{ width: 75, textAlign: 'right', fontFamily: 'Courier-Bold' }}>Gesamt</Text>
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

        {/* ── TYPE B-catering: catering amounts ───────────────────── */}
        {!isMonthly && isCatering && (
          <View>
            {/* Event description (if provided) */}
            {data.cateringDescription && (
              <View style={[s.groupGap, { marginBottom: 14 }]}>
                <Text style={{ fontFamily: 'Courier-Bold' }}>Event Beschreibung</Text>
                <Text style={{ lineHeight: 1.4, marginTop: 3 }}>{data.cateringDescription}</Text>
              </View>
            )}

            {/* Individual line items (if provided) */}
            {data.cateringLines && data.cateringLines.length > 0 && (
              <View style={s.groupGap}>
                {data.cateringLines.map((line, i) => (
                  <AmtRow key={i} label={line.description || `Position ${i + 1}`} value={line.amount} />
                ))}
              </View>
            )}

            {/* Catering Netto */}
            <View style={s.groupGap}>
              <AmtRowBold label="Catering Netto" value={cateringNettoVal} />
            </View>

            {/* MwSt */}
            <View style={s.groupGap}>
              <AmtRow label="MwSt Catering (7%)" value={cateringMwstAmt} />
            </View>

            {/* Brutto */}
            <View style={s.groupGap}>
              <AmtRowBold label="Gesamt Brutto" value={cateringBruttoVal} />
            </View>

            {/* Final total */}
            <View style={{ marginTop: 2 }}>
              <AmtRowBold label="Gesamtbetrag (zu zahlen)" value={cateringBruttoVal} />
            </View>
          </View>
        )}

        {/* ── TYPE B: dinner amounts ───────────────────────────────── */}
        {!isMonthly && !isCatering && (
          <View>
            {/* Group 1: Netto split */}
            <View style={s.groupGap}>
              {essenNetto > 0      && <AmtRow label="Essen Netto"    value={essenNetto} />}
              {getraenkeNetto > 0  && <AmtRow label="Getränke Netto" value={getraenkeNetto} />}
              <AmtRowBold label="Gesamt Netto" value={gesamtNettoD} />
            </View>

            {/* Group 2: MwSt */}
            <View style={s.groupGap}>
              {mwstEssenAmt > 0     && <AmtRow label={`MwSt Essen (${data.mwstEssenPct ?? 7}%)`}         value={mwstEssenAmt} />}
              {mwstGetraenkeAmt > 0 && <AmtRow label={`MwSt Getränke (${data.mwstGetraenkePct ?? 19}%)`} value={mwstGetraenkeAmt} />}
              <AmtRow label="MwSt Gesamt" value={mwstGesamtAmt} />
            </View>

            {/* Group 3: Brutto split */}
            <View style={s.groupGap}>
              {essenBrutto > 0     && <AmtRow label={`Essen Brutto (${data.mwstEssenPct ?? 7}% MwSt)`}         value={essenBrutto} />}
              {getraenkeBrutto > 0 && <AmtRow label={`Getränke Brutto (${data.mwstGetraenkePct ?? 19}% MwSt)`} value={getraenkeBrutto} />}
              <AmtRowBold label="Gesamt Brutto" value={gesamtBrutto} />
            </View>

            {/* Group 4: Trinkgeld (only if > 0) */}
            {tip > 0 && (
              <View style={s.groupGap}>
                <AmtRow label="Trinkgeld" value={tip} />
              </View>
            )}

            {/* Final: Gesamtbetrag — with optional deductions */}
            <View style={{ marginTop: 2 }}>
              {hasDeduct ? (
                <>
                  <AmtRowBold label="Gesamtbetrag" value={gesamtBetrag} />
                  {anzBrutto > 0 && (
                    <View style={{ marginTop: 6 }}>
                      <Text>{`abzgl. Anzahlung${data.anzahlungRef ? ` (Rg.-Nr. ${data.anzahlungRef})` : ''}`}</Text>
                      {anzNetto > 0 && (
                        <View style={[s.amountRow, { paddingLeft: 14 }]}>
                          <Text>Netto</Text><Text>{fmt(anzNetto)}</Text>
                        </View>
                      )}
                      {anzVat7 > 0 && (
                        <View style={[s.amountRow, { paddingLeft: 14 }]}>
                          <Text>MwSt 7%</Text><Text>{fmt(anzVat7)}</Text>
                        </View>
                      )}
                      {anzVat19 > 0 && (
                        <View style={[s.amountRow, { paddingLeft: 14 }]}>
                          <Text>MwSt 19%</Text><Text>{fmt(anzVat19)}</Text>
                        </View>
                      )}
                      <View style={[s.amountRow, { paddingLeft: 14 }]}>
                        <Text>Brutto</Text><Text>{fmt(anzBrutto)}</Text>
                      </View>
                    </View>
                  )}
                  {ermaess > 0 && (
                    <View style={s.amountRow}>
                      <Text>abzgl. Ermässigung</Text><Text>{fmt(ermaess)}</Text>
                    </View>
                  )}
                  <View style={{ marginTop: 6 }}>
                    <AmtRowBold label="Restbetrag (zu zahlen)" value={restbetrag} />
                  </View>
                </>
              ) : (
                <AmtRowBold label="Gesamtbetrag (zu zahlen)" value={gesamtBetrag} />
              )}
            </View>
          </View>
        )}

        {/* ── TYPE A totals ────────────────────────────────────────── */}
        {isMonthly && (
          <View style={{ marginTop: 6 }}>
            <View style={s.groupGap}>
              <AmtRowBold label="Gesamt Netto" value={gesamtNetto} />
            </View>
            <View style={s.groupGap}>
              <AmtRow label="Mwst 7%" value={mwst7monthly} />
            </View>
            {hasDeduct ? (
              <>
                <AmtRowBold label="Gesamtbetrag" value={bruttoMonthly} />
                {anzBrutto > 0 && (
                  <View style={{ marginTop: 6 }}>
                    <Text>{`abzgl. Anzahlung${data.anzahlungRef ? ` (Rg.-Nr. ${data.anzahlungRef})` : ''}`}</Text>
                    {anzNetto > 0 && (
                      <View style={[s.amountRow, { paddingLeft: 14 }]}>
                        <Text>Netto</Text><Text>{fmt(anzNetto)}</Text>
                      </View>
                    )}
                    <View style={[s.amountRow, { paddingLeft: 14 }]}>
                      <Text>Brutto</Text><Text>{fmt(anzBrutto)}</Text>
                    </View>
                  </View>
                )}
                {ermaess > 0 && (
                  <View style={s.amountRow}>
                    <Text>abzgl. Ermässigung</Text><Text>{fmt(ermaess)}</Text>
                  </View>
                )}
                <View style={{ marginTop: 6 }}>
                  <AmtRowBold label="Restbetrag (zu zahlen)" value={restbetrag} />
                </View>
              </>
            ) : (
              <AmtRowBold label="Gesamtbetrag (zu zahlen)" value={bruttoMonthly} />
            )}
          </View>
        )}

        {/* ── Payment terms + Vielen Dank! — centred in remaining space ── */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          {!data.storno && (
            <Text style={{ textAlign: 'center', lineHeight: 1.55, marginBottom: 14 }}>{PAYMENT}</Text>
          )}
          <Text style={{ textAlign: 'center', fontFamily: 'Courier-Bold', fontSize: 11 }}>Vielen Dank!</Text>
        </View>

        {/* ── Footer (fixed at bottom of every page) ───────────────── */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>{FOOTER_1}</Text>
          <Text style={s.footerText}>{FOOTER_2}</Text>
        </View>

      </Page>

      {/* ── Page 2: Receipt image (optional) ─────────────────────────── */}
      {data.receiptImageDataUrl && (
        <Page size="A4" style={[s.page, { display: 'flex', alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ fontSize: 9, color: '#888', marginBottom: 10, alignSelf: 'flex-start' }}>
            Kassenbon / POS Receipt
          </Text>
          <Image
            src={data.receiptImageDataUrl}
            style={{ width: '100%', objectFit: 'contain' }}
          />
          <View style={s.footer} fixed>
            <Text style={s.footerText}>{FOOTER_1}</Text>
            <Text style={s.footerText}>{FOOTER_2}</Text>
          </View>
        </Page>
      )}

    </Document>
  );
}
