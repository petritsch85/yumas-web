/**
 * Parser for the OpenTable GuestCenter reservation export.
 *
 * One CSV row is one reservation. The export is German-language and carries
 * far more columns than we need — payment, experience revenue, tax — all of
 * which are empty in practice because we take payment through the till, not
 * through OpenTable. Only the reservation itself is read.
 *
 * Two things about the file drive the design:
 *
 *  - Visit notes are free text and routinely run over dozens of lines inside
 *    one quoted field (a party booking's menu, for instance). Splitting on
 *    newlines would shred the file, so it is read with a quote-aware reader.
 *  - Almost every reservation sits at "Nicht bestätigt". In this restaurant
 *    that is the resting state, not a signal that the booking is doubtful, so
 *    unconfirmed reservations count. Only an explicit cancellation or no-show
 *    is excluded.
 */

export type OpenTableShift = 'lunch' | 'dinner';

export interface OpenTableBooking {
  /** Stable identity for a reservation, so re-importing an export updates it. */
  externalKey: string;
  visitDate:   string;
  /** "19:30", or empty when the export omitted a time. */
  visitTime:   string;
  shift:       OpenTableShift;
  guestName:   string;
  phone:       string;
  /** Party size — "Größe" — the covers this reservation is worth. */
  partySize:   number;
  status:      string;
  /** Whether these covers count towards the booked total. */
  counts:      boolean;
  table:       string;
  /** "Telefon/Im Restaurant", "Ihr Netzwerk", "OpenTable-Netzwerk". */
  source:      string;
  requests:    string;
  notes:       string;
  tags:        string;
  /** "Abgeschlossene Besuche" — how many visits this guest has completed. */
  completedVisits: number | null;
}

export class OpenTableParseError extends Error {}

/** Lunch runs until 14:30; everything later belongs to dinner. */
export const LUNCH_END_MINUTES = 14 * 60 + 30;

/**
 * Reads a CSV into rows, honouring quoted fields.
 *
 * Visit notes contain commas, newlines and doubled quotes, so a naive split
 * would corrupt every reservation that carries one.
 */
export function parseCsvRows(text: string, delimiter = ','): string[][] {
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
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** The export is comma-separated, but a German Excel round-trip yields semicolons. */
export function detectDelimiter(text: string): ',' | ';' {
  const header = text.split('\n', 1)[0] ?? '';
  const commas = (header.match(/,/g) ?? []).length;
  const semis  = (header.match(/;/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

/**
 * Statuses that mean the party is not coming.
 *
 * Matched loosely because OpenTable's German wording varies by account
 * ("Storniert", "Abgesagt", "Nicht erschienen", and the English originals).
 */
const CANCELLED = /storn|abgesagt|nicht erschienen|no.?show|cancel/i;

/** "2026-09-08" or "08.09.2026" → "2026-09-08". */
function parseDate(value: string): string | null {
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** "19:30" → 1170 minutes. Null when the field is empty or unreadable. */
function parseMinutes(value: string): number | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const num = (v: string) => {
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const REQUIRED = ['Besuchsdatum', 'Größe', 'Status'];

/** Columns whose German names differ between OpenTable account settings. */
const COLUMN = {
  date:      ['Besuchsdatum', 'Visit Date'],
  time:      ['Besuchszeit', 'Visit Time'],
  name:      ['Name des Gastes', 'Guest Name'],
  phone:     ['Telefonnummer', 'Phone Number'],
  size:      ['Größe', 'Party Size'],
  status:    ['Status'],
  table:     ['Tisch', 'Table'],
  source:    ['Quelle', 'Source'],
  requests:  ['Gästeanfragen', 'Guest Requests'],
  notes:     ['Besuchsnotizen', 'Visit Notes'],
  tags:      ['Reservierungsetiketten', 'Reservation Tags'],
  completed: ['Abgeschlossene Besuche', 'Completed Visits'],
} as const;

/**
 * Parses a GuestCenter export.
 *
 * Cancelled reservations are kept but marked as not counting, so the raw page
 * can show what was booked and then dropped rather than silently losing it.
 */
export function parseOpenTableCsv(text: string): OpenTableBooking[] {
  const clean = text.replace(/^﻿/, '');
  const rows  = parseCsvRows(clean, detectDelimiter(clean));
  if (rows.length === 0) throw new OpenTableParseError('The file is empty.');

  const header  = rows[0].map(h => h.trim());
  const missing = REQUIRED.filter(c => !header.includes(c));
  if (missing.length > 0) {
    throw new OpenTableParseError(
      `This does not look like an OpenTable export — missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
    );
  }

  /** Reads a field by whichever of its known column names the file uses. */
  const at = (row: string[], names: readonly string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return (row[i] ?? '').trim();
    }
    return '';
  };

  const bookings: OpenTableBooking[] = [];
  const seen = new Map<string, number>();

  for (const row of rows.slice(1)) {
    if (row.length < 2) continue;
    const visitDate = parseDate(at(row, COLUMN.date));
    if (!visitDate) continue;

    const rawTime  = at(row, COLUMN.time);
    const minutes  = parseMinutes(rawTime);
    const status    = at(row, COLUMN.status);
    const guestName = at(row, COLUMN.name);
    const phone     = at(row, COLUMN.phone);
    const partySize = Math.round(num(at(row, COLUMN.size)));

    /* No reservation id in the export, so identity is what makes a booking
       distinct to a person reading the list. Two genuinely separate parties
       matching on all of these get a counter, rather than overwriting. */
    const base = [visitDate, rawTime, guestName.toLowerCase(), phone, partySize].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);

    const completedRaw = at(row, COLUMN.completed);

    bookings.push({
      externalKey: n > 1 ? `${base}|${n}` : base,
      visitDate,
      visitTime: rawTime,
      // A reservation with no time is an evening booking far more often than a
      // lunch one, and dinner is the shift we are reporting on.
      shift: minutes !== null && minutes <= LUNCH_END_MINUTES ? 'lunch' : 'dinner',
      guestName,
      phone,
      partySize,
      status,
      counts: !CANCELLED.test(status) && partySize > 0,
      table:    at(row, COLUMN.table),
      source:   at(row, COLUMN.source),
      requests: at(row, COLUMN.requests),
      notes:    at(row, COLUMN.notes),
      tags:     at(row, COLUMN.tags),
      completedVisits: completedRaw === '' ? null : num(completedRaw),
    });
  }

  if (bookings.length === 0) throw new OpenTableParseError('No reservations could be read from this file.');
  return bookings;
}

export interface OpenTableSummary {
  total:      number;
  counted:    number;
  cancelled:  number;
  /** Covers that count, split by shift. */
  lunchCovers:  number;
  dinnerCovers: number;
  lunchBookings:  number;
  dinnerBookings: number;
  firstDate: string;
  lastDate:  string;
}

export function summariseOpenTable(bookings: OpenTableBooking[]): OpenTableSummary {
  const dates = bookings.map(b => b.visitDate).sort();
  const counted = bookings.filter(b => b.counts);
  const lunch  = counted.filter(b => b.shift === 'lunch');
  const dinner = counted.filter(b => b.shift === 'dinner');
  return {
    total:     bookings.length,
    counted:   counted.length,
    cancelled: bookings.length - counted.length,
    lunchCovers:    lunch.reduce((s, b) => s + b.partySize, 0),
    dinnerCovers:  dinner.reduce((s, b) => s + b.partySize, 0),
    lunchBookings:  lunch.length,
    dinnerBookings: dinner.length,
    firstDate: dates[0] ?? '',
    lastDate:  dates[dates.length - 1] ?? '',
  };
}
