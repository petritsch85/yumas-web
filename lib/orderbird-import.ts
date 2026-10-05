/**
 * Z-reports fetched from MY orderbird by the "Yumas Import" bookmark.
 *
 * MY orderbird refuses requests from servers (Cloudflare bot protection), so
 * the fetching happens in the user's own logged-in browser tab
 * (public/orderbird-import.js) and the CSVs are sent here. Z numbers run on one
 * by one per venue, so the bookmark asks for everything after the last Z
 * number already on file — five forgotten days come in with one click.
 */
import { getSupabaseAdmin } from './supabase-admin';
import { parseShiftCSV } from './orderbird-shift-csv';

/** Orderbird venue → location in this app. */
export const ORDERBIRD_VENUES: { venueId: string; location: string }[] = [
  { venueId: '12275',  location: 'Eschborn' },
  { venueId: '15371',  location: 'Westend' },
  { venueId: '120621', location: 'Taunus' }, // "Yumas Bahnhofsviertel" in Orderbird
];

/* A shift that is closed before five in the afternoon is lunch. The Z-report
   CSV carries no times, but the shift's page does ("05.10.2026 11:33 -
   05.10.2026 15:05"), which beats guessing from the sales mix. The closing
   time, not the opening: when lunch is closed at 14:33 the evening shift
   opens the same minute, so an early start does not make a lunch. */
const LUNCH_ENDS_BEFORE_HOUR = 17;

export type IncomingShift = {
  z:     number;
  csv:   string;
  /** "YYYY-MM-DD HH:MM", read off the shift page; null when it could not be read. */
  start: string | null;
  end?:  string | null;
};

export type ImportedShift = { location: string; z: string; date: string; shift: 'lunch' | 'dinner'; gross: number };

async function locationIdOf(name: string): Promise<string> {
  const { data, error } = await getSupabaseAdmin().from('locations').select('id').eq('name', name).single();
  if (error || !data) throw new Error(`Location "${name}" not found in the app.`);
  return data.id as string;
}

/** The Z numbers already on file for a location. */
async function knownZ(locationId: string): Promise<Set<number>> {
  const known = new Set<number>();
  for (let page = 0; ; page++) {
    const { data, error } = await getSupabaseAdmin().from('shift_reports')
      .select('z_report_number').eq('location_id', locationId)
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      const n = parseInt(String(r.z_report_number ?? ''), 10);
      if (Number.isFinite(n)) known.add(n);
    }
    if (!data || data.length < 1000) break;
  }
  return known;
}

/** Where the bookmark should start for each venue: the last Z number on file. */
export async function venueStatus() {
  return Promise.all(ORDERBIRD_VENUES.map(async v => {
    const known = await knownZ(await locationIdOf(v.location));
    return { ...v, lastZ: known.size ? Math.max(...known) : null };
  }));
}

/** Files the shifts of one venue, skipping any Z-report already on file. */
export async function importVenueShifts(venueId: string, shifts: IncomingShift[]): Promise<ImportedShift[]> {
  const venue = ORDERBIRD_VENUES.find(v => v.venueId === venueId);
  if (!venue) throw new Error(`Unknown Orderbird venue ${venueId}`);
  const admin = getSupabaseAdmin();
  const locationId = await locationIdOf(venue.location);
  const known = await knownZ(locationId);
  const imported: ImportedShift[] = [];

  for (const s of [...shifts].sort((a, b) => a.z - b.z)) {
    if (known.has(s.z)) continue;
    const sr = parseShiftCSV(s.csv);
    if (sr.error) throw new Error(`${venue.location} Z-report ${s.z}: ${sr.error}`);
    if (parseInt(sr.zReportNumber, 10) !== s.z) {
      throw new Error(`${venue.location}: asked for Z-report ${s.z} but the file is ${sr.zReportNumber}`);
    }

    const start = s.start?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):\d{2}$/);
    const end   = s.end?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):\d{2}$/);
    const date = start?.[1] ?? sr.date;
    const shiftType: 'lunch' | 'dinner' =
      start && end && end[1] === start[1] && Number(end[2]) < LUNCH_ENDS_BEFORE_HOUR ? 'lunch' : 'dinner';

    const { data: inserted, error } = await admin.from('shift_reports').insert({
      location_id: locationId, report_date: date,
      z_report_number: sr.zReportNumber,
      shift_type: shiftType,
      gross_total: sr.grossTotal, gross_food: sr.grossFood,
      gross_beverages: sr.grossDrinks, net_total: sr.netTotal,
      vat_total: sr.vatTotal, tips: sr.tips,
      inhouse_total: sr.inhouseTotal, takeaway_total: sr.takeawayTotal,
      cancellations_count: sr.cancellationsCount,
      cancellations_total: sr.cancellationsTotal,
      uploaded_by: null,
    }).select('id').single();
    if (error) throw error;

    if (sr.categories.length > 0) {
      const { error: catErr } = await admin.from('shift_report_categories').insert(
        sr.categories.map(c => ({
          shift_report_id: inserted.id, category_name: c.name,
          quantity: c.quantity, total_revenue: c.revenue,
          inhouse_revenue: c.inhouseRevenue, takeaway_revenue: c.takeawayRevenue,
          is_main_category: c.isMain,
        })),
      );
      if (catErr) throw catErr;
    }
    if (sr.products.length > 0) {
      const { error: prodErr } = await admin.from('shift_report_products').insert(
        sr.products.map(p => ({
          shift_report_id: inserted.id, product_name: p.name,
          quantity: p.quantity, gross_sales: p.gross_sales,
        })),
      );
      if (prodErr) throw prodErr;
    }

    known.add(s.z);
    imported.push({ location: venue.location, z: sr.zReportNumber, date, shift: shiftType, gross: sr.grossTotal });
  }
  return imported;
}

/** One row per click, shown on the Sales Reports page. */
export async function logRun(ok: boolean, imported: ImportedShift[], error: string | null) {
  const { error: logErr } = await getSupabaseAdmin().from('orderbird_sync_runs').insert({
    trigger: 'bookmark', ok, imported_count: imported.length, imported, error,
  });
  if (logErr) console.warn('[orderbird-import] could not log the run:', logErr.message);
}

/** Whether a bookmark's token is one the app issued. */
export async function validToken(token: string | null): Promise<boolean> {
  if (!token || token.length < 32) return false;
  const { data } = await getSupabaseAdmin().from('orderbird_import_tokens').select('token').eq('token', token).maybeSingle();
  return !!data;
}
