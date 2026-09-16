/**
 * Every inventory count ever made, as one CSV.
 *
 * One row per counted item rather than one per report: the item list is not
 * fixed — stores differ, and items come and go — so a column per item would
 * change shape over time and drop the unit. The long form pivots to wide in
 * Excel in one step; the reverse does not.
 *
 * Written for German Excel: semicolon-separated, decimal comma, and a UTF-8
 * byte-order mark so "Kühlhaus" does not arrive as mojibake.
 */

export interface ExportSubmission {
  id:                   string;
  location_name:        string;
  submitted_at:         string;
  submitterName:        string;
  duration_seconds:     number | null;
  linked_delivery_date: string | null;
  edited_at:            string | null;
  comment:              string | null;
  data: { name: string; unit: string; section: string; quantity: number | null }[];
}

const HEADER = [
  'report_id', 'date', 'time', 'weekday', 'location', 'counted_by', 'duration_min',
  'linked_delivery', 'edited', 'comment', 'section', 'item', 'unit', 'quantity',
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A field, quoted when it holds the separator, a quote, or a line break. */
const cell = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** German decimal: 2.5 → "2,5". Counts are whole or half units. */
const qty = (n: number | null) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

export function buildInventoryCsv(rows: ExportSubmission[]): string {
  const lines = [HEADER.join(';')];

  const sorted = [...rows].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
  for (const r of sorted) {
    const at = new Date(r.submitted_at);
    const date = at.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const weekday = WEEKDAYS[at.getDay()];
    const duration = r.duration_seconds != null ? Math.round(r.duration_seconds / 60) : '';
    const linked = r.linked_delivery_date
      ? new Date(r.linked_delivery_date + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '';

    const head = [r.id, date, time, weekday, r.location_name, r.submitterName, duration, linked, r.edited_at ? 'yes' : 'no', r.comment ?? ''];
    for (const item of r.data ?? []) {
      lines.push([...head, item.section, item.name, item.unit, qty(item.quantity)].map(cell).join(';'));
    }
  }
  // The BOM is what tells Excel the file is UTF-8.
  return '﻿' + lines.join('\r\n');
}

/** A filename that sorts by date and says what it holds. */
export const inventoryCsvFilename = () =>
  `yumas-inventory-counts-all-${new Date().toISOString().slice(0, 10)}.csv`;
