/**
 * The event Pauschale VAT split.
 *
 * An event charged as a lump sum is treated as 70% food at 7% and 30% drinks
 * at 19%, which is what the Pauschale input mode already does to a whole bill.
 * An ad-hoc line can carry the same treatment, so one bill can hold an event
 * Pauschale alongside ordinary positions — a DJ at 19%, say — instead of
 * forcing the whole document into one mode.
 *
 * The shares live here so the Pauschale mode, the ad-hoc lines and the PDF all
 * read the same numbers.
 */

export const EVENT_FOOD_SHARE  = 0.70;
export const EVENT_DRINK_SHARE = 0.30;
export const VAT_FOOD  = 0.07;
export const VAT_DRINK = 0.19;

/** The VAT treatment of one ad-hoc position. */
export type AdHocVat = 7 | 19 | 'event';

/** Effective rate on an event Pauschale: 10.6%. */
export const EVENT_EFFECTIVE_RATE =
  EVENT_FOOD_SHARE * VAT_FOOD + EVENT_DRINK_SHARE * VAT_DRINK;

/**
 * Splits ad-hoc positions into the two VAT bases.
 *
 * An event line contributes to both: 70% of its net to the 7% base and 30% to
 * the 19% base. Everything downstream then works in plain 7/19 terms, so the
 * bill still shows one "MwSt (7%)" and one "MwSt (19%)" line however the
 * positions were entered.
 */
export function splitAdHocNet(
  lines: { amountNetto: number; vat: AdHocVat }[],
): { net7: number; net19: number } {
  let net7 = 0;
  let net19 = 0;
  for (const line of lines) {
    if (line.vat === 'event') {
      net7  += line.amountNetto * EVENT_FOOD_SHARE;
      net19 += line.amountNetto * EVENT_DRINK_SHARE;
    } else if (line.vat === 7) {
      net7  += line.amountNetto;
    } else {
      net19 += line.amountNetto;
    }
  }
  return { net7, net19 };
}

/** How a position's VAT treatment is named on the bill. */
export const vatLabel = (vat: AdHocVat) =>
  vat === 'event' ? 'Event-Pauschale, 70/30' : `${vat}% MwSt`;
