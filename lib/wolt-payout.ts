/**
 * Parser for Wolt's self-delivery contract — the model Eschborn is on.
 *
 * Two contracts are in use, and they publish different documents:
 *
 *  - Wolt delivers (Westend, Taunus): a self-billing invoice states subtotal
 *    (A) goods and subtotal (B) commission, and the netting report carries
 *    Wolt's own charges. See wolt-invoice.ts.
 *  - The restaurant delivers (Eschborn): there is no self-billing invoice at
 *    all. A payout report states what was sold, and Wolt invoices its fees
 *    separately.
 *
 * This module reads the second pair and presents it in the same shape, so
 * everything downstream — the shift split, the P&L lines, the storage — stays
 * common to both.
 */

import type { WoltInvoiceData } from './wolt-invoice';
import { parseGermanNumber, parseGermanDate, WoltParseError } from './wolt-invoice';

const round2 = (n: number) => Math.round(n * 100) / 100;
const AMOUNT = String.raw`(-?[\d.]+,\d{2})`;

/** Everything the payout report tells us about the period. */
export interface WoltPayoutData {
  /** Goods sold, net of VAT, after merchant discounts. */
  goodsNet:   number;
  goodsGross: number;
  /** Delivery income — what customers paid us to deliver. Net of VAT. */
  deliveryNet: number;
  /** Service fee we collect and Wolt charges straight back. Net of VAT. */
  serviceFeeNet: number;
  /** Tips. Never revenue, kept only so the reconciliation adds up. */
  tipsNet: number;
  /** Deliveries, service fee and tips together, including VAT. */
  servicesGross: number;
  /**
   * Payout corrections — customer compensations and the like. Negative, and
   * reported outside the goods total. Net of VAT.
   */
  correctionsNet: number;
  /** The same corrections including VAT, for the payout reconciliation. */
  correctionsGross: number;
  /** Wolt's invoice to us for the period, including VAT. */
  woltInvoiceGross: number;
  /** What Wolt actually paid out. */
  payout: number;
}

/** Wolt's own invoice for its fees, on the self-delivery contract. */
export interface WoltFeeInvoiceData {
  /** Every fee Wolt charged, net of VAT. */
  totalNet: number;
  /** The advertising part alone, when the invoice carries a campaign. */
  adCampaignNet: number;
  invoiceNumber: string;
  invoiceDate:   string;
  periodStart:   string;
  periodEnd:     string;
  restaurant:    string;
}

function need(text: string, re: RegExp, what: string): string {
  const m = text.match(re);
  if (!m) throw new WoltParseError(`Could not find ${what}.`);
  return m[1];
}

/** True when this document is the self-delivery payout report. */
export const isPayoutReport = (text: string) => /Auszahlungsbericht/i.test(text);

/** Reads the payout report (Auszahlungsbericht). */
export function parseWoltPayoutReport(text: string): WoltPayoutData {
  if (!isPayoutReport(text)) {
    throw new WoltParseError('This is not the Wolt payout report (Auszahlungsbericht).');
  }

  // "Gesamt, verkaufte Waren  185,32  12,98  198,30" — net, VAT, gross.
  const goods = text.match(new RegExp(
    String.raw`Gesamt, verkaufte Waren\s+` + AMOUNT + String.raw`\s+` + AMOUNT + String.raw`\s+` + AMOUNT,
  ));
  if (!goods) throw new WoltParseError('Could not find the goods total (Gesamt, verkaufte Waren).');

  const optional = (re: RegExp) => {
    const m = text.match(re);
    return m ? parseGermanNumber(m[1]) : 0;
  };

  return {
    goodsNet:   parseGermanNumber(goods[1]),
    goodsGross: parseGermanNumber(goods[3]),
    deliveryNet:   optional(new RegExp(String.raw`Verkaufte Lieferungen\s*[–-]\s*Eigene Lieferung\s+` + AMOUNT)),
    serviceFeeNet: optional(new RegExp(String.raw`Servicegebühr, vom Händler erhoben\s+` + AMOUNT)),
    tipsNet:       optional(new RegExp(String.raw`Trinkgeld\s+` + AMOUNT)),
    // "Verkaufte Lieferungen und Dienstleistungen insgesamt  22,37  1,21  23,58"
    // — net, VAT, then the gross we want.
    servicesGross: optional(new RegExp(
      String.raw`Verkaufte Lieferungen und Dienstleistungen insgesamt\s+` +
      String.raw`-?[\d.]+,\d{2}\s+-?[\d.]+,\d{2}\s+` + AMOUNT,
    )),
    // The corrections section lists each compensation and closes with a "Summe"
    // line carrying net, VAT and gross. Net is what reduces sales.
    correctionsNet: (() => {
      const section = text.split(/Auszahlungskorrekturen\s+Gesamtbetrag/)[1];
      const summe = section?.match(new RegExp(
        String.raw`Summe\s+` + AMOUNT + String.raw`\s+` + AMOUNT + String.raw`\s+` + AMOUNT,
      ));
      return summe ? parseGermanNumber(summe[1]) : 0;
    })(),
    // "Auszahlungskorrekturen" appears twice when the period has any: once as a
    // section heading, once in the summary. The summary line is the gross total.
    correctionsGross: (() => {
      const all = [...text.matchAll(new RegExp(String.raw`Auszahlungskorrekturen\s+` + AMOUNT, 'g'))];
      return all.length === 0 ? 0 : parseGermanNumber(all[all.length - 1][1]);
    })(),
    woltInvoiceGross: Math.abs(optional(new RegExp(String.raw`Rechnung von Wolt an Händler gesamt\s+` + AMOUNT))),
    payout:           optional(new RegExp(String.raw`Zahlungsbetrag\s+` + AMOUNT)),
  };
}

