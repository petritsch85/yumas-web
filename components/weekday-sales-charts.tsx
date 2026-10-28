'use client';

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';

/**
 * Total net sales by weekday — every Monday side by side, every Tuesday, and so on.
 *
 * A week mixes a quiet Monday with a full Saturday, so a weekly total hides
 * which day moved. Seven small charts on one scale each show how one weekday
 * runs over the months; the dashed line is that weekday's median over the
 * period, so a day above or below it reads at a glance.
 */

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const BAR = '#2E7D32';

const eur = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 0 });
const short = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

export function WeekdaySalesCharts({ days, from, title }: {
  /** Total net sales per date, "2026-07-06" → 8.342. */
  days: Record<string, number>;
  /** First date shown, "2026-07-01". */
  from: string;
  title: string;
}) {
  const today = new Date().toISOString().slice(0, 10);

  /* Every date from `from` up to yesterday, so a closed day shows as an empty
     slot rather than vanishing, and today's half-finished takings stay out. */
  const byWeekday: { date: string; value: number }[][] = WEEKDAYS.map(() => []);
  for (const t = new Date(from + 'T12:00:00Z'); ; t.setUTCDate(t.getUTCDate() + 1)) {
    const d = t.toISOString().slice(0, 10);
    if (d >= today) break;
    byWeekday[(t.getUTCDay() + 6) % 7].push({ date: d, value: Math.round(days[d] ?? 0) });
  }

  /* One scale for all seven, so a Saturday bar and a Monday bar compare. */
  const max = Math.max(1, ...byWeekday.flat().map(p => p.value));

  return (
    <div className="mt-4 shrink-0">
      <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">{title}</div>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {byWeekday.map((points, i) => {
          const open = points.filter(p => p.value > 0);
          /* A shift that never runs on this weekday — lunch at the weekend — has
             nothing to show, so it gets no chart rather than an empty one. */
          if (!open.length) return null;
          /* The median, not the mean: one big event night (a Thursday at 6k)
             would otherwise pull the line above every ordinary week. */
          const sorted = open.map(p => p.value).sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          const avg = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
          const last = open.at(-1);
          return (
            <div key={WEEKDAYS[i]} className="border border-gray-200 rounded-xl bg-white shadow-sm px-3 pt-3 pb-1">
              <div className="flex items-baseline justify-between px-1">
                <span className="text-sm font-bold text-gray-800">{WEEKDAYS[i]}s</span>
                <span className="text-[11px] text-gray-500 tabular-nums">
                  Median {eur(avg)} €{last ? ` · last ${short(last.date)}: ${eur(last.value)} €` : ''}
                </span>
              </div>
              <div style={{ height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={points} margin={{ top: 10, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" tickFormatter={short} tick={{ fontSize: 10, fill: '#9ca3af' }}
                      tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" minTickGap={18} />
                    <YAxis domain={[0, max]} width={44} tick={{ fontSize: 10, fill: '#9ca3af' }}
                      tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k` : String(Math.round(v))} />
                    <Tooltip cursor={{ fill: 'rgba(15,23,42,0.05)' }}
                      formatter={(v) => [`${eur(Number(v))} €`, 'Total net sales']}
                      labelFormatter={l => new Date(String(l) + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                      contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e5e7eb' }} />
                    {avg > 0 && <ReferenceLine y={avg} stroke="#6b7280" strokeDasharray="4 3" />}
                    <Bar dataKey="value" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={18} />
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
