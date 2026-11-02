'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase-browser';
import { dailySalesActuals } from '@/lib/daily-sales-actuals';
import type { Snapshot } from '@/lib/forecast-snapshot';

/**
 * How good the forecast was — as it stood on the 1st, and as it stands now.
 *
 * Three figures per day:
 *  - Frozen: the month's forecast copied on the 1st and never touched again.
 *  - Latest: the live forecast, which bookings and adjustments keep moving.
 *    For a day that has passed it is the last forecast made before it.
 *  - Actual: what was reported, read fresh each time — Wolt's figures come in
 *    five days late, so a day's actual can still rise after it is shown.
 *
 * And two outlooks for the month: what has happened plus the frozen forecast
 * for the rest (how the month is doing against the plan made on the 1st), and
 * what has happened plus the latest forecast (the best estimate today).
 */

type Loc = { id: string; name: string };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const eur = (v: number) => Math.round(v).toLocaleString('de-DE');
const todayKey = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function Delta({ v, muted = false }: { v: number | null; muted?: boolean }) {
  if (v === null) return <span className="text-gray-300">—</span>;
  if (Math.abs(v) < 0.5) return <span className="text-gray-400">±0</span>;
  return <span className={`${v > 0 ? 'text-green-600' : 'text-red-500'} ${muted ? '' : 'font-semibold'}`}>{v > 0 ? '+' : '−'}{eur(Math.abs(v))}</span>;
}

