// Critical path (SPEC §5.10): backward pass on the forecast network of tasks that are not completed.
import type { Actuals } from './actuals';
import type { Calendar } from './calendar';
import type { Forecast } from './forecast';
import { finishFrom, fsGap, type Planned } from './schedule';
import type { ISODate, Link, Task } from './types';

/**
 * Total float in working days for every task that is not completed (completed tasks are absent).
 * Late finishes start at the project forecast finish; each link from a task that is not completed
 * pulls its predecessor's late finish earlier (SS: only while the predecessor hasn't started), and the minimum wins.
 */
export function computeTotalFloat(
  order: readonly Task[],
  calcLinks: Map<number, Link[]>,
  startMs: ReadonlySet<number>,
  planned: Map<number, Planned>,
  actuals: Map<number, Actuals>,
  forecast: Map<number, Forecast>,
  cal: Calendar,
): Map<number, number> {
  const floats = new Map<number, number>();
  let projectFinish: ISODate | undefined;
  for (const fc of forecast.values()) if (projectFinish === undefined || fc.finish > projectFinish) projectFinish = fc.finish;
  if (projectFinish === undefined) return floats;

  const completed = (id: number) => actuals.get(id)!.calcFinish !== undefined;
  const lateFinish = new Map<number, ISODate>();
  // Reverse topological order: every successor is settled before its predecessors.
  for (let i = order.length - 1; i >= 0; i--) {
    const task = order[i];
    if (completed(task.id)) continue;
    const duration = planned.get(task.id)!.duration;
    const lf = lateFinish.get(task.id) ?? projectFinish;
    const ls = duration >= 1 ? cal.addWorkdays(lf, -(duration - 1)) : lf;
    floats.set(task.id, cal.workdayDiff(forecast.get(task.id)!.finish, lf));
    for (const link of calcLinks.get(task.id) ?? []) {
      if (completed(link.predId)) continue;
      // A started predecessor has met its SS links: its start is an actual and its finish moves no SS successor (§5.6).
      if (link.type === 'SS' && actuals.get(link.predId)!.calcStart !== undefined) continue;
      const bound =
        link.type === 'SS'
          ? finishFrom(cal.addWorkdays(ls, -link.lag), planned.get(link.predId)!.duration, cal)
          : cal.addWorkdays(ls, -(fsGap(startMs.has(link.predId), duration === 0) + link.lag));
      if (bound < (lateFinish.get(link.predId) ?? projectFinish)) lateFinish.set(link.predId, bound);
    }
  }
  return floats;
}
