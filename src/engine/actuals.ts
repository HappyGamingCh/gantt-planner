// Actual rules (SPEC §5.5). "For calculation" substitutes live in calcStart/calcFinish and are never written.
import type { Calendar } from './calendar';
import { isPlanDate } from './dates';
import { makeIssue } from './issues';
import type { Planned } from './schedule';
import type { Change, ISODate, Issue, Task } from './types';

export interface Actuals {
  progress: number; // written value
  actualStart?: ISODate; // written value
  calcStart?: ISODate;
  calcFinish?: ISODate; // set ⇔ completed (or treated as completed)
  actualDuration?: number;
}

export function applyActualRules(
  tasks: readonly Task[],
  planned: Map<number, Planned>,
  statusDate: ISODate,
  cal: Calendar,
  issues: Issue[],
  changes: Change[],
): Map<number, Actuals> {
  const result = new Map<number, Actuals>();

  for (const task of tasks) {
    const plan = planned.get(task.id)!;
    const isMilestone = plan.duration === 0;
    const { id } = task;
    const change = (field: string, from: unknown, to: unknown, kind: Change['kind'], reason: string) =>
      changes.push({ taskId: id, field, from, to, kind, reason });

    // An actual date outside 1950–2199 (e.g. a 2-digit year typed as 0026) is treated as blank (§4.7); it is still written back.
    const planDate = (value: ISODate | undefined, field: string) => {
      if (value === undefined || isPlanDate(value)) return value;
      issues.push(makeIssue('W_BAD_DATE', { id, text: value, field }));
      return undefined;
    };
    let actualStart = planDate(task.actualStart, 'Actual Start');
    const actualFinish = planDate(task.actualFinish, 'Actual Finish');

    // Progress: round, clamp to 0–100; Actual Finish set → 100.
    let progress = Number.isFinite(task.progress) ? Math.min(100, Math.max(0, Math.round(task.progress))) : 0;
    if (progress !== task.progress) {
      const clamped = !(task.progress >= 0 && task.progress <= 100);
      change('Progress (%)', task.progress, progress, 'corrected', clamped ? 'Kept within 0–100' : 'Rounded to a whole number');
      if (clamped) issues.push(makeIssue('W_PROGRESS_CLAMPED', { id, v: String(task.progress), c: progress }));
    }
    if (actualFinish !== undefined && progress !== 100) {
      change('Progress (%)', progress, 100, 'corrected', 'Actual Finish is set');
      progress = 100;
    }

    let writtenStart = task.actualStart;
    if (isMilestone && actualFinish !== undefined && actualStart === undefined) {
      actualStart = writtenStart = actualFinish;
      change('Actual Start', task.actualStart, actualStart, 'filled', 'Milestone: same as Actual Finish');
    }

    let calcStart = actualStart;
    let calcFinish = actualFinish;
    if (calcFinish !== undefined && calcStart === undefined) {
      issues.push(makeIssue('W_AF_NO_AS', { id }, { kind: 'setActualStart', taskId: id, value: calcFinish }));
      calcStart = calcFinish;
    }
    if (calcStart !== undefined && calcFinish !== undefined && calcFinish < calcStart) {
      issues.push(makeIssue('W_AF_BEFORE_AS', { id }));
      calcFinish = calcStart;
    }
    if (isMilestone && calcStart !== undefined && calcStart <= statusDate && calcFinish === undefined) {
      // A milestone with an entered Actual Start only, on or before SD: achieved that day (no substitute start reaches
      // here). A future one is more likely a forecast typed in the wrong column: W_FUTURE_ACTUAL only.
      issues.push(makeIssue('W_MS_NO_AF', { id }, { kind: 'setActualFinish', taskId: id, value: calcStart }));
      calcFinish = calcStart;
      if (progress !== 100) {
        change('Progress (%)', progress, 100, 'corrected', 'Milestone reached on its Actual Start');
        progress = 100;
      }
    }
    const assumed = plan.start < statusDate ? plan.start : statusDate; // start used when progress has none
    if (progress === 100 && calcFinish === undefined) {
      // With no start either, the fix also sets the start used for calculation, so applying it changes no number.
      const startToo = !isMilestone && calcStart === undefined;
      issues.push(
        makeIssue('W_100_NO_AF', { id }, { kind: 'setActualFinish', taskId: id, value: statusDate, ...(startToo ? { actualStart: assumed } : {}) }),
      );
      calcFinish = statusDate;
      if (isMilestone && calcStart === undefined) calcStart = statusDate;
    }
    if (progress > 0 && calcStart === undefined) {
      issues.push(makeIssue('W_PROGRESS_NO_AS', { id }, { kind: 'setActualStart', taskId: id, value: assumed }));
      calcStart = assumed;
    }
    if (calcStart !== undefined && calcFinish !== undefined && calcFinish < calcStart) {
      calcFinish = calcStart; // only when a substitute finish (status date) precedes a future start
    }
    if ((actualStart !== undefined && actualStart > statusDate) || (actualFinish !== undefined && actualFinish > statusDate)) {
      issues.push(makeIssue('W_FUTURE_ACTUAL', { id }));
    }

    let actualDuration: number | undefined;
    if (calcStart !== undefined) {
      if (isMilestone) actualDuration = 0;
      else if (calcFinish !== undefined) actualDuration = Math.max(1, cal.countWorkdays(calcStart, calcFinish));
      else if (calcStart <= statusDate) actualDuration = Math.max(1, cal.countWorkdays(calcStart, statusDate));
    }

    result.set(id, { progress, actualStart: writtenStart, calcStart, calcFinish, actualDuration });
  }
  return result;
}
