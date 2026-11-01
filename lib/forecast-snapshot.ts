import type { SupabaseClient } from '@supabase/supabase-js';
import { dailySalesActuals } from '@/lib/daily-sales-actuals';

/**
 * The month's forecast as it stood on the 1st — frozen, never touched again.
 *
 * The live forecast in sales_forecasts moves through the month: bookings lift
 * nights, someone raises a shift to October's level. That is the forecast to
 * plan with, but it can no longer say how good the forecast was when the month
 * began. So on the 1st the whole month is copied once, as a file next to the
 * month's other documents, and kept.
 */

export type SnapshotRow = {
  location_id: string; forecast_date: string;
  /** 'booked' (older snapshots) or 'day': a sale on the books with no shift set. */
  shift_type: 'lunch' | 'dinner' | 'booked' | 'day'; net_total: number;
  /** Sales already on the books for a day still to come, rather than forecast. */
  booked?: boolean;
};
export type Snapshot = { month: string; frozenAt: string; rows: SnapshotRow[] };

const BUCKET = 'cashflow-files';
const pathOf = (month: string) => `forecast-snapshots/${month}.json`;

export async function readSnapshot(admin: SupabaseClient, month: string): Promise<Snapshot | null> {
  const { data } = await admin.storage.from(BUCKET).download(pathOf(month));
  if (!data) return null;
  try { return JSON.parse(await data.text()) as Snapshot; } catch { return null; }
}

/** Freezes the month unless it already is. Returns what is frozen, or null when there is no forecast to freeze. */
export async function freezeMonth(admin: SupabaseClient, month: string, force = false): Promise<Snapshot | null> {
  if (!force) {
    const existing = await readSnapshot(admin, month);
    if (existing) return existing;
  }
  const [y, m] = month.split('-').map(Number);
  const end = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const { data, error } = await admin.from('sales_forecasts')
    .select('location_id,forecast_date,shift_type,net_total').gte('forecast_date', `${month}-01`).lte('forecast_date', end);
  if (error) throw new Error(error.message);
  if (!data?.length) return null;

  /* Sales already on the books for the days still to come — an event
     invoiced in advance — belong to the month's figure as the P&L shows it,
     so they are frozen with it. */
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const rest = today > `${month}-01` ? today : `${month}-01`;
  const booked: SnapshotRow[] = [];
  if (rest <= end) {
    const { data: locs } = await admin.from('locations').select('id,name').eq('type', 'restaurant');
    const known = await dailySalesActuals(admin, (locs ?? []) as { id: string; name: string }[], rest, end);
    for (const [k, v] of Object.entries(known)) {
      const [location_id, forecast_date, shift] = k.split('|');
      booked.push({ location_id, forecast_date, shift_type: shift as SnapshotRow['shift_type'], net_total: Math.round(v * 100) / 100, booked: true });
    }
  }
  const snap: Snapshot = { month, frozenAt: new Date().toISOString(), rows: [...(data as SnapshotRow[]), ...booked] };
  const { error: upErr } = await admin.storage.from(BUCKET)
    .upload(pathOf(month), JSON.stringify(snap), { contentType: 'application/json', upsert: true });
  if (upErr) throw new Error(upErr.message);
  return snap;
}
