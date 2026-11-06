'use client';

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';

/**
 * Total net sales by weekday — every Monday side by side, every Tuesday, and so on.
 *
 * A week mixes a quiet Monday with a full Saturday, so a weekly total hides
 * which day moved. Seven small charts, each on its own scale, show how one weekday
 * runs over the months; the dashed line is that weekday's median over the
 * period, so a day above or below it reads at a glance.
 *
 * The forecast runs on from today in orange, the colour forecasts have
 * everywhere in the app. It never enters the median, the mean or the swing: those
 * say what has happened, and a forecast built from them would only be quoting itself.
 */

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const BAR = '#2E7D32';
const FORECAST_BAR = '#F59E0B';

const eur = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 0 });
const short = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

type Point = { date: string; value: number | null; forecast: number | null };

export function WeekdaySalesCharts({ days, forecast = {}, from, today, title }: {
  /** Total net sales per date, "2026-07-06" → 8.342. Today holds only the shifts already reported. */
  days: Record<string, number>;
  /** Forecast per date for what is not reported yet, from today on. */
  forecast?: Record<string, number>;
  /** First date shown, "2026-07-01". */
  from: string;
  today: string;
  title: string;
}) {
  /* Every date from `from` to the last forecast, so a closed day shows as an
     empty slot rather than vanishing. */
  const until = Object.keys(forecast).sort().at(-1) ?? today;
  const end = until > today ? until : today;
  const byWeekday: Point[][] = WEEKDAYS.map(() => []);
  for (const t = new Date(from + 'T12:00:00Z'); ; t.setUTCDate(t.getUTCDate() + 1)) {
    const d = t.toISOString().slice(0, 10);
    if (d > end) break;
    const value = days[d] ? Math.round(days[d]) : d < today ? 0 : null;
    const planned = forecast[d] ? Math.round(forecast[d]) : null;
    byWeekday[(t.getUTCDay() + 6) % 7].push({ date: d, value, forecast: planned });
  }

  return (
    <div className="mt-4 shrink-0">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="text-xs font-bold uppercase tracking-widest text-gray-500">{title}</div>
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: BAR }} /> Reported</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: FORECAST_BAR }} /> Forecast</span>
        </div>
      </div>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {byWeekday.map((points, i) => {
          /* Completed days only: today's takings are still coming in. */
          const open = points.filter(p => p.date < today && (p.value ?? 0) > 0);
          /* A shift that never runs on this weekday — lunch at the weekend — has
             nothing to show, so it gets no chart rather than an empty one. */
          if (!open.length && !points.some(p => p.forecast || p.value)) return null;
          /* The median, not the mean, draws the line: one big event night (a
             Thursday at 6k) would otherwise pull it above every ordinary week. */
          const sorted = open.map(p => p.value as number).sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          const avg = !sorted.length ? 0 : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
          const mean = sorted.length ? sorted.reduce((t, v) => t + v, 0) / sorted.length : 0;
          /* Swing: the typical distance from the median, as a share of it (the
             median absolute deviation). Like the line, it holds still for an event
             night, so it says how much an ordinary day varies. */
          const gaps = sorted.map(v => Math.abs(v - avg)).sort((a, b) => a - b);
          const gapMid = Math.floor(gaps.length / 2);
          const mad = !gaps.length ? 0 : gaps.length % 2 ? gaps[gapMid] : (gaps[gapMid - 1] + gaps[gapMid]) / 2;
          const swing = avg > 0 ? (mad / avg) * 100 : 0;
          return (
            <div key={WEEKDAYS[i]} className="border border-gray-200 rounded-xl bg-white shadow-sm px-3 pt-3 pb-1">
              <div className="flex items-baseline justify-between px-1">
                <span className="text-sm font-bold text-gray-800">{WEEKDAYS[i]}s</span>
                <span className="text-[11px] text-gray-500 tabular-nums">
                  {sorted.length
                    ? <>Median {eur(avg)} € · Mean {eur(mean)} € · <span title="How far a typical completed day lands from the median (median absolute deviation ÷ median)">Swing ±{Math.round(swing)}%</span></>
                    : 'Forecast only'}
                </span>
              </div>
              <div style={{ height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={points} margin={{ top: 10, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" tickFormatter={short} tick={{ fontSize: 10, fill: '#9ca3af' }}
                      tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" minTickGap={18} />
                    {/* Each chart on its own scale: one 4k event on a Sunday
                        must not flatten every other weekday's bars. */}
                    <YAxis domain={[0, 'auto']} width={44} tick={{ fontSize: 10, fill: '#9ca3af' }}
                      tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k` : String(Math.round(v))} />
                    <Tooltip cursor={{ fill: 'rgba(15,23,42,0.05)' }}
                      formatter={(v, name) => [`${eur(Number(v))} €`, name === 'forecast' ? 'Forecast' : 'Total net sales']}
                      labelFormatter={l => new Date(String(l) + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                      contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e5e7eb' }} />
                    {avg > 0 && <ReferenceLine y={avg} stroke="#6b7280" strokeDasharray="4 3" />}
                    {/* Stacked, because today can be both: lunch reported, dinner still forecast. */}
                    <Bar dataKey="value" stackId="day" fill={BAR} maxBarSize={18} />
                    <Bar dataKey="forecast" stackId="day" fill={FORECAST_BAR} radius={[4, 4, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
