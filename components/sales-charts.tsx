'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase-browser';
import { dailySalesActuals } from '@/lib/daily-sales-actuals';
import { WeekdaySalesCharts } from '@/components/weekday-sales-charts';

/**
 * All the sales charts in one place: pick a restaurant or the group, then a
 * shift. Reported sales only, from the same figures as "Total net sales" on the
 * daily sheet, so a forecast never shows up as a bar.
 */

const FROM = '2026-07-01';
type Loc = { id: string; name: string };
type Shift = 'day' | 'lunch' | 'dinner';
const SHIFTS: [Shift, string][] = [['day', 'All day'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];

export function SalesCharts({ locations }: { locations: Loc[] }) {
  const [scope, setScope] = useState('group');
  const [shift, setShift] = useState<Shift>('day');

  const { data: actuals, isLoading, error } = useQuery({
    queryKey: ['sales-charts', FROM, locations.map(l => l.id).join()],
    enabled: locations.length > 0,
    queryFn: () => dailySalesActuals(supabase, locations, FROM, new Date().toISOString().slice(0, 10)),
  });

  const days = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, v] of Object.entries(actuals ?? {})) {
      const [loc, date, sh] = key.split('|');
      if (scope !== 'group' && loc !== scope) continue;
      /* A sale with no shift set counts towards the whole day only. */
      if (shift !== 'day' && sh !== shift) continue;
      out[date] = (out[date] ?? 0) + v;
    }
    return out;
  }, [actuals, scope, shift]);

  const scopeName = scope === 'group' ? 'Group — all restaurants' : locations.find(l => l.id === scope)?.name ?? '';
  const shiftName = SHIFTS.find(([k]) => k === shift)![1];
  const on = 'bg-[#1B5E20] text-white border-[#1B5E20]', off = 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50';

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        {[{ id: 'group', name: 'Group' }, ...locations].map(l => (
          <button key={l.id} onClick={() => setScope(l.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${scope === l.id ? on : off}`}>
            {l.name}
          </button>
        ))}
        <span className="w-px h-6 bg-gray-200 mx-1" />
        {SHIFTS.map(([k, label]) => (
          <button key={k} onClick={() => setShift(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${shift === k ? 'bg-gray-900 text-white border-gray-900' : off}`}>
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mt-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error instanceof Error ? error.message : 'Charts could not be loaded'}
        </div>
      ) : isLoading ? (
        <div className="mt-6 flex items-center gap-2 text-xs text-gray-500">
          <Loader2 size={14} className="animate-spin" /> Loading sales…
        </div>
      ) : (
        <WeekdaySalesCharts days={days} from={FROM}
          title={`Total net sales · ${shiftName} by weekday since 1 July 2026 · ${scopeName}`} />
      )}
    </div>
  );
}
