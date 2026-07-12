import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Temporary debug endpoint: GET /api/inventory/movements-debug?store=Eschborn&date=2026-07-08
export async function GET(req: NextRequest) {
  const store = req.nextUrl.searchParams.get('store') ?? 'Eschborn';
  const date  = req.nextUrl.searchParams.get('date') ?? '2026-07-08';

  // 1. All delivery runs
  const { data: runs } = await supabase
    .from('delivery_runs')
    .select('id, delivery_date')
    .order('delivery_date', { ascending: true });

  // 2. Lines for this store
  const { data: storeLines } = await supabase
    .from('delivery_run_lines')
    .select('run_id, item_name')
    .eq('location_name', store)
    .in('run_id', (runs ?? []).map(r => r.id));

  const runIdsWithStore = new Set((storeLines ?? []).map(l => l.run_id));
  const relevantRuns = (runs ?? []).filter(r => runIdsWithStore.has(r.id));
  const deliveryDates = relevantRuns.map(r => r.delivery_date);

  const lastRunIdx = (runs ?? []).findIndex(r => r.id === relevantRuns[relevantRuns.length - 1]?.id);
  const nextRun = (runs ?? [])[lastRunIdx + 1];
  const allDatesToQuery = nextRun
    ? [...deliveryDates, nextRun.delivery_date]
    : deliveryDates;

  // 3. Submission for the requested date
  const { data: submissions } = await supabase
    .from('inventory_submissions')
    .select('id, location_name, submitted_at, linked_delivery_date, data')
    .eq('location_name', store)
    .in('linked_delivery_date', allDatesToQuery)
    .is('deleted_at', null)
    .order('submitted_at', { ascending: false });

  const sub = (submissions ?? []).find(s => s.linked_delivery_date === date);

  return NextResponse.json({
    store,
    date,
    relevantDeliveryDates: deliveryDates,
    allDatesToQuery,
    submissionsFound: (submissions ?? []).map(s => ({
      id: s.id,
      submitted_at: s.submitted_at,
      linked_delivery_date: s.linked_delivery_date,
      dataLength: Array.isArray(s.data) ? s.data.length : typeof s.data,
      dataPreview: Array.isArray(s.data) ? s.data.slice(0, 3) : s.data,
    })),
    targetSubmission: sub ? {
      id: sub.id,
      submitted_at: sub.submitted_at,
      linked_delivery_date: sub.linked_delivery_date,
      dataIsArray: Array.isArray(sub.data),
      dataLength: Array.isArray(sub.data) ? sub.data.length : 'NOT AN ARRAY',
      first5Items: Array.isArray(sub.data) ? sub.data.slice(0, 5) : sub.data,
    } : null,
  });
}
