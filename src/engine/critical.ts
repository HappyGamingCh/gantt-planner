// Critical path (SPEC §5.10): backward pass on the forecast network of tasks that are not completed, in half days.
import type { Actuals } from './actuals';
import { endOfDayOf, morningOf, type Calendar, type Half } from './calendar';
import type { Forecast } from './forecast';
import { fsGap, halvesOf, type Planned } from './schedule';
import type { Link, Task } from './types';

/**
 * Total float in working days for every task that is not completed (completed tasks are absent).
 * Late finishes start at the project forecast finish; each link from a task that is not completed
 * pulls its predecessor's late finish earlier (SS: only while the predecessor hasn't started), and the minimum wins.
 * A start milestone's late finish is a start, like its finish (§5.4): the project finish's day counts from its morning.
 */
export function computeTotalFloat(
  order: readonly Task[],
  calcLinks: Map<number, Link[]>,
  planned: Map<number, Planned>,
  actuals: Map<number, Actuals>,
  forecast: Map<number, Forecast>,
  cal: Calendar,
): Map<number, number> {
  const floats = new Map<number, number>();
  let projectFinish: Half | undefined;
  for (const [id, fc] of forecast) {
    const end = planned.get(id)!.startMs ? endOfDayOf(fc.f) : fc.f; // a start milestone's day, as its date counted
    if (projectFinish === undefined || end > projectFinish) projectFinish = end;
  }
  if (projectFinish === undefined) return floats;
  const last = projectFinish;

  const completed = (id: number) => actuals.get(id)!.calcFinish !== undefined;
  const lateFinish = new Map<number, Half>();
  const lateFinishOf = (id: number) => lateFinish.get(id) ?? (planned.get(id)!.startMs ? morningOf(last) : last);
  // Reverse topological order: every successor is settled before its predecessors.
  for (let i = order.length - 1; i >= 0; i--) {
    const task = order[i];
    if (completed(task.id)) continue;
    const plan = planned.get(task.id)!;
    const n = halvesOf(plan.duration);
    const lf = lateFinishOf(task.id);
    const ls = n >= 1 ? cal.addHalves(lf, -(n - 1)) : plan.startMs ? lf : morningOf(lf);
    floats.set(task.id, cal.halfDiff(forecast.get(task.id)!.f, lf) / 2);
    for (const link of calcLinks.get(task.id) ?? []) {
      if (completed(link.predId)) continue;
      // A started predecessor has met its SS links: its start is an actual and its finish moves no SS successor (§5.6).
      if (link.type === 'SS' && actuals.get(link.predId)!.calcStart !== undefined) continue;
      const pred = planned.get(link.predId)!;
      const lag = halvesOf(link.lag);
      let bound: Half;
      if (link.type === 'SS') {
        const predStart = cal.addHalves(ls, -lag);
        const m = halvesOf(pred.duration);
        bound = m >= 1 ? cal.addHalves(predStart, m - 1) : pred.startMs ? predStart : endOfDayOf(predStart);
      } else if (n === 0 && !plan.startMs) {
        // FS into an end milestone (gap 0): it sits at the end of its predecessor's finish half (§5.4).
        bound = cal.addHalves(pred.startMs ? morningOf(lf) : lf, -lag);
      } else {
        bound = cal.addHalves(ls, -(fsGap(pred.startMs, n === 0) + lag));
      }
      if (bound < lateFinishOf(link.predId)) lateFinish.set(link.predId, bound);
    }
  }
  return floats;
}
