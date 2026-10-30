import type { SupabaseClient } from '@supabase/supabase-js';
import { buildShiftClosedChecker } from '@/lib/opening-hours';
import type { TgtgLine } from '@/lib/tgtg-statement';

/**
 * File a month of Too Good To Go sales into tgtg_sales.
 *
 * The statement has one figure per store and bag type for the whole month, so
 * each is spread evenly over the days its shift was open that month — the
 * opening pattern and the one-off closures decide, the same rule the daily
 * sheet shades by. Replaces whatever the month held, so filing a corrected
 * statement again is safe.
 */
export async function importTgtgMonth(
  admin: SupabaseClient, month: string, lines: TgtgLine[], source: string,
): Promise<{ rows: number; gross: number; net: number; unknown: string[] }> {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);

  const { data: locs } = await admin.from('locations').select('id,name');
  const { data: settings } = await admin.from('forecast_settings').select('location_id,shift_type,closed_weekdays');
  const { data: closures } = await admin.from('closure_days').select('location_id,closure_date,shift_type,kind')
    .gte('closure_date', days[0]).lte('closure_date', days[days.length - 1]);
  const closed = buildShiftClosedChecker(settings ?? [], closures ?? []);

  const rows: Record<string, unknown>[] = [];
  const unknown: string[] = [];
  for (const l of lines) {
    const loc = (locs ?? []).find(x => String(x.name).toLowerCase() === l.store.toLowerCase());
    if (!loc) { unknown.push(l.store); continue; }
    const open = days.filter(d => !closed(String(loc.id), d, l.shift));
    const spread = open.length ? open : days;          // never lose the money
    /* Cents shared out so the days add up to the statement exactly. */
    const cents = Math.round(l.gross * 100), netCents = Math.round(l.net * 100);
    spread.forEach((d, i) => {
      const share = (total: number) => Math.floor(total / spread.length) + (i < total % spread.length ? 1 : 0);
      rows.push({
        location_id: loc.id, sale_date: d, shift: l.shift, month: `${month}-01`, source,
        bags: Math.round((l.bags / spread.length) * 1000) / 1000,
        gross: share(cents) / 100, net: share(netCents) / 100,
      });
    });
  }

  const { error: delErr } = await admin.from('tgtg_sales').delete().eq('month', `${month}-01`);
  if (delErr) throw new Error(delErr.message);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('tgtg_sales').insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  return {
    rows: rows.length,
    gross: lines.reduce((t, l) => t + l.gross, 0),
    net: lines.reduce((t, l) => t + l.net, 0),
    unknown,
  };
}