export function ForecastChanges({ locations }: { locations: Loc[] }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => todayKey().slice(0, 7));
  const [scope, setScope] = useState<string>('group');
  const [shift, setShift] = useState<'day' | 'lunch' | 'dinner'>('day');
  const today = todayKey();
  const [y, mo] = month.split('-').map(Number);
  const days = useMemo(() => {
    const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  }, [month, y, mo]);
  const from = days[0], to = days[days.length - 1];

  const { data: snapshot, isLoading: snapLoading } = useQuery({
    queryKey: ['forecast-snapshot', month],
    queryFn: async () => {
      const r = await fetch(`/api/forecast-snapshot?month=${month}`);
      return ((await r.json()).snapshot ?? null) as Snapshot | null;
    },
  });
  const { data: latestRows = [] } = useQuery({
    queryKey: ['sales-forecasts-month', month],
    queryFn: async () => {
      const { data } = await supabase.from('sales_forecasts')
        .select('location_id,forecast_date,shift_type,net_total').gte('forecast_date', from).lte('forecast_date', to);
      return (data ?? []) as { location_id: string; forecast_date: string; shift_type: string; net_total: number }[];
    },
  });
  const { data: actuals = {}, isFetching: actualsLoading } = useQuery({
    queryKey: ['daily-sales-actuals', month, locations.map(l => l.id).join(',')],
    enabled: locations.length > 0,
    queryFn: () => dailySalesActuals(supabase, locations, from, to),
  });

  const [freezing, setFreezing] = useState(false);
  const freezeNow = async () => {
    setFreezing(true);
    try {
      const r = await fetch(`/api/forecast-snapshot?month=${month}`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) alert(j.error ?? 'Failed');
      await qc.invalidateQueries({ queryKey: ['forecast-snapshot', month] });
    } finally { setFreezing(false); }
  };

  /* Per scope (each restaurant and the group): frozen, latest and actual per day. */
  const table = useMemo(() => {
    const scopes = [{ id: 'group', name: 'Group' }, ...locations];
    const inScope = (sc: string, loc: string) => sc === 'group' ? locations.some(l => l.id === loc) : sc === loc;
    /* All day takes everything; a shift only what is booked to it. */
    const inShift = (s: string) => shift === 'day' || s === shift;
    const build = (sc: string) => {
      /* lastFc: the live forecast for the day as last made before it happened. */
      const frozen: Record<string, number> = {}, lastFc: Record<string, number> = {}, actual: Record<string, number> = {};
      for (const r of snapshot?.rows ?? []) if (inScope(sc, r.location_id) && inShift(r.shift_type)) frozen[r.forecast_date] = (frozen[r.forecast_date] ?? 0) + Number(r.net_total);
      for (const r of latestRows) if (inScope(sc, r.location_id) && inShift(r.shift_type)) lastFc[r.forecast_date] = (lastFc[r.forecast_date] ?? 0) + Number(r.net_total);
      for (const [k, v] of Object.entries(actuals)) {
        const [loc, d, sh] = k.split('|');
        if (!inScope(sc, loc) || !inShift(sh)) continue;
        /* A day that has passed is actual; for one still to come, sales already
           on the books (an event invoiced ahead) count towards its forecast,
           as the frozen snapshot counts them too. */
        if (d < today) actual[d] = (actual[d] ?? 0) + v;
        else lastFc[d] = (lastFc[d] ?? 0) + v;
      }
      /* The latest forecast of a day that has passed is what it took: the
         month's latest total then moves with every day reported, and equals
         the latest outlook. */
      const latest: Record<string, number> = {};
      for (const d of days) {
        const v = d < today ? actual[d] : lastFc[d];
        if (v) latest[d] = v;
      }
      const past = days.filter(d => d < today), rest = days.filter(d => d >= today);
      const sum = (m: Record<string, number>, ds: string[]) => ds.reduce((t, d) => t + (m[d] ?? 0), 0);
      return {
        frozen, latest, lastFc, actual,
        frozenTotal: sum(frozen, days),
        latestTotal: sum(latest, days),
        actualToDate: sum(actual, past),
        frozenToDate: sum(frozen, past),
        lastFcToDate: sum(lastFc, past),
        outlookFrozen: sum(actual, past) + sum(frozen, rest),
        outlookLatest: sum(actual, past) + sum(latest, rest),
      };
    };
    return Object.fromEntries(scopes.map(s => [s.id, { name: s.name, ...build(s.id) }]));
  }, [snapshot, latestRows, actuals, locations, days, today, shift]);

  const sel = table[scope];
  const monthStarted = today >= from;
  const th = 'px-3 py-2 text-right font-semibold whitespace-nowrap';
  const td = 'px-3 py-1.5 text-right tabular-nums whitespace-nowrap';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-6">
      {/* Month and freeze status */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 border border-gray-200 rounded-lg bg-white">
          <button onClick={() => setMonth(m => shiftMonth(m, -1))} className="p-1.5 text-gray-500 hover:text-gray-800"><ChevronLeft size={15} /></button>
          <span className="text-sm font-semibold text-gray-800 w-32 text-center">{MONTHS[mo - 1]} {y}</span>
          <button onClick={() => setMonth(m => shiftMonth(m, 1))} className="p-1.5 text-gray-500 hover:text-gray-800"><ChevronRight size={15} /></button>
        </div>
        {snapLoading ? null : snapshot ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <Lock size={12} className="text-gray-500" />
            Frozen on {new Date(snapshot.frozenAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 text-xs text-amber-700">
            Not frozen yet{monthStarted ? '' : ' — happens automatically on the 1st'}
            <button onClick={freezeNow} disabled={freezing}
              className="px-2.5 py-1 rounded-md border border-amber-300 bg-amber-50 font-semibold hover:bg-amber-100 disabled:opacity-50">
              {freezing ? 'Freezing…' : 'Freeze now'}
            </button>
          </span>
        )}
        {actualsLoading && <span className="text-xs text-gray-400">Loading actuals…</span>}
      </div>

      {/* The month at a glance, every scope */}
      <div className="border border-gray-200 rounded-xl overflow-x-auto bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 text-gray-200">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">{MONTHS[mo - 1]}{shift !== 'day' ? ` · ${shift === 'lunch' ? 'Lunch' : 'Dinner'}` : ''}</th>
              <th className={th}>Forecast on the 1st (frozen)</th>
              <th className={th}>Actual to yesterday</th>
              <th className={th}>vs. frozen to yesterday</th>
              <th className={th}>Outlook · frozen<span className="block font-normal text-[10px] text-gray-400">actual + frozen rest of month</span></th>
              <th className={th}>Outlook · latest<span className="block font-normal text-[10px] text-gray-400">actual + latest forecast</span></th>
              <th className={th}>Latest outlook vs. 1st</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(table).map(([id, s]) => (
              <tr key={id} onClick={() => setScope(id)}
                className={`border-b border-gray-100 cursor-pointer ${scope === id ? 'bg-blue-50/60' : 'hover:bg-gray-50'} ${id === 'group' ? 'font-bold' : ''}`}>
                <td className="px-3 py-1.5 text-left text-gray-800">{s.name}</td>
                <td className={td}>{snapshot ? eur(s.frozenTotal) : <span className="text-gray-300">—</span>}</td>
                <td className={`${td} text-blue-700`}>{s.actualToDate ? eur(s.actualToDate) : <span className="text-gray-300">—</span>}</td>
                <td className={td}><Delta v={snapshot && s.actualToDate ? s.actualToDate - s.frozenToDate : null} /></td>
                <td className={td}>{snapshot ? eur(s.outlookFrozen) : <span className="text-gray-300">—</span>}</td>
                <td className={`${td} text-orange-600`}>{eur(s.outlookLatest)}</td>
                <td className={td}><Delta v={snapshot ? s.outlookLatest - s.frozenTotal : null} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Day by day, for the scope picked above */}
      <div className="flex items-center gap-2 flex-wrap">
        {Object.entries(table).map(([id, s]) => (
          <button key={id} onClick={() => setScope(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${scope === id ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
            {s.name}
          </button>
        ))}
        <span className="w-px h-6 bg-gray-200 mx-1" />
        {([['day', 'All day'], ['lunch', 'Lunch'], ['dinner', 'Dinner']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setShift(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${shift === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="border border-gray-200 rounded-xl overflow-x-auto bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 text-gray-200 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Day</th>
              <th className={th}>Forecast on the 1st</th>
              <th className={th}>Latest forecast</th>
              <th className={th}>Forecast change</th>
              <th className={th}>Actual</th>
              <th className={th}>Actual vs. 1st</th>
              <th className={th}>Actual vs. last forecast<span className="block font-normal text-[10px] text-gray-400">as forecast the day before</span></th>
            </tr>
          </thead>
          <tbody>
            {days.map(d => {
              const fz = sel.frozen[d], lt = sel.latest[d], lf = sel.lastFc[d], ac = d < today ? sel.actual[d] : undefined;
              const isToday = d === today;
              return (
                <tr key={d} className={`border-b border-gray-100 ${isToday ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-3 py-1.5 text-left whitespace-nowrap text-gray-700">
                    <span className="text-gray-400 w-6 inline-block">{WD[new Date(d + 'T12:00:00Z').getUTCDay()]}</span>
                    {d.slice(8)}.{d.slice(5, 7)}.{isToday ? <span className="ml-1.5 text-[10px] text-blue-600 font-semibold">today</span> : null}
                  </td>
                  <td className={`${td} text-gray-700`}>{snapshot && fz ? eur(fz) : <span className="text-gray-300">—</span>}</td>
                  <td className={`${td} ${ac !== undefined ? 'text-blue-700' : 'text-orange-600 italic'}`}>{lt ? eur(lt) : <span className="text-gray-300">—</span>}</td>
                  <td className={td}><Delta v={snapshot && (fz || lt) ? (lt ?? 0) - (fz ?? 0) : null} muted /></td>
                  <td className={`${td} text-blue-700`}>{ac ? eur(ac) : <span className="text-gray-300">—</span>}</td>
                  <td className={td}><Delta v={snapshot && ac !== undefined ? (ac ?? 0) - (fz ?? 0) : null} /></td>
                  <td className={td}><Delta v={ac !== undefined ? (ac ?? 0) - (lf ?? 0) : null} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-bold border-t-2 border-gray-300">
              <td className="px-3 py-2 text-left">Month</td>
              <td className={td}>{snapshot ? eur(sel.frozenTotal) : '—'}</td>
              <td className={`${td} text-orange-600`}>{eur(sel.latestTotal)}</td>
              <td className={td}><Delta v={snapshot ? sel.latestTotal - sel.frozenTotal : null} /></td>
              <td className={`${td} text-blue-700`}>{sel.actualToDate ? eur(sel.actualToDate) : '—'}</td>
              <td className={td}><Delta v={snapshot && sel.actualToDate ? sel.actualToDate - sel.frozenToDate : null} /></td>
              <td className={td}><Delta v={sel.actualToDate ? sel.actualToDate - sel.lastFcToDate : null} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11px] text-gray-500 leading-relaxed">
        Green = better than forecast (upgrade), red = worse (downgrade). Actuals are recalculated every time this opens —
        Wolt and Lieferando figures arrive a few days late and can still raise a day afterwards. The frozen forecast is
        saved automatically in the night to the 1st and never changed after that.
      </p>
    </div>
  );
}
