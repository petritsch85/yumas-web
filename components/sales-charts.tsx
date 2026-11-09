'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase-browser';
import { dailySalesActuals } from '@/lib/daily-sales-actuals';
import { WeekdaySalesCharts } from '@/components/weekday-sales-charts';

/**
 * All the sales charts in one place: pick a restaurant or the group, then a
 * shift. Reported sales come from the same figures as "Total net sales" on the
 * daily sheet, and the forecast runs on from today in orange.
 *
 * Today counts a shift as reported once its Z-report is in. Until then a webshop
 * order or two on the books is not the shift's result, so its forecast stands.
 */

const FROM = '2026-07-01';
const berlinToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
/* The forecast now runs a year ahead; the charts show it to the end of next
   month, so the history keeps its width. */
const forecastUntil = (today: string) => {
  const [y, m] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
};
type Loc = { id: string; name: string };
type Shift = 'day' | 'lunch' | 'dinner';
const SHIFTS: [Shift, string][] = [['day', 'All day'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];
type ForecastRow = { location_id: string; forecast_date: string; shift_type: string; net_total: number };

export function SalesCharts({ locations }: { locations: Loc[] }) {
  const [scope, setScope] = useState('group');
  const [shift, setShift] = useState<Shift>('day');
  const today = berlinToday();
  const ids = locations.map(l => l.id);

  const { data, isLoading, error } = useQuery({
    queryKey: ['sales-charts', FROM, today, ids.join()],
    enabled: locations.length > 0,
    queryFn: async () => {
      const [actuals, forecasts, reported] = await Promise.all([
        dailySalesActuals(supabase, locations, FROM, today),
        (async () => {
          const rows: ForecastRow[] = [];
          for (let p = 0; ; p++) {
            const { data: page, error: e } = await supabase.from('sales_forecasts')
              .select('location_id,forecast_date,shift_type,net_total')
              .in('location_id', ids).gte('forecast_date', today).lte('forecast_date', forecastUntil(today))
              .order('forecast_date').range(p * 1000, p * 1000 + 999);
            if (e) throw new Error(e.message);
            rows.push(...((page ?? []) as ForecastRow[]));
            if ((page ?? []).length < 1000) return rows;
          }
        })(),
        supabase.from('shift_reports').select('location_id,shift_type')
          .in('location_id', ids).eq('report_date', today),
      ]);
      return {
        actuals, forecasts,
        reported: new Set((reported.data ?? []).map(r => `${r.location_id}|${r.shift_type}`)),
      };
    },
  });

  const { days, forecast } = useMemo(() => {
    const days: Record<string, number> = {}, forecast: Record<string, number> = {};
    if (!data) return { days, forecast };
    for (const [key, v] of Object.entries(data.actuals)) {
      const [loc, date, sh] = key.split('|');
      if (scope !== 'group' && loc !== scope) continue;
      /* A sale with no shift set counts towards the whole day only. */
      if (shift !== 'day' && sh !== shift) continue;
      if (date === today && !data.reported.has(`${loc}|${sh}`)) continue;
      days[date] = (days[date] ?? 0) + v;
    }
    for (const r of data.forecasts) {
      if (scope !== 'group' && r.location_id !== scope) continue;
      if (shift !== 'day' && r.shift_type !== shift) continue;
      if (r.forecast_date === today && data.reported.has(`${r.location_id}|${r.shift_type}`)) continue;
      forecast[r.forecast_date] = (forecast[r.forecast_date] ?? 0) + Number(r.net_total);
    }
    return { days, forecast };
  }, [data, scope, shift, today]);

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
        <WeekdaySalesCharts days={days} forecast={forecast} from={FROM} today={today}
          title={`Total net sales · ${shiftName} by weekday since 1 July 2026 · ${scopeName}`} />
      )}
    </div>
  );
}