/**
 * Finds which restaurant a set belongs to.
 *
 * The self-billing contract labels it "Restaurant Yumas Westend". The
 * self-delivery fee invoice has no such label — the restaurant appears only in
 * the address block, under the billing entity — so the label is looked for
 * first and the address block used as a fallback. "Yumas GmbH" is the company
 * being billed, never the restaurant.
 */
export function findRestaurant(...texts: (string | undefined)[]): string | null {
  for (const text of texts) {
    const labelled = text?.match(/Restaurant\s+(.+)/);
    if (labelled) return labelled[1].trim();
  }
  for (const text of texts) {
    const inAddress = text?.match(/^(Yumas\s+(?!GmbH\b)[^\n]+)$/m);
    if (inAddress) return inAddress[1].trim();
  }
  return null;
}

/**
 * Reads Wolt's fee invoice (the "Wolt Rechnung" of a self-delivery set).
 *
 * @param others other documents from the set, used only to name the restaurant.
 */
export function parseWoltFeeInvoice(text: string, ...others: (string | undefined)[]): WoltFeeInvoiceData {
  // The VAT summary carries the invoice net: "19.00  33,24  6,32  39,56".
  const totals = text.match(new RegExp(
    String.raw`MwSt\. % Summe \(ohne USt\) MwSt\. EUR Summe \(inkl\. USt\)\s+[\d.,]+\s+` + AMOUNT,
  ));
  if (!totals) throw new WoltParseError('Could not find the fee invoice total.');

  // An advertising campaign, when the period had one.
  let adCampaignNet = 0;
  const adRe = new RegExp(String.raw`(?:Ad campaign|Werbekampagne|Advertising)[^\n]*(?:\n[^\n]*?)*?\s` + AMOUNT + String.raw`\s+\d+[.,]\d+%`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = adRe.exec(text)) !== null) adCampaignNet = round2(adCampaignNet + parseGermanNumber(m[1]));

  const restaurant = findRestaurant(text, ...others);
  if (!restaurant) throw new WoltParseError('Could not find the restaurant this set belongs to.');

  const period = text.match(/Leistungszeitraum\s+(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/);
  if (!period) throw new WoltParseError('Could not find the Leistungszeitraum on the fee invoice.');

  return {
    totalNet:      parseGermanNumber(totals[1]),
    adCampaignNet,
    invoiceNumber: need(text, /Rechnungsnummer\s+(DEU\/\S+)/, 'the fee invoice number'),
    invoiceDate:   parseGermanDate(need(text, /Rechnungsdatum\s+(\d{2}\.\d{2}\.\d{4})/, 'the fee invoice date')),
    periodStart:   parseGermanDate(period[1]),
    periodEnd:     parseGermanDate(period[2]),
    restaurant,
  };
}

/**
 * Presents a self-delivery period in the same shape as a self-billing one.
 *
 * Net sales are the goods sold plus the delivery income the restaurant earns
 * for delivering itself — Wolt's own deliveries never appear at the other
 * locations, so this is income Eschborn has and they do not. Tips are left out:
 * they are not revenue.
 *
 * Customer compensations are deducted, matching the delivered contract, where
 * refunds already reduce subtotal (A). Wolt reports them outside the goods
 * total here, so they have to be subtracted explicitly rather than arriving
 * netted off.
 *
 * Commission is Wolt's whole fee invoice, less any advertising campaign, so the
 * platform and service fees sit with the commission they arrive alongside.
 *
 * The check is the payout itself: goods plus services less Wolt's invoice must
 * equal what Wolt paid, all including VAT.
 */
export function toInvoiceShape(
  payout: WoltPayoutData,
  fees:   WoltFeeInvoiceData,
): WoltInvoiceData {
  const netSalesPreCommission = round2(
    payout.goodsNet + payout.deliveryNet + payout.correctionsNet,
  );
  const commission            = round2(fees.totalNet - fees.adCampaignNet);
  const expectedPayout = round2(
    payout.goodsGross + payout.servicesGross + payout.correctionsGross - payout.woltInvoiceGross,
  );

  return {
    invoiceNumber: fees.invoiceNumber,
    invoiceDate:   fees.invoiceDate,
    periodStart:   fees.periodStart,
    periodEnd:     fees.periodEnd,
    restaurant:    fees.restaurant,
    netSalesPreCommission,
    commission,
    netSalesPreAds: round2(netSalesPreCommission - commission),
    // There is no Endbetrag on this contract; the payout is the equivalent
    // figure to check against.
    reportedEndbetrag: payout.payout,
    checkOk: Math.abs(expectedPayout - payout.payout) < 0.005,
  };
}
