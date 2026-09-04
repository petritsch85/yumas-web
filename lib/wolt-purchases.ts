/**
 * Parser for Wolt's purchases export — the order list with the items on it.
 *
 * The five-day document set gives totals per order but never says what was
 * sold. This export does, which is what lets Wolt products be counted
 * alongside the webshop's and Orderbird's.
 *
 * Two facts, both verified against a real export of 820 orders:
 *
 *  - The item prices always sum exactly to the order's Price, so the item
 *    lines can be trusted as a full decomposition rather than a sample.
 *  - The sale belongs to the day and shift the order was DELIVERED on, not
 *    placed. Attributing by delivery time reproduced Wolt's own daily totals on
 *    all 59 days; attributing by order time was wrong on four, where a
 *    late-evening order was delivered the next day.
 */

import { parseCsvRows } from './webshop-csv';

export type WoltPurchaseShift = 'lunch' | 'dinner';

/** One item line from one order. */
export interface WoltPurchaseLine {
  orderNumber: string;
  venue:       string;
  /** ISO date of delivery — the day the sale belongs to. */
  saleDate:    string;
  shift:       WoltPurchaseShift;
  placedAt:    string;
  deliveredAt: string;
  status:      string;
  /** Whether this order counts as a sale: rejected orders do not. */
  counts:      boolean;
  /** Position of this line within its order, so re-imports stay stable. */
  lineNo:      number;
  productName: string;
  /** Wolt's short POS code, when the export lines up. */
  posId:       string | null;
  quantity:    number;
  unitPriceCents: number;
  lineGrossCents: number;
}

export class WoltPurchaseParseError extends Error {}

/** Lunch runs until 14:30; everything after counts as dinner. */
export const LUNCH_END_MINUTES = 14 * 60 + 30;

const REQUIRED = ['Order placed', 'Order number', 'Delivery status', 'Items', 'Price', 'Venue'];

/** "31/08/2026, 12:48" → { date, minutes, iso } */
function parseTimestamp(value: string): { date: string; minutes: number; iso: string } | null {
  const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi] = m;
  return {
    date:    `${yyyy}-${mm}-${dd}`,
    minutes: Number(hh) * 60 + Number(mi),
    iso:     `${yyyy}-${mm}-${dd}T${hh.padStart(2, '0')}:${mi}:00`,
  };
}

/**
 * Splits an item list into its entries.
 *
 * Product names contain commas ("Nachos mit Guacamole, scharf"), so the split
 * only happens where a new "<n>x " begins.
 */
export const splitItemList = (value: string): string[] =>
  value ? value.split(/,\s(?=\d+x\s)/).map(s => s.trim()).filter(Boolean) : [];

/** "1x Chili Chicken Bowl 21 EUR" → qty, name, unit price. */
export function parseItemEntry(entry: string): { qty: number; name: string; price: number } | null {
  const m = entry.match(/^(\d+)x\s+(.*?)\s+([\d.]+)\s*EUR$/i);
  if (!m) return null;
  return { qty: Number(m[1]), name: m[2].trim(), price: Number(m[3]) };
}

/**
 * "1x ChCiBo" → "ChCiBo".
 *
 * The POS column carries the same "<n>x " prefix but no price, so it needs its
 * own reader rather than the item one.
 */
export function parsePosEntry(entry: string): string | null {
  const m = entry.match(/^\d+x\s+(.+)$/);
  return m ? m[1].trim() : null;
}

const cents = (n: number) => Math.round(n * 100);

/** Parses the export into one row per item line. */
export function parseWoltPurchases(text: string): WoltPurchaseLine[] {
  const rows = parseCsvRows(text.replace(/^﻿/, ''));
  if (rows.length === 0) throw new WoltPurchaseParseError('The file is empty.');

  const header = rows[0].map(h => h.trim());
  const missing = REQUIRED.filter(c => !header.includes(c));
  if (missing.length > 0) {
    throw new WoltPurchaseParseError(
      `This does not look like a Wolt purchases export — missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
    );
  }
  const at = (row: string[], name: string) => (row[header.indexOf(name)] ?? '').trim();

  const lines: WoltPurchaseLine[] = [];
  for (const row of rows.slice(1)) {
    if (row.length < 2 || !row[0]?.trim()) continue;

    const placed = parseTimestamp(at(row, 'Order placed'));
    if (!placed) continue;
    // Delivery decides the day and the shift; an order placed at 22:11 and
    // delivered at 12:16 the next day is the next day's lunch.
    const delivered = parseTimestamp(at(row, 'Delivery time')) ?? placed;

    const status = at(row, 'Delivery status');
    const items  = splitItemList(at(row, 'Items'));
    const posIds = splitItemList(at(row, 'POS IDs'));
    // The POS column occasionally carries fewer entries than there are items,
    // so codes are only taken when the two line up exactly.
    const posAligned = posIds.length === items.length;

    items.forEach((entry, i) => {
      const parsed = parseItemEntry(entry);
      if (!parsed) return;
      lines.push({
        orderNumber: at(row, 'Order number'),
        venue:       at(row, 'Venue'),
        saleDate:    delivered.date,
        shift:       delivered.minutes <= LUNCH_END_MINUTES ? 'lunch' : 'dinner',
        placedAt:    placed.iso,
        deliveredAt: delivered.iso,
        status,
        counts:      status === 'delivered',
        lineNo:      i,
        productName: parsed.name,
        posId:       posAligned ? parsePosEntry(posIds[i]) : null,
        quantity:    parsed.qty,
        unitPriceCents: cents(parsed.price),
        lineGrossCents: cents(parsed.qty * parsed.price),
      });
    });
  }

  if (lines.length === 0) throw new WoltPurchaseParseError('No order items could be read from this file.');
  return lines;
}

/** Gross per day, for checking the export against what the Wolt PDFs reported. */
export function grossByDay(lines: WoltPurchaseLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) {
    if (!l.counts) continue;
    m.set(l.saleDate, (m.get(l.saleDate) ?? 0) + l.lineGrossCents);
  }
  return m;
}
