/**
 * Every delivery run ever made, as two CSVs in one zip.
 *
 * A delivery has two grains that do not flatten into each other well:
 *
 *  - the run — one row per delivery day: who checked the lists, who packed,
 *    when the van left and arrived, what each store said;
 *  - the line — one row per item per store per run: the target, what the
 *    store reported, what was scheduled and what was actually packed.
 *
 * Folding the run into every line would repeat three hundred timestamps and
 * every store note per delivery, so each grain gets its own file, joined on
 * run_id. Both are written for German Excel: semicolon-separated, decimal
 * comma, UTF-8 byte-order mark.
 */

import { zipSync, strToU8 } from 'fflate';

export interface ExportRun {
  id: string;
  delivery_date: string;
  status: string | null;
  lists_checked_at: string | null;
  lists_checked_by: string | null;
  list_confirmed_eschborn_at: string | null;
  list_confirmed_taunus_at: string | null;
  list_confirmed_westend_at: string | null;
  packing_started_at: string | null;
  packed_by: string | null;
  packing_finished_at: string | null;
  packing_duration_seconds: number | null;
  items_packed_count: number | null;
  delivery_started_at: string | null;
  delivery_started_by: string | null;
  delivery_finished_at: string | null;
  delivery_finished_by: string | null;
  store_packing_finished_at: Record<string, string> | null;
  skipped_stores: string[] | null;
  delivery_snapshot: { inventories?: Record<string, { submitted_at: string }> } | null;
  store_notes: Record<string, string> | null;
  store_inventory_comments: Record<string, string> | null;
}

export interface ExportReceipt {
  run_id: string;
  location_name: string;
  received_at: string;
  received_by: string | null;
  items_confirmed_count: number | null;
}

export interface ExportLine {
  run_id: string;
  location_name: string;
  section: string;
  item_name: string;
  unit: string;
  target_qty: number | null;
  standard_target_qty: number | null;
  reported_qty: number | null;
  delivery_qty: number | null;
  packed_qty: number | null;
  is_packed: boolean | null;
}

const STORES = ['Eschborn', 'Taunus', 'Westend'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const cell = (v: string | number | boolean | null | undefined): string => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
const dt  = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
};
const date = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const weekday = (iso: string) => WEEKDAYS[new Date(iso + 'T12:00:00').getDay()];
const csv = (lines: (string | number | boolean | null | undefined)[][]) => '﻿' + lines.map(l => l.map(cell).join(';')).join('\r\n');

export function buildRunsCsv(
  runs: ExportRun[],
  receipts: ExportReceipt[],
  nameOf: (id: string | null) => string,
): string {
  const header = [
    'run_id', 'delivery_date', 'weekday', 'status',
    'lists_checked_at', 'lists_checked_by',
    ...STORES.map(s => `list_confirmed_${s.toLowerCase()}_at`),
    'packing_started_at', 'packed_by', 'packing_finished_at', 'packing_duration_min', 'items_packed',
    ...STORES.map(s => `packing_finished_${s.toLowerCase()}_at`),
    'delivery_started_at', 'delivery_started_by', 'delivery_finished_at', 'delivery_finished_by',
    ...STORES.flatMap(s => [`received_${s.toLowerCase()}_at`, `received_${s.toLowerCase()}_by`, `received_${s.toLowerCase()}_items`]),
    'skipped_stores',
    ...STORES.map(s => `inventory_${s.toLowerCase()}_at`),
    ...STORES.map(s => `note_${s.toLowerCase()}`),
    ...STORES.map(s => `inventory_comment_${s.toLowerCase()}`),
  ];

  const byRun = new Map<string, ExportReceipt[]>();
  for (const r of receipts) byRun.set(r.run_id, [...(byRun.get(r.run_id) ?? []), r]);

  const rows = [...runs].sort((a, b) => a.delivery_date.localeCompare(b.delivery_date)).map(r => {
    const rec = (s: string) => (byRun.get(r.id) ?? []).find(x => x.location_name === s);
    return [
      r.id, date(r.delivery_date), weekday(r.delivery_date), r.status ?? '',
      dt(r.lists_checked_at), nameOf(r.lists_checked_by),
      dt(r.list_confirmed_eschborn_at), dt(r.list_confirmed_taunus_at), dt(r.list_confirmed_westend_at),
      dt(r.packing_started_at), nameOf(r.packed_by), dt(r.packing_finished_at),
      r.packing_duration_seconds != null ? String(Math.round(r.packing_duration_seconds / 60)) : '',
      num(r.items_packed_count),
      ...STORES.map(s => dt(r.store_packing_finished_at?.[s])),
      dt(r.delivery_started_at), nameOf(r.delivery_started_by), dt(r.delivery_finished_at), nameOf(r.delivery_finished_by),
      ...STORES.flatMap(s => { const x = rec(s); return [dt(x?.received_at), nameOf(x?.received_by ?? null), num(x?.items_confirmed_count)]; }),
      (r.skipped_stores ?? []).join(', '),
      ...STORES.map(s => dt(r.delivery_snapshot?.inventories?.[s]?.submitted_at)),
      ...STORES.map(s => r.store_notes?.[s] ?? ''),
      ...STORES.map(s => r.store_inventory_comments?.[s] ?? ''),
    ];
  });
  return csv([header, ...rows]);
}

export function buildLinesCsv(lines: ExportLine[], runDate: (runId: string) => string | undefined): string {
  const header = [
    'run_id', 'delivery_date', 'weekday', 'location', 'section', 'item', 'unit',
    'target_qty', 'standard_target_qty', 'reported_qty', 'delivery_qty', 'packed_qty', 'is_packed', 'short_by',
  ];
  const rows = lines
    .map(l => ({ l, d: runDate(l.run_id) ?? '' }))
    .sort((a, b) => a.d.localeCompare(b.d) || a.l.location_name.localeCompare(b.l.location_name) || a.l.section.localeCompare(b.l.section))
    .map(({ l, d }) => [
      l.run_id, d ? date(d) : '', d ? weekday(d) : '', l.location_name, l.section, l.item_name, l.unit,
      num(l.target_qty), num(l.standard_target_qty), num(l.reported_qty), num(l.delivery_qty), num(l.packed_qty),
      l.is_packed ?? '',
      // What was scheduled but did not go: the number the packing report calls "short".
      l.delivery_qty != null && l.packed_qty != null ? num(Math.max(0, l.delivery_qty - l.packed_qty)) : '',
    ]);
  return csv([header, ...rows]);
}

/** Both files, zipped, named to sort by date. */
export function buildDeliveryExportZip(runsCsv: string, linesCsv: string): { bytes: Uint8Array; filename: string } {
  const stamp = new Date().toISOString().slice(0, 10);
  const bytes = zipSync({
    [`delivery-runs-${stamp}.csv`]:  strToU8(runsCsv),
    [`delivery-lines-${stamp}.csv`]: strToU8(linesCsv),
  }, { level: 6 });
  return { bytes, filename: `yumas-delivery-reports-all-${stamp}.zip` };
}
