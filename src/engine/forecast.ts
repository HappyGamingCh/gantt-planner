// Forecast (SPEC §5.6), counted in half days (§5.1).
import type { Actuals } from './actuals';
import { dayOf, endOfDayOf, finishHalf, halfOf, morningOf, type Calendar, type Half } from './calendar';
import { finishFrom, halvesOf, linkHalf, type Planned } from './schedule';
import type { ISODate, Link, Task } from './types';

export interface Forecast {
  start: ISODate;
  finish: ISODate;
  /** Halves, as Planned's: a start milestone's f is the start of its half. */
  s: Half;
  f: Half;
}

/**
 * Remaining work of a task in progress, in halves (§5.6): `PD × (100 − Progress) %`, rounded up to a whole day when the
 * duration is whole days (so a plan of whole days forecasts as it always did), to half a day when it has a half.
 */
export function remainingHalves(duration: number, progress: number): number {
  const left = halvesOf(duration) * (100 - progress); // halves × percent left
  return Number.isInteger(duration) ? 2 * Math.max(1, Math.ceil(left / 200)) : Math.max(1, Math.ceil(left / 100));
}

export function computeForecast(
  order: readonly Task[],
  calcLinks: Map<number, Link[]>,
  planned: Map<number, Planned>,
  actuals: Map<number, Actuals>,
  statusDate: ISODate,
  cal: Calendar,
): Map<number, Forecast> {
  const r = halfOf(cal.nextWorkday(statusDate)); // R: the first half remaining work can happen in
  const forecast = new Map<number, Forecast>();
  const placed = (id: number) => ({ ...forecast.get(id)!, startMs: planned.get(id)!.startMs });

  for (const task of order) {
    const plan = planned.get(task.id)!;
    const act = actuals.get(task.id)!;
    const milestone = plan.duration === 0;
    let s: Half;
    let f: Half;

    if (act.calcStart !== undefined && act.calcFinish !== undefined) {
      // Completed: actual dates are whole days (§5.5).
      s = halfOf(act.calcStart);
      f = plan.startMs ? halfOf(act.calcFinish) : finishHalf(act.calcFinish);
    } else if (act.calcStart !== undefined) {
      // In progress: not moved by predecessors. Remaining work runs from R (or from a future actual start).
      s = halfOf(act.calcStart);
      const from = act.calcStart > statusDate ? cal.snapHalf(s) : r;
      if (milestone) f = plan.startMs ? from : endOfDayOf(from); // only a milestone with a future Actual Start (§5.5)
      else f = cal.addHalves(from, remainingHalves(plan.duration, act.progress) - 1);
    } else if (milestone && !plan.startMs) {
      // Not started, an end milestone (§5.4): the end of its planned finish half, R's day, and every link's.
      const sameDay = morningOf(plan.s) === morningOf(plan.f) && cal.snapHalf(plan.f) === plan.f;
      f = Math.max(sameDay ? plan.f : endOfDayOf(cal.snapHalf(plan.s)), endOfDayOf(r));
      for (const link of calcLinks.get(task.id) ?? []) f = Math.max(f, linkHalf(link, placed(link.predId), true, true, cal));
      s = morningOf(f);
    } else {
      // Not started: no earlier than its planned start, R, and every predecessor's forecast.
      s = Math.max(cal.snapHalf(plan.s), r);
      for (const link of calcLinks.get(task.id) ?? []) s = Math.max(s, linkHalf(link, placed(link.predId), false, milestone, cal));
      f = finishFrom(s, plan.duration, cal);
    }
    forecast.set(task.id, { start: dayOf(s), finish: dayOf(f), s, f });
  }
  return forecast;
}
