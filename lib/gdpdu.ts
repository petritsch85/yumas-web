/**
 * Parser for the Orderbird GDPdU export — the German tax-audit archive.
 *
 * Unlike a Z-report this is the complete transaction record: every bill, every
 * position, every payment, with timestamps. That makes it the best source of
 * historic sales we have, and the only one that can rebuild a shift split for
 * a day nobody exported a Z-report for.
 *
 * Two properties of the archive drive the design:
 *
 *  - `journal_entries.csv` is by far the largest file (50 MB of TSE signatures)
 *    and holds nothing commercial, so it is never decoded.
 *  - A service runs past midnight. The till rolls to the next date at 00:00,
 *    so a Saturday night's last drinks are stamped Sunday at 00:30 — which,
 *    read by the clock alone, becomes a Sunday lunch. Trade before 06:00
 *    therefore belongs to the previous day's dinner. The archive shows why the
 *    hour is safe: 231 bills fall before 04:00, none between 04:00 and 11:00.
 *  - The bills are the record, and the opening hours in the settings are not.
 *    Those describe today: Eschborn's settings say lunch is closed on Friday,
 *    yet the archive holds forty-one Friday lunches at full trade before that
 *    changed. Reassigning by the settings would have folded every one into
 *    dinner. Once the trading day is cut correctly, no closed-day shift is
 *    left to explain — so the bills' own timestamps decide, and nothing else.
 *  - The VAT rate does NOT identify food. German restaurant VAT moved from 19%
 *    to 7% on in-house sales on 1 January 2026, so a period spanning that date
 *    has the same dish at both rates. Food and drinks are therefore split on
 *    the menu category, which does not move.
 */

import { unzipSync } from 'fflate';

export type GdpduShiftType = 'lunch' | 'dinner';

export interface GdpduShift {
  date:  string;
  shift: GdpduShiftType;
  /** Bills settled in this shift. */
  invoices: number;
  grossTotal: number;
  netTotal:   number;
  vatTotal:   number;
  grossFood:      number;
  grossBeverages: number;
  tips:           number;
  inhouseTotal:   number;
  takeawayTotal:  number;
  cancellationsCount: number;
  cancellationsTotal: number;
}

export interface GdpduSummary {
  firstDate: string;
  lastDate:  string;
  days:      number;
  shifts:    number;
  invoices:  number;
  grossTotal: number;
  netTotal:   number;
  vatTotal:   number;
  tips:       number;
  inhouseTotal:  number;
  takeawayTotal: number;
  grossFood:      number;
  grossBeverages: number;
  cancellationsCount: number;
  cancellationsTotal: number;
  /** Bills where net + VAT did not equal gross. Should always be zero. */
  inconsistentInvoices: number;
  /** True when the archive spans the 01.01.2026 VAT change. */
  spansVatChange: boolean;
  /**
   * Shifts whose bills carry no menu lines — a voucher, or a flat event
   * charge — so food and drinks could not be split and are left at zero.
   */
  unsplitShifts: number;
}

export interface GdpduResult {
  shifts:  GdpduShift[];
  summary: GdpduSummary;
}

export class GdpduParseError extends Error {}

/** Lunch runs until 14:30, matching every other import in the app. */
export const LUNCH_END_MINUTES = 14 * 60 + 30;

/**
 * When one trading day ends and the next begins.
 *
 * Not midnight: a service that runs late would otherwise have its last hour
 * counted as the next morning's lunch.
 */
export const DAY_START_MINUTES = 6 * 60;

/** The date German restaurant VAT on in-house sales moved from 19% to 7%. */
export const VAT_CHANGE_DATE = '2026-01-01';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reads one CSV.
 *
 * GDPdU archives are semicolon-separated and Latin-1; the fields are plain
 * values with no embedded separators, so a full quote-aware reader is not
 * needed and would be markedly slower over 50.000 rows.
 */
function readCsv(bytes: Uint8Array): { header: string[]; rows: string[][] } {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { text = new TextDecoder('iso-8859-1').decode(bytes); }

  const lines = text.split(/\r?\n/);
  const strip = (v: string) => v.replace(/^"|"$/g, '').trim();
  const header = (lines[0] ?? '').split(';').map(strip);
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    rows.push(lines[i].split(';').map(strip));
  }
  return { header, rows };
}

/** Column index by name, or -1. */
const idx = (header: string[], name: string) => header.indexOf(name);

/** "19:42:11" → 1182. */
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** The previous calendar day, as "YYYY-MM-DD". */
function previousDay(date: string): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The trading day and shift a timestamp belongs to.
 *
 * Before 06:00 the service is the previous evening's, still running. After
 * that the ordinary 14:30 split applies.
 */
