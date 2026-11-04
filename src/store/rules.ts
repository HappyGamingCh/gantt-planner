// Field rules of a task edit (SPEC §6, §8): what a typed value becomes, what it fills in, and why it is refused.
// Pure (no store), so the grid, the drawer and the store say the same words.
import { MAX_DAYS } from '../config';
import { createCalendar } from '../engine/calendar';
import { isPlanDate } from '../engine/dates';
import type { ISODate, Plan, Project, Task, TaskResult } from '../engine/types';
import { cleanName } from '../excel/cells';
import { formatDayMonth } from '../ui/common/format';

/** Dates typed in the app must be ones the file can hold (§4.7). */
export const DATE_RANGE_MESSAGE = 'Enter a date between 1950 and 2199';
export const DURATION_MESSAGE = `Duration must be 0–${MAX_DAYS} days`;
const MILESTONE_CLEARED = 'Milestone not reached — actual dates cleared';

export type EditField =
  | 'name'
  | 'assigned'
  | 'predecessorsText'
  | 'plannedStart'
  | 'plannedDuration'
  | 'plannedFinish'
  | 'progress'
  | 'actualStart'
  | 'actualFinish'
  | 'remarks';

export type EditValue = string | number | string[] | undefined;

const BASELINE: readonly EditField[] = ['predecessorsText', 'plannedStart', 'plannedDuration', 'plannedFinish'];
const ACTUALS: readonly EditField[] = ['progress', 'actualStart', 'actualFinish'];
const DATE_FIELDS: readonly EditField[] = ['plannedStart', 'plannedFinish', 'actualStart', 'actualFinish'];

/** A major task's calculated values (§5.12): only its name and remarks are the user's. */
export const SUMMARY_CALCULATED = 'Calculated from its tasks.';

/** Why a field can't be edited in this mode (§6, §8), or null when it can. */
export function readOnlyReason(field: EditField, task: Task, r: TaskResult | undefined, mode: Project['mode']): string | null {
  if (r?.summary && field !== 'name' && field !== 'remarks') return SUMMARY_CALCULATED;
  if (mode === 'Track' && BASELINE.includes(field) && !task.isNewThisSession) return 'Switch to Plan mode to change the baseline.';
  if (mode === 'Plan' && ACTUALS.includes(field)) return 'Switch to Track mode to update progress.';
  if (field === 'plannedStart' && r && r.links.length > 0) return 'Set by predecessors — add lag to delay.';
  return null;
}

/** The patch one edit makes (§8), with the toast that explains it; no patch with a message = refused. */
export function editRules(task: Task, r: TaskResult | undefined, field: EditField, value: EditValue, plan: Plan): { patch?: Partial<Task>; message?: string } {
  const sd = plan.project.statusDate;
  const date = typeof value === 'string' && value !== '' ? value : undefined;
  if (date !== undefined && DATE_FIELDS.includes(field) && !isPlanDate(date)) return { message: DATE_RANGE_MESSAGE };
  switch (field) {
    case 'name': {
      const name = cleanName(String(value ?? ''));
      return name !== '' && name !== task.name ? { patch: { name } } : {};
    }
    case 'remarks': {
      const remarks = String(value ?? '').trim();
      return remarks !== task.remarks ? { patch: { remarks } } : {};
    }
    case 'assigned': {
      const seen = new Set<string>();
      const assigned = (Array.isArray(value) ? value : []).map(cleanName).filter((n) => n !== '' && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
      return assigned.join('\n') !== task.assigned.join('\n') ? { patch: { assigned } } : {};
    }
    case 'predecessorsText': {
      const text = String(value ?? '').trim();
      return text !== task.predecessorsText ? { patch: { predecessorsText: text } } : {};
    }
    case 'plannedStart':
      return { patch: { plannedStart: date } }; // blank: the task follows Project Start
    case 'plannedDuration': {
      const days = Math.round(Number(value));
      if (!Number.isFinite(days) || days < 0) return {};
      return days <= MAX_DAYS ? { patch: { plannedDuration: days } } : { message: DURATION_MESSAGE };
    }
    case 'plannedFinish': {
      if (!date || !r) return {};
      // §8: a finish before the start is refused (only Duration 0 makes a milestone); otherwise it sets the duration.
      if (date < r.plannedStart) return { message: `Finish can't be before the start (${formatDayMonth(r.plannedStart)}) — set Duration to 0 for a milestone` };
      const days = createCalendar(plan.holidays.map((h) => h.date)).countWorkdays(r.plannedStart, date);
      return days <= MAX_DAYS ? { patch: { plannedDuration: days } } : { message: DURATION_MESSAGE };
    }
    case 'progress':
      return progressRules(task, Number(value), sd, r?.plannedDuration === 0);
    case 'actualStart':
      return { patch: { actualStart: date } };
    case 'actualFinish': {
      if (date) {
        const patch: Partial<Task> = { actualFinish: date, progress: 100 }; // §8: Actual Finish entered → 100%
        // §8: a blank Actual Start = Actual Finish (the W_AF_NO_AS quick fix and the §5.5 calculation value, so no
        // number changes). A one-day task whose finish moves earlier takes its start along.
        const fillStart = !task.actualStart || (task.actualStart === task.actualFinish && date < task.actualStart);
        if (fillStart) patch.actualStart = date;
        return { patch, message: fillStart ? `Actual start set to ${formatDayMonth(date)} — change if needed` : undefined };
      }
      if (!task.actualFinish) return {};
      // §8: a milestone's Actual Start alone would mark it reached again (§5.5), so it goes too.
      if (r?.plannedDuration === 0) return { patch: { actualFinish: undefined, actualStart: undefined, progress: 0 }, message: MILESTONE_CLEARED };
      return r?.progress === 100
        ? { patch: { actualFinish: undefined, progress: 99 }, message: 'Progress set to 99% — the task has no actual finish' }
        : { patch: { actualFinish: undefined } };
    }
  }
}

/**
 * §8 Track auto-fills: progress > 0 sets Actual Start, 100% sets Actual Finish (both = status date when blank).
 * A milestone is reached or not: any progress above 0 is 100%, reached on its Actual Start when it has one; 0 clears
 * both actual dates (its Actual Start alone would mark it reached, §5.5).
 */
function progressRules(task: Task, value: number, sd: ISODate, milestone: boolean): { patch?: Partial<Task>; message?: string } {
  if (!Number.isFinite(value)) return {};
  const rounded = Math.min(100, Math.max(0, Math.round(value)));
  const progress = milestone && rounded > 0 ? 100 : rounded;
  const patch: Partial<Task> = { progress };
  if (milestone && progress === 0 && (task.actualStart || task.actualFinish)) {
    return { patch: { progress, actualStart: undefined, actualFinish: undefined }, message: MILESTONE_CLEARED };
  }
  if (progress < 100 && task.actualFinish) {
    // An unfinished task can't keep its Actual Finish (the engine would show 100% again).
    return { patch: { ...patch, actualFinish: undefined }, message: 'Actual finish cleared — the task is not complete' };
  }
  const filled: string[] = [];
  if (progress > 0 && !task.actualStart) {
    patch.actualStart = sd;
    filled.push('start');
  }
  if (progress === 100 && !task.actualFinish) {
    patch.actualFinish = milestone && task.actualStart ? task.actualStart : sd;
    filled.push('finish');
  }
  const date = patch.actualStart ?? patch.actualFinish ?? sd;
  return { patch, message: filled.length > 0 ? `Actual ${filled.join(' and ')} set to ${formatDayMonth(date)} — change if needed` : undefined };
}
