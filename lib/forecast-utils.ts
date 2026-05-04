/**
 * Shared forecast computation — used by Sales Reports AND Usage Forecast.
 * Any change here affects both pages simultaneously, guaranteeing they match.
 */

export type ForecastSettings = {
  location_id?:     string;
  shift_type:       'lunch' | 'dinner';
  week_base_net:    number;
  growth_rate:      number;
  weight_mon: number; weight_tue: number; weight_wed: number; weight_thu: number;
  weight_fri: number; weight_sat: number; weight_sun: number;
  closed_weekdays?: string[];
};

export type ForecastOverride = {
  location_id?:  string;
  forecast_date: string;
  shift_type:    'lunch' | 'dinner';
  net_revenue:   number;
};

const DOW_WEIGHT_KEYS = [
  'weight_sun', 'weight_mon', 'weight_tue', 'weight_wed',
  'weight_thu', 'weight_fri', 'weight_sat',
] as const;

/** Compute Orderbird forecast for a single day/shift (mirrors Sales Reports logic exactly). */
export function computeDailyForecast(dateKey: string, s: ForecastSettings): number {
  if (!s.week_base_net) return 0;
  const d        = new Date(dateKey + 'T12:00:00Z');
  const today    = new Date();
  const refMs    = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const weeksAhead = Math.round((d.getTime() - refMs) / (7 * 24 * 3600 * 1000));
  const growth   = (1 + s.growth_rate / 100) ** Math.max(0, weeksAhead);
  const weight   = s[DOW_WEIGHT_KEYS[d.getUTCDay()]] as number;
  return s.week_base_net * weight * growth;
}

/**
 * Compute Simply / Orderbird ratio per location per shift-type
 * from quarterly shift_reports + delivery_reports — same algorithm as Sales Reports.
 *
 * @param qShiftRows  Rows from shift_reports for the quarter (with shift_type + z_report_number)
 * @param qDelivRows  Rows from delivery_reports for the quarter (with shift_type)
 * @returns { lunchRatio, dinnerRatio } per location_id
 */
export type ShiftRowLite = {
  location_id:     string;
  report_date:     string;
  shift_type:      'lunch' | 'dinner' | null;
  net_total:       number;
  z_report_number: string | null;
};

export type DelivRowLite = {
  location_id: string;
  report_date: string;
  shift_type:  'lunch' | 'dinner' | null;
  net_revenue: number;
};

export function computeSimplyRatios(
  qShiftRows: ShiftRowLite[],
  qDelivRows: DelivRowLite[],
): Record<string, { lunch: number; dinner: number }> {

  // ── Build per-location per-date OB lunch/dinner maps (same logic as Sales Reports) ──
  type GroupKey = string; // `${locId}:${date}`
  const byLocDate: Record<GroupKey, ShiftRowLite[]> = {};
  for (const r of qShiftRows) {
    const k = `${r.location_id}:${r.report_date}`;
    if (!byLocDate[k]) byLocDate[k] = [];
    byLocDate[k].push(r);
  }

  const obLunch:  Record<GroupKey, number> = {};
  const obDinner: Record<GroupKey, number> = {};

  for (const [key, shifts] of Object.entries(byLocDate)) {
    const allTagged = shifts.every(s => s.shift_type === 'lunch' || s.shift_type === 'dinner');
    if (allTagged) {
      for (const s of shifts) {
        if (s.shift_type === 'lunch')
          obLunch[key]  = (obLunch[key]  ?? 0) + (s.net_total ?? 0);
        else
          obDinner[key] = (obDinner[key] ?? 0) + (s.net_total ?? 0);
      }
    } else {
      // Legacy: sort ascending by Z-report number — first = lunch, second = dinner
      const sorted = [...shifts].sort(
        (a, b) => parseInt(a.z_report_number || '0', 10) - parseInt(b.z_report_number || '0', 10),
      );
      if (sorted[0]) obLunch[key]  = (obLunch[key]  ?? 0) + (sorted[0].net_total ?? 0);
      if (sorted[1]) obDinner[key] = (obDinner[key] ?? 0) + (sorted[1].net_total ?? 0);
    }
  }

  // ── Build delivery lunch/dinner maps ──
  const simLunch:  Record<GroupKey, number> = {};
  const simDinner: Record<GroupKey, number> = {};
  for (const r of qDelivRows) {
    const k = `${r.location_id}:${r.report_date}`;
    if (r.shift_type === 'dinner') simDinner[k] = (simDinner[k] ?? 0) + (r.net_revenue ?? 0);
    else                           simLunch[k]  = (simLunch[k]  ?? 0) + (r.net_revenue ?? 0);
  }

  // ── Compute per-location ratios (average of per-day ratios where both > 0) ──
  const locIds = [...new Set(qShiftRows.map(r => r.location_id))];
  const out: Record<string, { lunch: number; dinner: number }> = {};

  for (const locId of locIds) {
    const lRatios: number[] = [];
    const dRatios: number[] = [];

    for (const [key, simVal] of Object.entries(simLunch)) {
      if (!key.startsWith(locId + ':')) continue;
      const obVal = obLunch[key] ?? 0;
      if (obVal > 0 && simVal > 0) lRatios.push(simVal / obVal);
    }
    for (const [key, simVal] of Object.entries(simDinner)) {
      if (!key.startsWith(locId + ':')) continue;
      const obVal = obDinner[key] ?? 0;
      if (obVal > 0 && simVal > 0) dRatios.push(simVal / obVal);
    }

    out[locId] = {
      lunch:  lRatios.length  > 0 ? lRatios.reduce((a, b)  => a + b, 0) / lRatios.length  : 0,
      dinner: dRatios.length  > 0 ? dRatios.reduce((a, b) => a + b, 0) / dRatios.length : 0,
    };
  }

  return out;
}

/**
 * Compute the full daily total forecast for one location/day —
 * OB lunch forecast + OB dinner forecast + Simply lunch forecast + Simply dinner forecast.
 * Applies overrides and matches the Sales Reports Daily Total row exactly.
 */
export function computeDailyTotal(
  dateKey:       string,
  lunchSettings: ForecastSettings | undefined,
  dinnerSettings: ForecastSettings | undefined,
  lunchOverride: ForecastOverride | undefined,
  dinnerOverride: ForecastOverride | undefined,
  simplyRatios:  { lunch: number; dinner: number },
): number {
  const lOB = lunchOverride?.net_revenue
    ?? (lunchSettings ? computeDailyForecast(dateKey, lunchSettings) : 0);
  const dOB = dinnerOverride?.net_revenue
    ?? (dinnerSettings ? computeDailyForecast(dateKey, dinnerSettings) : 0);

  const lSimply = Math.round(lOB * simplyRatios.lunch);
  const dSimply = Math.round(dOB * simplyRatios.dinner);

  return lOB + dOB + lSimply + dSimply;
}

/** ISO date string for a Date object. */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Current quarter (1–4) and its start/end date keys. */
export function currentQuarterRange(): { quarter: number; year: number; qStart: string; qEnd: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  const QUARTER_MONTHS = [[1,2,3],[4,5,6],[7,8,9],[10,11,12]] as const;
  const [firstM, , lastM] = QUARTER_MONTHS[quarter - 1];
  const lastDay = new Date(year, lastM, 0).getDate();
  return {
    quarter,
    year,
    qStart: `${year}-${String(firstM).padStart(2, '0')}-01`,
    qEnd:   `${year}-${String(lastM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}
