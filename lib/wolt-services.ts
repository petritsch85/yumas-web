/**
 * Parser for what Wolt charges us, as opposed to what Wolt owes us.
 *
 * The charge appears in two places in a document set:
 *
 *  - the netting report, as a single "Wolt Dienstleistungen und Produkte" line.
 *    This is the figure the P&L books as advertising.
 *  - the Wolt-to-merchant invoice, itemised. In a real set that came to an ad
 *    campaign, a weekly sim-card fee and a late-delivery charge — so the total
 *    is not purely advertising. The items are parsed too, and the ad-campaign
 *    part kept separately, so the P&L can be pointed at either figure without
 *    re-uploading anything.
 */

export interface WoltServiceLine {
  description: string;
  /** Net of VAT. */
  amount: number;
  /** True when this line is an advertising campaign rather than a fee. */
  isAdCampaign: boolean;
}

export interface WoltServicesData {
  /**
   * Total "Wolt Dienstleistungen und Produkte", net of VAT — every service and
   * fee Wolt charged for the period. This is what the P&L books as advertising.
   */
  total: number;
  /** The advertising-campaign part alone, when the itemised invoice is present. */
  adCampaign: number | null;
  /** The itemised lines, when the Wolt-to-merchant invoice is present. */
  lines: WoltServiceLine[];
}

export class WoltServicesParseError extends Error {}

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const round2 = (n: number) => Math.round(n * 100) / 100;

const AMOUNT = String.raw`(-?[\d.]+,\d{2})`;

/**
 * Reads the single services total from the netting report.
 *
 * The netting report is the authority here: it states the charge for the period
 * as one figure, in the same place every time.
 */
export function parseWoltNettingServices(text: string): number {
  const m = text.match(new RegExp(
    String.raw`Wolt Dienstleistungen und Produkte\s+DEU\/\S+\s+` + AMOUNT,
  ));
  if (!m) {
    throw new WoltServicesParseError(
      'Could not find the "Wolt Dienstleistungen und Produkte" line in the netting report.',
    );
  }
  return num(m[1]);
}

/**
 * Reads the itemised charges from the Wolt-to-merchant invoice.
 *
 * A description can wrap over several lines — an ad campaign carries its date
 * range and campaign id — so rather than guessing how many lines to look back,
 * each item's description is everything between the end of the previous item
 * and this item's amount.
 */
export function parseWoltServiceLines(text: string): WoltServiceLine[] {
  const body = text.split(/Wolt Dienstleistungen und Produkte/)[1];
  if (!body) return [];

  // An amount followed by its VAT rate marks the end of an item. A service line
  // has a quantity in front; an extra fee sits inline with no quantity at all,
  // so neither the quantity nor a line start can be required.
  const re = new RegExp(String.raw`(?:(\d+)\s+)?` + AMOUNT + String.raw`\s+(\d+[.,]\d+)\s*%`, 'g');

  /** Column headings and leftovers from the previous row's trailing figures. */
  const stripNoise = (raw: string) => {
    let d = raw.replace(/\s+/g, ' ');
    // Everything up to the last column heading belongs to the table, not the item.
    const heading = /(?:Gesamtpreis \(inkl\.? ?MwSt\.?\)|mit MwSt\.|Summe|Zusätzliche Gebühren)/gi;
    let m: RegExpExecArray | null, cut = 0;
    while ((m = heading.exec(d)) !== null) cut = m.index + m[0].length;
    d = d.slice(cut);
    // The previous row's VAT and gross figures lead the slice; drop them.
    return d.replace(/^[\s\d.,%()]+/, '').trim();
  };

  const lines: WoltServiceLine[] = [];
  let prevEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const description = stripNoise(body.slice(prevEnd, m.index));
    prevEnd = re.lastIndex;
    if (!description) continue;
    lines.push({
      description,
      amount: num(m[2]),
      isAdCampaign: /ad campaign|advertis|werbe|kampagne|campaign/i.test(description),
    });
  }

  return lines;
}

/**
 * Combines the two sources. The netting total wins when both are present — it
 * is the figure Wolt actually nets off the payout.
 */
export function buildWoltServices(
  nettingText: string | null,
  invoiceText: string | null,
): WoltServicesData {
  const lines = invoiceText ? parseWoltServiceLines(invoiceText) : [];
  const adLines = lines.filter(l => l.isAdCampaign);

  const total = nettingText
    ? parseWoltNettingServices(nettingText)
    : round2(lines.reduce((s, l) => s + l.amount, 0));

  return {
    total,
    adCampaign: adLines.length > 0 ? round2(adLines.reduce((s, l) => s + l.amount, 0)) : null,
    lines,
  };
}
