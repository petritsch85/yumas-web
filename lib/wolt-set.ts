/**
 * A Wolt document set — the four PDFs Wolt publishes for one five-day period —
 * and the checks that make importing many of them at once safe.
 *
 * The risk when several sets are uploaded together is silent mis-pairing: an
 * invoice from one period read alongside another period's orders still passes
 * the invoice's own arithmetic, because A − B is internally consistent. It
 * would look correct and be wrong. So a set is only accepted when its orders
 * actually fall inside the period the invoice states.
 */

import type { WoltInvoiceData } from './wolt-invoice';
import type { WoltShiftBreakdown } from './wolt-sales-report';
import type { WoltServicesData } from './wolt-services';

export interface WoltSetFile {
  name: string;
  kind: 'invoice' | 'sales_report' | 'netting_report' | 'wolt_invoice' | 'unknown';
}

export interface WoltSetResult {
  /** Where the set came from — a zip name, or the upload itself. */
  source: string;
  files:  WoltSetFile[];
  /** Set when the set cannot be imported; nothing else is then reliable. */
  error?: string;
  /** Non-fatal notes: a missing sales report, an unmatched location. */
  warnings: string[];

  data?:      WoltInvoiceData;
  services?:  WoltServicesData | null;
  breakdown?: WoltShiftBreakdown | null;

  /** Resolved from the restaurant name on the invoice. */
  locationId?:   string;
  locationName?: string;
}

/** A period on the calendar, used for the gap and overlap checks. */
export interface WoltPeriodSpan {
  source:       string;
  locationName: string;
  start:        string;
  end:          string;
}

export interface WoltCoverageIssue {
  locationName: string;
  kind:  'gap' | 'overlap';
  from:  string;
  to:    string;
  /** The sets either side, for the message. */
  between: [string, string];
}

const dayMs = 24 * 60 * 60 * 1000;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(iso) + n * dayMs).toISOString().slice(0, 10);

/**
 * Reports days that no period covers, and days two periods both claim.
 *
 * Wolt's five-day blocks should run back to back. A gap means a document set
 * was never uploaded — easy to miss when importing a folder of them, and
 * invisible afterwards because nothing in the data says a period is absent.
 */
export function findCoverageIssues(spans: WoltPeriodSpan[]): WoltCoverageIssue[] {
  const issues: WoltCoverageIssue[] = [];
  const byLocation = new Map<string, WoltPeriodSpan[]>();
  for (const s of spans) {
    byLocation.set(s.locationName, [...(byLocation.get(s.locationName) ?? []), s]);
  }

  for (const [locationName, list] of byLocation) {
    const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur  = sorted[i];
      const expected = addDays(prev.end, 1);
      if (cur.start > expected) {
        issues.push({
          locationName, kind: 'gap',
          from: expected, to: addDays(cur.start, -1),
          between: [prev.source, cur.source],
        });
      } else if (cur.start <= prev.end) {
        issues.push({
          locationName, kind: 'overlap',
          from: cur.start, to: prev.end,
          between: [prev.source, cur.source],
        });
      }
    }
  }
  return issues;
}

/**
 * Restaurants Wolt names differently from the location they belong to.
 *
 * Wolt calls the Taunus restaurant by its district, "Yumas Bahnhofsviertel".
 * Aliases are listed explicitly rather than matched loosely, so a new
 * restaurant is never guessed into an existing location.
 */
const RESTAURANT_ALIASES: Record<string, string> = {
  bahnhofsviertel: 'Taunus',
};

/**
 * Matches the restaurant as Wolt names it ("Yumas Westend") to a location.
 *
 * Deliberately conservative: the location name has to appear in full inside the
 * restaurant name, or the restaurant has to be a known alias. Guessing here
 * would file one restaurant's sales under another.
 */
export function matchLocation(
  restaurant: string,
  locations: { id: string; name: string }[],
): { id: string; name: string } | null {
  const r = restaurant.toLowerCase();

  const direct = locations.filter(l => r.includes(l.name.toLowerCase()));
  if (direct.length === 1) return direct[0];

  for (const [alias, locationName] of Object.entries(RESTAURANT_ALIASES)) {
    if (!r.includes(alias)) continue;
    const hit = locations.find(l => l.name.toLowerCase() === locationName.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/**
 * Checks that the orders in a set belong to the period its invoice states.
 *
 * This is what stops a mis-paired set from importing: an invoice and a sales
 * report from different periods reconcile against each other happily, and only
 * the dates give it away.
 */
export function ordersMatchPeriod(
  orderDates: string[],
  invoice: { periodStart: string; periodEnd: string },
): string | null {
  const outside = orderDates.filter(d => d < invoice.periodStart || d > invoice.periodEnd);
  if (outside.length === 0) return null;
  const from = outside.reduce((a, b) => (a < b ? a : b));
  const to   = outside.reduce((a, b) => (a > b ? a : b));
  return (
    `${outside.length} order${outside.length === 1 ? '' : 's'} fall outside the invoice period ` +
    `(${invoice.periodStart} – ${invoice.periodEnd}); the sales report reaches ${from} – ${to}. ` +
    'These files look like they come from different periods.'
  );
}
