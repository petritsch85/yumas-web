import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ store: string }> },
) {
  const { store } = await params;

  // 1. All delivery runs ordered by date
  const { data: runs } = await supabase
    .from('delivery_runs')
    .select('id, delivery_date')
    .order('delivery_date', { ascending: true });

  if (!runs?.length) return NextResponse.json({ store, items: [], cycles: [] });

  // 2. Which runs have lines for this store?
  const { data: storeLines } = await supabase
    .from('delivery_run_lines')
    .select('run_id, item_name, section, unit, packed_qty, delivery_qty')
    .eq('location_name', store)
    .in('run_id', runs.map((r) => r.id));

  const runIdsWithStore = new Set((storeLines ?? []).map((l) => l.run_id));
  const relevantRuns = runs.filter((r) => runIdsWithStore.has(r.id));

  if (!relevantRuns.length) return NextResponse.json({ store, items: [], cycles: [] });

  // 3. Delivery lines grouped by run
  const linesByRun: Record<string, { item_name: string; packed_qty: number | null; delivery_qty: number }[]> = {};
  for (const line of storeLines ?? []) {
    if (!linesByRun[line.run_id]) linesByRun[line.run_id] = [];
    linesByRun[line.run_id].push(line);
  }

  // 4. Inventory submissions linked to each relevant delivery date
  const deliveryDates = relevantRuns.map((r) => r.delivery_date);

  // Also include deliveryDates for the run AFTER the last relevant one (to get the
  // "post-inventory" for the final cycle)
  const lastRunIdx  = runs.findIndex((r) => r.id === relevantRuns[relevantRuns.length - 1].id);
  const nextRun     = runs[lastRunIdx + 1];
  const allDatesToQuery = nextRun
    ? [...deliveryDates, nextRun.delivery_date]
    : deliveryDates;

  const { data: submissions } = await supabase
    .from('inventory_submissions')
    .select('id, location_name, submitted_at, linked_delivery_date, data')
    .eq('location_name', store)
    .in('linked_delivery_date', allDatesToQuery)
    .is('deleted_at', null)
    .order('submitted_at', { ascending: false });

  // Latest submission per linked_delivery_date
  const subByDelivDate: Record<string, { submitted_at: string; data: { name: string; quantity: number }[] }> = {};
  for (const sub of submissions ?? []) {
    const d = sub.linked_delivery_date;
    if (d && !subByDelivDate[d]) {
      subByDelivDate[d] = { submitted_at: sub.submitted_at, data: sub.data ?? [] };
    }
  }

  // 5. Master item list for this store (canonical order)
  const { data: masterItems } = await supabase
    .from('inventory_items')
    .select('name, section, unit, sort_order, store_sort_orders')
    .contains('stores', [store])
    .order('sort_order', { ascending: true });

  // 6. Build cycles
  const cycles: {
    deliveryDate:  string;
    preInvDate:    string | null;
    postInvDate:   string | null;
    preInv:        Record<string, number>;
    delivery:      Record<string, number>;
    postInv:       Record<string, number> | null;
    consumption:   Record<string, number> | null;
  }[] = [];

  for (let i = 0; i < relevantRuns.length; i++) {
    const run      = relevantRuns[i];
    const nextDelv = relevantRuns[i + 1]?.delivery_date ?? nextRun?.delivery_date;

    const preSub  = subByDelivDate[run.delivery_date] ?? null;
    const postSub = nextDelv ? subByDelivDate[nextDelv] ?? null : null;

    // Pre-inventory map
    const preInv: Record<string, number> = {};
    for (const item of preSub?.data ?? []) preInv[item.name] = item.quantity;

    // Delivery map (use packed_qty; fallback to delivery_qty)
    const delivery: Record<string, number> = {};
    for (const line of linesByRun[run.id] ?? []) {
      const qty = line.packed_qty ?? line.delivery_qty ?? 0;
      if (qty > 0) delivery[line.item_name] = qty;
    }

    // Post-inventory map
    let postInv: Record<string, number> | null = null;
    if (postSub) {
      postInv = {};
      for (const item of postSub.data) postInv[item.name] = item.quantity;
    }

    // Consumption = preInv + delivery - postInv  (per item)
    let consumption: Record<string, number> | null = null;
    if (postInv && masterItems) {
      consumption = {};
      for (const item of masterItems) {
        const pre  = preInv[item.name]  ?? 0;
        const del  = delivery[item.name] ?? 0;
        const post = postInv[item.name] ?? 0;
        consumption[item.name] = pre + del - post;
      }
    }

    cycles.push({
      deliveryDate: run.delivery_date,
      preInvDate:   preSub?.submitted_at ?? null,
      postInvDate:  postSub?.submitted_at ?? null,
      preInv,
      delivery,
      postInv,
      consumption,
    });
  }

  return NextResponse.json({
    store,
    items: (masterItems ?? []).map((i) => ({
      name:    i.name,
      section: i.section,
      unit:    i.unit,
    })),
    cycles,
  });
}
