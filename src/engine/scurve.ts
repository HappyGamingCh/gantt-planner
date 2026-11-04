// S-curve data (SPEC §5.9) and the per-task curve values shared with progress metrics (§5.8).
// Linear segments are measured in working days with end-of-day values: day d includes the work of day d.
import type { Calendar } from './calendar';
import { fromDayNumber, toDayNumber } from './dates';
import type { ISODate, SCurvePoint, TaskCalc } from './types';

/** At most about this many points: a longer span (only absurd durations or lags make one) is sampled every few days. */
const MAX_POINTS = 2000;

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Share of the task's planned work done by the end of day d. */
export function plannedPct(t: Pick<TaskCalc, 'plannedStart' | 'plannedDuration' | 'plannedFinish'>, d: ISODate, cal: Calendar): number {
  if (d < t.plannedStart) return 0;
  if (d >= t.plannedFinish) return 100;
  return Math.min(100, (cal.countWorkdays(t.plannedStart, d) / Math.max(1, t.plannedDuration)) * 100);
}

/** Actual series value at d (d ≤ status date). */
export function actualPctAt(t: TaskCalc, d: ISODate, statusDate: ISODate, cal: Calendar): number {
  if (t.calcStart === undefined || d < t.calcStart) return 0;
  const end = t.calcFinish ?? statusDate;
  const endValue = t.calcFinish !== undefined ? 100 : t.progress;
  if (d >= end) return endValue;
  return (endValue * cal.countWorkdays(t.calcStart, d)) / Math.max(1, cal.countWorkdays(t.calcStart, end));
}

/** Forecast series value at d (d > status date). */
export function forecastPctAt(t: TaskCalc, d: ISODate, statusDate: ISODate, cal: Calendar): number {
  if (t.calcFinish !== undefined || d >= t.forecastFinish) return 100;
  if (t.calcStart !== undefined) {
    // In progress: from Progress at the status date to 100 at Forecast Finish, measured from R.
    const r = cal.nextWorkday(statusDate);
    return t.progress + ((100 - t.progress) * cal.countWorkdays(r, d)) / Math.max(1, cal.countWorkdays(r, t.forecastFinish));
  }
  if (d < t.forecastStart) return 0;
  return (100 * cal.countWorkdays(t.forecastStart, d)) / Math.max(1, cal.countWorkdays(t.forecastStart, t.forecastFinish));
}

/**
 * One point per working day from min(Planned Start, Actual Start) to max(Planned Finish, Forecast Finish),
 * plus the status date itself when it falls in range on a non-working day. Values are means over non-milestones.
 * A span longer than MAX_POINTS days is sampled every few days; the status date and the last day are always kept.
 */
export function buildSCurve(rows: readonly TaskCalc[], statusDate: ISODate, cal: Calendar): SCurvePoint[] {
  if (rows.length === 0) return [];
  const work = rows.filter((t) => !t.isMilestone);
  let start = rows[0].plannedStart;
  let end = rows[0].plannedFinish;
  for (const t of rows) {
    if (t.plannedStart < start) start = t.plannedStart;
    if (t.calcStart !== undefined && t.calcStart < start) start = t.calcStart;
    if (t.plannedFinish > end) end = t.plannedFinish;
    if (t.forecastFinish > end) end = t.forecastFinish;
  }

  const first = toDayNumber(start);
  const last = toDayNumber(end);
  const step = Math.max(1, Math.ceil((last - first + 1) / MAX_POINTS));
  const days: number[] = [];
  for (let n = first; n <= last; n += step) days.push(n);
  if (step > 1) {
    const sd = toDayNumber(statusDate);
    if (sd > first && sd < last && (sd - first) % step !== 0) days.push(sd);
    if ((last - first) % step !== 0) days.push(last);
    days.sort((a, b) => a - b);
  }

  const points: SCurvePoint[] = [];
  for (const n of days) {
    const d = fromDayNumber(n);
    if (!cal.isWorkday(d) && d !== statusDate) continue;
    const planned = mean(work.map((t) => plannedPct(t, d, cal)));
    const actual = d <= statusDate ? mean(work.map((t) => actualPctAt(t, d, statusDate, cal))) : null;
    const forecast = d < statusDate ? null : d === statusDate ? actual : mean(work.map((t) => forecastPctAt(t, d, statusDate, cal)));
    points.push({ date: d, planned, actual, forecast });
  }
  return points;
}
