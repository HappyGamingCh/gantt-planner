// Status & variance (SPEC §5.7).
import { dayOf, type Calendar, type Half } from './calendar';
import type { Status } from './types';

/**
 * Working days from Planned Finish to the actual/forecast finish (halves ÷ 2); positive = late. A completed task
 * compares days: actual dates are whole days, so a 0.5-day task finished on its planned day is on time.
 */
export function taskVariance(plannedFinish: Half, finishRef: Half, completed: boolean, cal: Calendar): number {
  return completed ? cal.workdayDiff(dayOf(plannedFinish), dayOf(finishRef)) : cal.halfDiff(plannedFinish, finishRef) / 2;
}

export function taskStatus(completed: boolean, variance: number, started: boolean): Status {
  if (completed) return 'Completed';
  if (variance > 0) return 'Late';
  if (started) return 'In Progress';
  return 'Not Started';
}