function tradingSlot(date: string, time: string): { date: string; shift: GdpduShiftType } {
  const mins = minutesOf(time);
  if (mins < DAY_START_MINUTES) return { date: previousDay(date), shift: 'dinner' };
  return { date, shift: mins <= LUNCH_END_MINUTES ? 'lunch' : 'dinner' };
}

/** The bucket key for a timestamp. */
const slotKey = (date: string, time: string) => {
  const slot = tradingSlot(date, time);
  return `${slot.date}|${slot.shift}`;
};

/** Amounts are integer cents throughout the archive. */
const cents = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Menu categories that are drinks.
 *
 * Orderbird's `category_kind` has three values here: FOOD, BEVERAGES and
 * OTHER — and OTHER is food, holding the main menu (Tacos, Burritos, Platos,
 * Starter). So only BEVERAGES counts as drinks and everything else as food,
 * rather than trusting a VAT rate that changes meaning mid-period.
 */
const isBeverage = (categoryKind: string) => categoryKind === 'BEVERAGES';

interface Bucket {
  invoices: number;
  gross: number; net: number; vat: number;
  tips: number;
  inhouse: number; takeaway: number;
  food: number; beverages: number;
  cancelCount: number; cancelTotal: number;
}

const emptyBucket = (): Bucket => ({
  invoices: 0, gross: 0, net: 0, vat: 0, tips: 0,
  inhouse: 0, takeaway: 0, food: 0, beverages: 0,
  cancelCount: 0, cancelTotal: 0,
});

/**
 * Parses a GDPdU archive into one row per day and shift.
 *
 * @param zipBytes the .zip exactly as Orderbird produced it
 */
