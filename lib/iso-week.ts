/**
 * ISO week arithmetic, shared by every page that buckets days into weeks.
 *
 * These live in one place deliberately. The rules are easy to get subtly
 * wrong — a week can belong to a different year than its dates, and a year can
 * hold 53 of them — and a second copy is a second chance to reintroduce the
 * bug where three days of December land in a week eleven months earlier.
 */

/** The ISO week number of a "YYYY-MM-DD" date, 1–53. */
export function isoWeek(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - y.getTime()) / 86400000 + 1) / 7);
}

/**
 * The year an ISO week belongs to, which is not always the calendar year.
 *
 * KW1 of 2026 runs 29.12.2025 – 04.01.2026, so three of its days carry a 2025
 * date. Bucketing those by calendar year would drop them from the 2026 column
 * and add them to KW1 of 2025.
 */
export function isoWeekYear(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}

/** The Monday of an ISO week, as "YYYY-MM-DD". */
export function isoWeekMonday(year: number, week: number): string {
  // ISO week 1 is the one holding 4 January, so the first Monday is found from
  // that date rather than from 1 January, which can fall in the prior week.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

/** The Monday and Sunday of an ISO week, as "30.03 – 05.04". */
export function isoWeekRange(year: number, week: number): string {
  const monday = new Date(isoWeekMonday(year, week) + 'T12:00:00Z');
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const dm = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${dm(monday)} – ${dm(sunday)}`;
}

/**
 * How many ISO weeks a year holds — 52, or 53 when 1 January is a Thursday
 * (or a Wednesday in a leap year). 2026 is such a year: KW53 runs
 * 28.12.2026 – 03.01.2027.
 */
export function isoWeeksInYear(year: number): number {
  const dec28 = new Date(Date.UTC(year, 11, 28));
  dec28.setUTCDate(dec28.getUTCDate() + 4 - (dec28.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(dec28.getUTCFullYear(), 0, 1));
  return Math.ceil(((dec28.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
}

/** The ISO week number of today. */
export function currentISOWeek(): number {
  const t = new Date();
  return isoWeek(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
}
