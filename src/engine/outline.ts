// Major tasks (SPEC §5.12): the outline the Levels describe, and each major task rolled up from its leaf tasks.
import type { Calendar } from './calendar';
import { mean } from './scurve';
import { taskStatus, taskVariance } from './status';
import type { Change, ISODate, Task, TaskCalc, TaskResult } from './types';

/** Deepest Level (§4.7): Excel's row grouping goes 7 deep, so Level − 1 always fits. */
export const MAX_LEVEL = 8;

/**
 * §4.7: each row's Level, normalized. A plan where no row has a Level is all Level 1 with nothing recorded. Otherwise a
 * blank takes the Level of the row below it (the last rows: of the row above), the first row is Level 1, and a row is
 * at most one Level deeper than the row above; a Change records each value the app fills in or corrects.
 */
export function normalizeLevels(tasks: readonly Task[], changes: Change[]): number[] {
  if (tasks.every((t) => t.level === undefined)) return tasks.map(() => 1);
  const clamped = tasks.map((t) => (t.level === undefined ? undefined : Math.min(MAX_LEVEL, Math.max(1, Math.round(t.level)))));
  const filled: (number | undefined)[] = [...clamped];
  for (let i = filled.length - 2; i >= 0; i--) filled[i] ??= filled[i + 1];
  const levels: number[] = [];
  tasks.forEach((task, i) => {
    const above = levels[i - 1];
    const wanted = filled[i] ?? above ?? 1;
    const level = above === undefined ? 1 : Math.min(wanted, above + 1);
    levels.push(level);
    if (level === task.level) return;
    let reason: string;
    if (task.level === undefined) reason = clamped.slice(i + 1).some((l) => l !== undefined) ? 'Same level as the row below' : 'Same level as the row above';
    else if (clamped[i] !== task.level) reason = `Level is a whole number from 1 to ${MAX_LEVEL}`;
    else if (above === undefined) reason = 'The first row is at Level 1';
    else reason = 'At most one level deeper than the row above';
    changes.push({ taskId: task.id, field: 'Level', from: task.level, to: level, kind: task.level === undefined ? 'filled' : 'corrected', reason });
  });
  return levels;
}

export interface Outline {
  /** Major tasks: rows the row below goes deeper under. */
  summaries: Set<number>;
  /** Major task → its leaf tasks (descendants that aren't major tasks), in row order. */
  leavesOf: Map<number, number[]>;
  /** Task → its major task (the nearest row above with a smaller Level); top-level rows have none. */
  parentOf: Map<number, number | undefined>;
}

/** The outline of rows in this order at these (normalized) Levels. */
export function outlineOf(tasks: readonly Pick<Task, 'id'>[], levels: readonly number[]): Outline {
  const summaries = new Set<number>();
  const leavesOf = new Map<number, number[]>();
  const parentOf = new Map<number, number | undefined>();
  const open: { id: number; level: number }[] = []; // the major tasks the current row is inside, outermost first
  tasks.forEach((task, i) => {
    const level = levels[i]!;
    while (open.length > 0 && open.at(-1)!.level >= level) open.pop();
    parentOf.set(task.id, open.at(-1)?.id);
    if ((levels[i + 1] ?? 0) > level) {
      summaries.add(task.id);
      leavesOf.set(task.id, []);
      open.push({ id: task.id, level });
    } else {
      for (const s of open) leavesOf.get(s.id)!.push(task.id);
    }
  });
  return { summaries, leavesOf, parentOf };
}

/** §5.12: a major task's values from its leaf tasks' results. */
export function rollUp(
  task: Task,
  level: number,
  leaves: readonly { r: TaskResult; calc: TaskCalc }[],
  statusDate: ISODate,
  cal: Calendar,
): TaskResult {
  const first = <T extends string>(values: (T | undefined)[]) => values.filter((v): v is T => v !== undefined).sort()[0];
  const last = <T extends string>(values: (T | undefined)[]) => values.filter((v): v is T => v !== undefined).sort().at(-1);
  const plannedStart = first(leaves.map((l) => l.r.plannedStart))!;
  const plannedFinish = last(leaves.map((l) => l.r.plannedFinish))!;
  const forecastFinish = last(leaves.map((l) => l.r.forecastFinish))!;
  const milestonesOnly = leaves.every((l) => l.calc.isMilestone);
  const work = leaves.filter((l) => !l.calc.isMilestone);
  const done = leaves.every((l) => l.calc.calcFinish !== undefined);
  const actualStart = first(leaves.map((l) => l.calc.calcStart));
  const actualFinish = done ? last(leaves.map((l) => l.calc.calcFinish)) : undefined;
  let actualDuration: number | undefined;
  if (actualStart !== undefined) {
    if (milestonesOnly) actualDuration = 0;
    else if (actualFinish !== undefined) actualDuration = Math.max(1, cal.countWorkdays(actualStart, actualFinish));
    else if (actualStart <= statusDate) actualDuration = Math.max(1, cal.countWorkdays(actualStart, statusDate));
  }
  const variance = taskVariance(plannedFinish, forecastFinish, cal);
  const started = actualStart !== undefined || leaves.some((l) => l.calc.progress > 0);
  const floats = leaves.map((l) => l.r.totalFloat).filter((f): f is number => f !== undefined);
  return {
    id: task.id,
    level,
    summary: { tasks: leaves.length, actualFinish },
    plannedStart,
    plannedDuration: milestonesOnly && plannedStart === plannedFinish ? 0 : cal.countWorkdays(plannedStart, plannedFinish),
    plannedFinish,
    progress: work.length > 0 ? Math.round(mean(work.map((l) => l.calc.progress))) : done ? 100 : 0,
    actualStart,
    actualDuration,
    forecastStart: first(leaves.map((l) => l.r.forecastStart))!,
    forecastFinish,
    variance,
    status: taskStatus(done, variance, started),
    predecessorsText: task.predecessorsText,
    links: [],
    successorsText: '',
    plannedPctAtSD: work.length > 0 ? mean(work.map((l) => l.r.plannedPctAtSD)) : 0,
    totalFloat: floats.length > 0 ? Math.min(...floats) : undefined,
    critical: leaves.some((l) => l.r.critical),
  };
}