export function parseGdpduZip(zipBytes: Uint8Array): GdpduResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes, {
      // Never inflate the journal: it is the biggest file in the archive by an
      // order of magnitude and holds only fiscal signatures.
      filter: (file) => !/journal_entries\.csv$/i.test(file.name),
    });
  } catch {
    throw new GdpduParseError('That file could not be opened as a zip archive.');
  }

  /** Finds a member by its base name, whatever folder it sits in. */
  const member = (name: string): Uint8Array | null => {
    const hit = Object.entries(files).find(([k, v]) => v.length > 0 && k.replace(/\\/g, '/').split('/').pop() === name);
    return hit ? hit[1] : null;
  };

  const invoicesRaw = member('invoices.csv');
  if (!invoicesRaw) {
    throw new GdpduParseError(
      'This does not look like an Orderbird GDPdU export — invoices.csv is missing.',
    );
  }

  /* ── Bills: the spine. Date, time, and the money. ── */
  const inv = readCsv(invoicesRaw);
  const iId = idx(inv.header, 'id');
  const iDate = idx(inv.header, 'date'), iTime = idx(inv.header, 'time');
  const iTotal = idx(inv.header, 'total'), iNet = idx(inv.header, 'net_total'), iTax = idx(inv.header, 'taxes');
  if (iId < 0 || iDate < 0 || iTime < 0 || iTotal < 0) {
    throw new GdpduParseError('invoices.csv does not have the expected columns.');
  }

  const buckets = new Map<string, Bucket>();
  const bucket = (key: string) => {
    let b = buckets.get(key);
    if (!b) { b = emptyBucket(); buckets.set(key, b); }
    return b;
  };
  /** Which shift each bill belongs to, so payments and taxes can follow it. */
  const invoiceKey = new Map<string, string>();

  let inconsistent = 0;
  for (const r of inv.rows) {
    const date = r[iDate], time = r[iTime];
    if (!date || !time) continue;
    const key = slotKey(date, time);
    invoiceKey.set(r[iId], key);
    const b = bucket(key);
    const gross = cents(r[iTotal]), net = cents(r[iNet]), vat = cents(r[iTax]);
    b.invoices += 1; b.gross += gross; b.net += net; b.vat += vat;
    if (Math.abs(net + vat - gross) > 1) inconsistent += 1;
  }

  /* ── Tips come from the payment, not the bill. ── */
  const payRaw = member('payments.csv');
  if (payRaw) {
    const pay = readCsv(payRaw);
    const pInv = idx(pay.header, 'invoice_id'), pTip = idx(pay.header, 'tip');
    if (pInv >= 0 && pTip >= 0) {
      for (const r of pay.rows) {
        const key = invoiceKey.get(r[pInv]);
        if (key) bucket(key).tips += cents(r[pTip]);
      }
    }
  }

  /* ── In-house vs takeaway, from the positions. ── */
  const posRaw = member('invoiced_positions.csv');
  if (posRaw) {
    const pos = readCsv(posRaw);
    const cDate = idx(pos.header, 'date'), cTime = idx(pos.header, 'time');
    const cType = idx(pos.header, 'sales_type'), cGross = idx(pos.header, 'gross_amount');
    if (cDate >= 0 && cTime >= 0 && cType >= 0 && cGross >= 0) {
      for (const r of pos.rows) {
        if (!r[cDate] || !r[cTime]) continue;
        const b = bucket(slotKey(r[cDate], r[cTime]));
        if (r[cType] === 'TAKEAWAY') b.takeaway += cents(r[cGross]);
        else                         b.inhouse  += cents(r[cGross]);
      }
    }
  }

  /* ── Food vs drinks, and what was cancelled. ── */
  const ordRaw = member('orders.csv');
  /** Line value by order id, so a cancellation can be valued. */
  const orderValue = new Map<string, number>();
  if (ordRaw) {
    const ord = readCsv(ordRaw);
    const oId = idx(ord.header, 'id');
    const oDate = idx(ord.header, 'date'), oTime = idx(ord.header, 'time');
    const oQty = idx(ord.header, 'quantity'), oPrice = idx(ord.header, 'item_price');
    const oKind = idx(ord.header, 'category_kind'), oCancelled = idx(ord.header, 'cancelled');
    if (oDate >= 0 && oTime >= 0 && oQty >= 0 && oPrice >= 0) {
      for (const r of ord.rows) {
        if (!r[oDate] || !r[oTime]) continue;
        const value = Number(r[oQty] || 0) * cents(r[oPrice]);
        if (oId >= 0) orderValue.set(r[oId], value);
        if (oCancelled >= 0 && r[oCancelled] === '1') continue;
        const b = bucket(slotKey(r[oDate], r[oTime]));
        if (oKind >= 0 && isBeverage(r[oKind])) b.beverages += value;
        else                                    b.food      += value;
      }
    }
  }

  const canRaw = member('cancellations.csv');
  if (canRaw) {
    const can = readCsv(canRaw);
    const cOrder = idx(can.header, 'order_id');
    const cDate = idx(can.header, 'date'), cTime = idx(can.header, 'time');
    if (cDate >= 0 && cTime >= 0) {
      for (const r of can.rows) {
        if (!r[cDate] || !r[cTime]) continue;
        const b = bucket(slotKey(r[cDate], r[cTime]));
        b.cancelCount += 1;
        if (cOrder >= 0) b.cancelTotal += orderValue.get(r[cOrder]) ?? 0;
      }
    }
  }

  /* ── Turn the buckets into shift rows. ──
     The food/drinks split is measured on menu prices, which sit above the
     bill's gross once a discount is applied. Scaling it onto the gross keeps
     the two parts summing to the whole, as every other import does. */
  const shifts: GdpduShift[] = [];
  for (const [key, b] of buckets) {
    const [date, shift] = key.split('|') as [string, GdpduShiftType];
    if (b.invoices === 0 && b.gross === 0) continue;

    const menu = b.food + b.beverages;
    const scale = menu > 0 ? b.gross / menu : 0;
    shifts.push({
      date, shift,
      invoices:   b.invoices,
      grossTotal: round2(b.gross / 100),
      netTotal:   round2(b.net / 100),
      vatTotal:   round2(b.vat / 100),
      grossFood:      round2((b.food      * scale) / 100),
      grossBeverages: round2((b.beverages * scale) / 100),
      tips:           round2(b.tips / 100),
      inhouseTotal:   round2(b.inhouse / 100),
      takeawayTotal:  round2(b.takeaway / 100),
      cancellationsCount: b.cancelCount,
      cancellationsTotal: round2(b.cancelTotal / 100),
    });
  }
  shifts.sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));

  if (shifts.length === 0) throw new GdpduParseError('No bills could be read from this archive.');

  const sum = (pick: (s: GdpduShift) => number) => round2(shifts.reduce((t, s) => t + pick(s), 0));
  const dates = shifts.map(s => s.date);
  const firstDate = dates[0], lastDate = dates[dates.length - 1];

  return {
    shifts,
    summary: {
      firstDate, lastDate,
      days:     new Set(dates).size,
      shifts:   shifts.length,
      invoices: shifts.reduce((t, s) => t + s.invoices, 0),
      grossTotal: sum(s => s.grossTotal),
      netTotal:   sum(s => s.netTotal),
      vatTotal:   sum(s => s.vatTotal),
      tips:       sum(s => s.tips),
      inhouseTotal:  sum(s => s.inhouseTotal),
      takeawayTotal: sum(s => s.takeawayTotal),
      grossFood:      sum(s => s.grossFood),
      grossBeverages: sum(s => s.grossBeverages),
      cancellationsCount: shifts.reduce((t, s) => t + s.cancellationsCount, 0),
      cancellationsTotal: sum(s => s.cancellationsTotal),
      inconsistentInvoices: inconsistent,
      unsplitShifts: shifts.filter(s => s.grossTotal > 0 && s.grossFood === 0 && s.grossBeverages === 0).length,
      spansVatChange: firstDate < VAT_CHANGE_DATE && lastDate >= VAT_CHANGE_DATE,
    },
  };
}
