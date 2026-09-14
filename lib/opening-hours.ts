/**
 * Which shifts a restaurant is open for, on a given date.
 *
 * Three layers, in order of precedence:
 *
 *  1. An exception that OPENS a shift on one date — an event on a Sunday the
 *     store is otherwise shut. Wins over everything.
 *  2. A one-off closure on one date — a public holiday, a private booking of
 *     the whole room.
 *  3. The recurring pattern: the weekdays each shift is closed, from the
 *     forecast settings.
 *
 * Every place that needs to know — the daily sheet's shading, the shift-type
 * classifier on a Z-report upload, the Wolt and webshop imports — reads this
 * one function. It used to be copied into each of them, and copies drift.
 */

export type ShiftType = 'lunch' | 'dinner';

export interface ClosedWeekdayRow {
  location_id: string;
  shift_type:  string;
  closed_weekdays: string[] | null;
}

export interface ClosureRow {
  location_id:  string;
  closure_date: string;
  shift_type:   string;             // 'lunch' | 'dinner' | 'all'
  /** 'closed' (the default) shuts the shift; 'open' opens one the pattern shuts. */
  kind?: 'closed' | 'open' | null;
}

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The weekday key of a "YYYY-MM-DD" date, as the settings store it. */
export const weekdayOf = (date: string) => DOW[new Date(date + 'T12:00:00Z').getUTCDay()];

const shiftsOf = (shiftType: string): ShiftType[] =>
  shiftType === 'all' ? ['lunch', 'dinner'] : [shiftType as ShiftType];

/**
 * Builds the checker for any number of locations at once — the imports look
 * up several restaurants in one pass.
 */
export function buildShiftClosedChecker(
  settings: ClosedWeekdayRow[],
  closures: ClosureRow[],
): (locationId: string, date: string, shift: ShiftType) => boolean {
  const recurring = new Set<string>();
  for (const r of settings) {
    for (const day of r.closed_weekdays ?? []) recurring.add(`${r.location_id}|${r.shift_type}|${day}`);
  }
  const closed = new Set<string>();
  const opened = new Set<string>();
  for (const c of closures) {
    for (const shift of shiftsOf(c.shift_type)) {
      (c.kind === 'open' ? opened : closed).add(`${c.location_id}|${shift}|${c.closure_date}`);
    }
  }
  return (locationId, date, shift) => {
    const key = `${locationId}|${shift}|${date}`;
    if (opened.has(key)) return false;
    if (closed.has(key)) return true;
    return recurring.has(`${locationId}|${shift}|${weekdayOf(date)}`);
  };
}

/** The same checker, bound to one location. */
export function shiftClosedCheckerFor(
  locationId: string,
  settings: ClosedWeekdayRow[],
  closures: ClosureRow[],
): (date: string, shift: ShiftType) => boolean {
  const check = buildShiftClosedChecker(settings, closures);
  return (date, shift) => check(locationId, date, shift);
}
