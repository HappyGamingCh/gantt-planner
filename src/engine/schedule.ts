// Planned schedule / baseline (SPEC §5.4).
import { MAX_DAYS } from '../config';
import type { Calendar } from './calendar';
import { makeIssue } from './issues';
import type { Change, ISODate, Issue, Link, Project, Task } from './types';

export interface Planned {
  start: ISODate;
  duration: number;
  finish: ISODate;
}

/**
 * Start milestones sit at the start of their day: milestones with no predecessors, or only start-milestone
 * predecessors (e.g. "Shutdown"). Any other milestone sits at the end of its predecessor's finish day.
 */
export function startMilestones(order: readonly Task[], calcLinks: Map<number, Link[]>): Set<number> {
  const result = new Set<number>();
  for (const task of order) {
    if (task.plannedDuration === 0 && (calcLinks.get(task.id) ?? []).every((l) => result.has(l.predId))) result.add(task.id);
  }
  return result;
}

/** FS gap: 0 into a milestone or out of a start milestone, else 1. */
export function fsGap(predIsStartMilestone: boolean, taskIsMilestone: boolean): number {
  return predIsStartMilestone || taskIsMilestone ? 0 : 1;
}

export function finishFrom(start: ISODate, duration: number, cal: Calendar): ISODate {
  return duration >= 1 ? cal.addWorkdays(start, duration - 1) : start;
}

/**
 * Plan mode derives every planned value from the inputs. Track mode keeps stored planned values
 * (frozen) and derives only blank ones — except tasks added this session, which behave as in Plan mode.
 */
export function schedulePlanned(
  order: readonly Task[],
  calcLinks: Map<number, Link[]>,
  startMs: ReadonlySet<number>,
  project: Project,
  cal: Calendar,
  issues: Issue[],
  changes: Change[],
): Map<number, Planned> {
  const planned = new Map<number, Planned>();

  for (const task of order) {
    const frozen = project.mode === 'Track' && !task.isNewThisSession;
    const change = (field: string, from: unknown, to: unknown, kind: Change['kind'], reason: string) =>
      changes.push({ taskId: task.id, field, from, to, kind, reason });

    // 1. Planned Start
    let start: ISODate;
    const links = calcLinks.get(task.id) ?? [];
    if (frozen && task.plannedStart !== undefined) {
      start = task.plannedStart;
    } else if (links.length > 0) {
      const taskIsMilestone = task.plannedDuration === 0; // blank duration counts as non-milestone
      start = links
        .map((link) => {
          const pred = planned.get(link.predId)!;
          return link.type === 'SS'
            ? cal.addWorkdays(pred.start, link.lag)
            : cal.addWorkdays(pred.finish, fsGap(startMs.has(link.predId), taskIsMilestone) + link.lag);
        })
        .reduce((a, b) => (a >= b ? a : b));
      if (task.plannedStart === undefined) {
        change('Planned Start', undefined, start, 'filled', 'Set by predecessors');
      } else if (task.plannedStart !== start) {
        change('Planned Start', task.plannedStart, start, 'corrected', 'Driven by predecessors — use lag to delay');
        issues.push(makeIssue('W_START_DRIVEN', { id: task.id }));
      }
    } else {
      start = cal.snapForward(task.plannedStart ?? project.projectStart);
      if (task.plannedStart === undefined) {
        change('Planned Start', undefined, start, 'filled', 'From Project Start');
      } else if (task.plannedStart !== start) {
        change('Planned Start', task.plannedStart, start, 'corrected', 'Moved to next working day');
        issues.push(makeIssue('W_NONWORKDAY', { id: task.id }));
      }
    }

    // 2. Planned Duration (above MAX_DAYS: invalid and treated as blank, so a typo can't stretch the plan for centuries)
    let duration: number;
    const stored = task.plannedDuration;
    const valid = stored !== undefined && stored >= 0 && stored <= MAX_DAYS;
    if (stored !== undefined && !valid) {
      issues.push(makeIssue('W_BAD_NUMBER', { id: task.id, text: String(stored), field: 'Planned Duration' }));
    }
    if (valid) {
      duration = stored;
    } else if (task.plannedFinish !== undefined && task.plannedFinish >= start) {
      duration = Math.max(1, cal.countWorkdays(start, task.plannedFinish));
      change('Planned Duration', undefined, duration, 'filled', 'From Planned Finish');
    } else {
      duration = 1;
      change('Planned Duration', undefined, duration, 'filled', 'No duration — set to 1 day');
      issues.push(makeIssue('W_NO_DURATION', { id: task.id }));
    }

    // 3. Planned Finish
    let finish: ISODate;
    if (frozen && task.plannedFinish !== undefined) {
      finish = task.plannedFinish;
    } else {
      finish = finishFrom(start, duration, cal);
      if (task.plannedFinish === undefined) {
        change('Planned Finish', undefined, finish, 'filled', 'From start and duration');
      } else if (task.plannedFinish !== finish) {
        change('Planned Finish', task.plannedFinish, finish, 'corrected', 'Recalculated from duration');
        issues.push(makeIssue('W_FINISH_RECALC', { id: task.id }));
      }
    }

    planned.set(task.id, { start, duration, finish });
  }
  return planned;
}
