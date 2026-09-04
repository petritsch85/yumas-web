/**
 * Parser for the webshop's analytics export.
 *
 * The webshop sells take-away at every restaurant and delivery at Eschborn.
 * One CSV row is one order, with amounts in cents.
 *
 * Two things about the export drive the design:
 *
 *  - "Gesamt" includes the tip, while "Netto (gesamt)" and "MwSt (gesamt)" do
 *    not — verified across every row of a real export. So net + VAT + tip =
 *    gross, and net sales exclude tips, as they should.
 *  - An order carries a creation time and, when the customer pre-ordered, a
 *    separate fulfilment time. The shift is taken from the fulfilment time: an
 *    11:00 order collected at 19:00 was cooked by the dinner shift.
 */

export type WebshopShift = 'lunch' | 'dinner';
export type WebshopOrderType = 'pickup' | 'delivery';

export interface WebshopOrder {
  orderNumber: string;
  /** Restaurant as the webshop names it, e.g. "Yumas Westend". */
  venue:       string;
  /** ISO date the order was fulfilled on. */
  saleDate:    string;
  /** Fulfilment timestamp, ISO, local. */
  fulfilledAt: string;
  /** When the order was placed, ISO. Differs on a pre-order. */
  createdAt:   string;
  shift:       WebshopShift;
  orderType:   WebshopOrderType;
  /** Raw status from the shop: completed, pending, … */
  status:        string;
  paymentStatus: string;
  /** Whether this order counts as a sale — completed and paid. */
  counts:      boolean;
  items:       string;
  /** All amounts in cents, as exported. */
  netCents:         number;
  vatCents:         number;
  grossCents:       number;
  tipCents:         number;
  deliveryFeeCents: number;
  discountCents:    number;
}

export class WebshopParseError extends Error {}

/** Lunch runs until 14:30; everything after counts as dinner. */
export const LUNCH_END_MINUTES = 14 * 60 + 30;

/**
 * Reads a CSV into rows, honouring quoted fields.
 *
 * Item lists contain commas ("1x Chicken Quesadilla, 1x Nachos"), so splitting
 * on commas alone would corrupt every multi-item order.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** "27/07/2026 13:27" → { date: "2026-07-27", minutes: 807 }. */
function parseGermanDateTime(value: string): { date: string; minutes: number; iso: string } | null {
  const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = '0', mi = '0'] = m;
  return {
    date:    `${yyyy}-${mm}-${dd}`,
    minutes: Number(hh) * 60 + Number(mi),
    iso:     `${yyyy}-${mm}-${dd}T${String(hh).padStart(2, '0')}:${mi}:00`,
  };
}

const cents = (v: string) => {
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

const REQUIRED = ['Bestellnummer', 'Erstellt am', 'Standort', 'Art', 'Status', 'Netto (gesamt)'];

/**
 * Parses a webshop export.
 *
 * Test orders are dropped outright. Unpaid ones are kept but marked as not
 * counting, so the page can show what was abandoned rather than silently
 * discarding a third of the file.
 */
export function parseWebshopCsv(text: string): WebshopOrder[] {
  const rows = parseCsvRows(text.replace(/^﻿/, ''));
  if (rows.length === 0) throw new WebshopParseError('The file is empty.');

  const header = rows[0].map(h => h.trim());
  const missing = REQUIRED.filter(c => !header.includes(c));
  if (missing.length > 0) {
    throw new WebshopParseError(
      `This does not look like a webshop export — missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
    );
  }
  const at = (row: string[], name: string) => (row[header.indexOf(name)] ?? '').trim();

  const orders: WebshopOrder[] = [];
  for (const row of rows.slice(1)) {
    if (row.length < 2 || !row[0]?.trim()) continue;
    if (at(row, 'Testbestellung') === 'Ja') continue;

    const created = parseGermanDateTime(at(row, 'Erstellt am'));
    if (!created) continue;
    // A pre-ordered item is cooked by the shift that hands it over, not the one
    // that happened to be on when the customer clicked.
    const fulfilled =
      parseGermanDateTime(at(row, 'Bestellt für (Vorbestellung)')) ??
      parseGermanDateTime(at(row, 'Geschätzte Abholzeit')) ??
      created;

    const status        = at(row, 'Status');
    const paymentStatus = at(row, 'Zahlungsstatus');

    orders.push({
      orderNumber: at(row, 'Bestellnummer'),
      venue:       at(row, 'Standort'),
      saleDate:    fulfilled.date,
      fulfilledAt: fulfilled.iso,
      createdAt:   created.iso,
      shift:       fulfilled.minutes <= LUNCH_END_MINUTES ? 'lunch' : 'dinner',
      orderType:   /liefer/i.test(at(row, 'Art')) ? 'delivery' : 'pickup',
      status,
      paymentStatus,
      // An unpaid order is an abandoned checkout, not a sale.
      counts: status === 'completed' && paymentStatus === 'paid',
      items:  at(row, 'Artikel'),
      netCents:         cents(at(row, 'Netto (gesamt)')),
      vatCents:         cents(at(row, 'MwSt (gesamt)')),
      grossCents:       cents(at(row, 'Gesamt')),
      tipCents:         cents(at(row, 'Trinkgeld')),
      deliveryFeeCents: cents(at(row, 'Liefergebühr')),
      discountCents:    cents(at(row, 'Rabatt')),
    });
  }

  if (orders.length === 0) throw new WebshopParseError('No orders could be read from this file.');
  return orders;
}

export interface WebshopShiftTotal {
  venue:    string;
  saleDate: string;
  shift:    WebshopShift;
  orders:   number;
  netCents: number;
  grossCents: number;
}

/**
 * Totals the countable orders by venue, day and shift.
 *
 * `isShiftClosed` moves an order to the other shift when the one its time
 * implies was closed that day — the same rule the Wolt import uses, for the
 * same reason: a take-away collected on a Monday evening at Westend was
 * prepared by the lunch shift, because there is no dinner shift that day.
 */
export function aggregateWebshopShifts(
  orders: WebshopOrder[],
  isShiftClosed?: (venue: string, date: string, shift: WebshopShift) => boolean,
): { totals: WebshopShiftTotal[]; reassigned: number } {
  const byKey = new Map<string, WebshopShiftTotal>();
  let reassigned = 0;

  for (const o of orders) {
    if (!o.counts) continue;

    let shift = o.shift;
    if (isShiftClosed) {
      const other: WebshopShift = shift === 'lunch' ? 'dinner' : 'lunch';
      if (isShiftClosed(o.venue, o.saleDate, shift) && !isShiftClosed(o.venue, o.saleDate, other)) {
        shift = other;
        reassigned++;
      }
    }

    const key = `${o.venue}|${o.saleDate}|${shift}`;
    const cur = byKey.get(key) ?? {
      venue: o.venue, saleDate: o.saleDate, shift, orders: 0, netCents: 0, grossCents: 0,
    };
    cur.orders     += 1;
    cur.netCents   += o.netCents;
    cur.grossCents += o.grossCents;
    byKey.set(key, cur);
  }

  return {
    totals: [...byKey.values()].sort(
      (a, b) => a.saleDate.localeCompare(b.saleDate) || a.venue.localeCompare(b.venue) || a.shift.localeCompare(b.shift),
    ),
    reassigned,
  };
}
