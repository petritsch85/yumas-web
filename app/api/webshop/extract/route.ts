import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseWebshopCsv, aggregateWebshopShifts, WebshopParseError } from '@/lib/webshop-csv';
import type { WebshopOrder, WebshopShift } from '@/lib/webshop-csv';
import { matchLocation } from '@/lib/wolt-set';

export const runtime = 'nodejs';

interface ClosedWeekdayRow { location_id: string; shift_type: string; closed_weekdays: string[] | null }
interface ClosureDayRow   { location_id: string; closure_date: string; shift_type: string }

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Reads a webshop export and returns orders ready to store.
 *
 * Each order is filed against the restaurant its venue names — the same rule
 * the Wolt import uses, including the alias that maps Wolt's and the webshop's
 * "Bahnhofsviertel" to the Taunus location. A venue that resolves to nothing is
 * reported rather than guessed at.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart upload.' }, { status: 400 });
  }

  const file = form.getAll('files').find((f): f is File => f instanceof File);
  if (!file) return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 });

  let orders: WebshopOrder[];
  try {
    orders = parseWebshopCsv(await file.text());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof WebshopParseError ? e.message : 'The file could not be read.' },
      { status: 422 },
    );
  }

  const admin = getSupabaseAdmin();
  const [{ data: locationRows }, { data: settings }, { data: closures }] = await Promise.all([
    admin.from('locations').select('id, name').eq('is_active', true),
    admin.from('forecast_settings').select('location_id, shift_type, closed_weekdays'),
    admin.from('closure_days').select('location_id, closure_date, shift_type'),
  ]);
  const locations = (locationRows ?? []) as { id: string; name: string }[];

  // Resolve every venue once, and report the ones that do not map.
  const venueToLocation = new Map<string, { id: string; name: string }>();
  const unmatched = new Set<string>();
  for (const venue of new Set(orders.map(o => o.venue))) {
    const hit = matchLocation(venue, locations);
    if (hit) venueToLocation.set(venue, hit);
    else unmatched.add(venue);
  }
  if (unmatched.size > 0) {
    return NextResponse.json({
      error:
        `${[...unmatched].map(v => `"${v}"`).join(', ')} ` +
        `${unmatched.size === 1 ? 'does' : 'do'} not match a location in the system ` +
        `(${locations.map(l => l.name).join(', ')}). Add the location, or name it so the venue matches.`,
    }, { status: 422 });
  }

  // Same closed-shift handling as the Wolt import: an order timed to a shift
  // the restaurant was shut for was prepared by the shift that was open.
  const recurring = new Set<string>();
  for (const r of (settings ?? []) as ClosedWeekdayRow[]) {
    for (const day of r.closed_weekdays ?? []) recurring.add(`${r.location_id}|${r.shift_type}|${day}`);
  }
  const specific = new Set<string>();
  for (const c of (closures ?? []) as ClosureDayRow[]) {
    for (const shift of c.shift_type === 'all' ? ['lunch', 'dinner'] : [c.shift_type]) {
      specific.add(`${c.location_id}|${shift}|${c.closure_date}`);
    }
  }
  const isShiftClosed = (venue: string, date: string, shift: WebshopShift) => {
    const locationId = venueToLocation.get(venue)?.id;
    if (!locationId) return false;
    if (specific.has(`${locationId}|${shift}|${date}`)) return true;
    return recurring.has(`${locationId}|${shift}|${DOW[new Date(date + 'T12:00:00Z').getUTCDay()]}`);
  };

  const { totals, reassigned } = aggregateWebshopShifts(orders, isShiftClosed);

  // The shift on the stored row is the one the aggregation settled on, so the
  // raw page and the P&L can never tell different stories.
  const shiftByOrder = new Map<string, WebshopShift>();
  for (const o of orders) {
    const other: WebshopShift = o.shift === 'lunch' ? 'dinner' : 'lunch';
    shiftByOrder.set(
      o.orderNumber,
      isShiftClosed(o.venue, o.saleDate, o.shift) && !isShiftClosed(o.venue, o.saleDate, other) ? other : o.shift,
    );
  }

  const rows = orders.map(o => ({
    location_id:     venueToLocation.get(o.venue)!.id,
    order_number:    o.orderNumber,
    venue:           o.venue,
    sale_date:       o.saleDate,
    shift:           shiftByOrder.get(o.orderNumber) ?? o.shift,
    fulfilled_at:    o.fulfilledAt,
    created_at_shop: o.createdAt,
    order_type:      o.orderType,
    status:          o.status,
    payment_status:  o.paymentStatus,
    counts:          o.counts,
    items:           o.items,
    net_cents:          o.netCents,
    vat_cents:          o.vatCents,
    gross_cents:        o.grossCents,
    tip_cents:          o.tipCents,
    delivery_fee_cents: o.deliveryFeeCents,
    discount_cents:     o.discountCents,
  }));

  const counted = orders.filter(o => o.counts);
  return NextResponse.json({
    rows,
    summary: {
      total:      orders.length,
      counted:    counted.length,
      skipped:    orders.length - counted.length,
      netCents:   counted.reduce((s, o) => s + o.netCents, 0),
      grossCents: counted.reduce((s, o) => s + o.grossCents, 0),
      from:       orders.reduce((a, o) => (o.saleDate < a ? o.saleDate : a), orders[0].saleDate),
      to:         orders.reduce((a, o) => (o.saleDate > a ? o.saleDate : a), orders[0].saleDate),
      reassigned,
      shiftTotals: totals,
    },
  });
}
