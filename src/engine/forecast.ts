// Forecast (SPEC §5.6).
import type { Actuals } from './actuals';
import type { Calendar } from './calendar';
import { finishFrom, fsGap, type Planned } from './schedule';
import type { ISODate, Link, Task } from './types';

export interface Forecast {
  start: ISODate;
  finish: ISODate;
}

export function computeForecast(
  order: readonly Task[],
  calcLinks: Map<number, Link[]>,
  startMs: ReadonlySet<number>,
  planned: Map<number, Planned>,
  actuals: Map<number, Actuals>,
  statusDate: ISODate,
  cal: Calendar,
): Map<number, Forecast> {
  const r = cal.nextWorkday(statusDate); // R: first day remaining work can happen
  const forecast = new Map<number, Forecast>();

  for (const task of order) {
    const plan = planned.get(task.id)!;
    const act = actuals.get(task.id)!;

    if (act.calcStart !== undefined && act.calcFinish !== undefined) {
      forecast.set(task.id, { start: act.calcStart, finish: act.calcFinish }); // completed
    } else if (act.calcStart !== undefined) {
      // In progress: not moved by predecessors. Remaining work runs from R (or from a future actual start).
      const remaining = Math.max(1, Math.ceil((plan.duration * (100 - act.progress)) / 100));
      const from = act.calcStart > statusDate ? cal.snapForward(act.calcStart) : r;
      forecast.set(task.id, { start: act.calcStart, finish: cal.addWorkdays(from, remaining - 1) });
    } else {
      // Not started: no earlier than its planned start, R, and every predecessor's forecast.
      let start = cal.snapForward(plan.start);
      if (r > start) start = r;
      for (const link of calcLinks.get(task.id) ?? []) {
        const pred = forecast.get(link.predId)!;
        const constraint =
          link.type === 'SS'
            ? cal.addWorkdays(pred.start, link.lag)
            : cal.addWorkdays(pred.finish, fsGap(startMs.has(link.predId), plan.duration === 0) + link.lag);
        if (constraint > start) start = constraint;
      }
      forecast.set(task.id, { start, finish: finishFrom(start, plan.duration, cal) });
    }
  }
  return forecast;
}
