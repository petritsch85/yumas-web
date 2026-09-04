import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseWoltPurchases, grossByDay, WoltPurchaseParseError } from '@/lib/wolt-purchases';
import type { WoltPurchaseLine } from '@/lib/wolt-purchases';
import { matchLocation } from '@/lib/wolt-set';

export const runtime = 'nodejs';

/** How one day's export compares with what the Wolt invoices already told us. */
export interface WoltPurchaseDayCheck {
  date:        string;
  exportGross: number;
  woltGross:   number | null;
  diff:        number | null;
}

/**
 * Reads a Wolt purchases export and checks it against the periods already
 * imported from the five-day document sets.
 *
 * The check matters because the two exports are produced independently: if the
 * item lines add up to the same daily gross Wolt invoiced, the products can be
 * trusted as a complete decomposition of those sales rather than a subset.
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

  let lines: WoltPurchaseLine[];
  try {
    lines = parseWoltPurchases(await file.text());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof WoltPurchaseParseError ? e.message : 'The file could not be read.' },
      { status: 422 },
    );
  }

  const admin = getSupabaseAdmin();
  const { data: locationRows } = await admin
    .from('locations').select('id, name').eq('is_active', true);
  const locations = (locationRows ?? []) as { id: string; name: string }[];

  // One export covers one venue, but nothing guarantees that, so every venue is
  // resolved and an unknown one stops the import rather than being guessed at.
  const venueToLocation = new Map<string, { id: string; name: string }>();
  const unmatched: string[] = [];
  for (const venue of new Set(lines.map(l => l.venue))) {
    const hit = matchLocation(venue, locations);
    if (hit) venueToLocation.set(venue, hit);
    else unmatched.push(venue);
  }
  if (unmatched.length > 0) {
    return NextResponse.json({
      error:
        `${unmatched.map(v => `"${v}"`).join(', ')} does not match a location in the system ` +
        `(${locations.map(l => l.name).join(', ')}).`,
    }, { status: 422 });
  }

  // ── Cross-check: the export's daily gross against the invoiced daily gross ──
  const exportGross = grossByDay(lines);
  const dates = [...exportGross.keys()].sort();
  const locationIds = [...new Set([...venueToLocation.values()].map(l => l.id))];

  const { data: shiftRows } = await admin
    .from('wolt_shift_sales')
    .select('sale_date, gross, location_id')
    .in('location_id', locationIds)
    .gte('sale_date', dates[0])
    .lte('sale_date', dates[dates.length - 1]);

  const woltGross = new Map<string, number>();
  for (const r of (shiftRows ?? []) as { sale_date: string; gross: number }[]) {
    woltGross.set(r.sale_date, (woltGross.get(r.sale_date) ?? 0) + Number(r.gross));
  }

  const checks: WoltPurchaseDayCheck[] = dates.map(date => {
    const ex = (exportGross.get(date) ?? 0) / 100;
    const wo = woltGross.has(date) ? woltGross.get(date)! : null;
    return {
      date,
      exportGross: Math.round(ex * 100) / 100,
      woltGross:   wo === null ? null : Math.round(wo * 100) / 100,
      diff:        wo === null ? null : Math.round((ex - wo) * 100) / 100,
    };
  });

  const compared  = checks.filter(c => c.diff !== null);
  const differing = compared.filter(c => Math.abs(c.diff!) >= 0.011);
  const counted   = lines.filter(l => l.counts);

  const rows = lines.map(l => ({
    location_id:  venueToLocation.get(l.venue)!.id,
    order_number: l.orderNumber,
    venue:        l.venue,
    sale_date:    l.saleDate,
    shift:        l.shift,
    placed_at:    l.placedAt,
    delivered_at: l.deliveredAt,
    status:       l.status,
    counts:       l.counts,
    line_no:      l.lineNo,
    product_name: l.productName,
    pos_id:       l.posId,
    quantity:     l.quantity,
    unit_price_cents: l.unitPriceCents,
    line_gross_cents: l.lineGrossCents,
  }));

  return NextResponse.json({
    rows,
    summary: {
      orders:   new Set(lines.map(l => `${l.venue}|${l.orderNumber}`)).size,
      lines:    lines.length,
      rejected: new Set(lines.filter(l => !l.counts).map(l => `${l.venue}|${l.orderNumber}`)).size,
      products: new Set(counted.map(l => l.productName)).size,
      grossCents: counted.reduce((s, l) => s + l.lineGrossCents, 0),
      from: dates[0],
      to:   dates[dates.length - 1],
      venues: [...venueToLocation.keys()],
      check: {
        daysCompared:  compared.length,
        daysMatching:  compared.length - differing.length,
        daysUnchecked: checks.length - compared.length,
        differing:     differing.slice(0, 20),
      },
    },
  });
}
