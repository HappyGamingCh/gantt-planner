// Status & variance (SPEC §5.7).
import type { Calendar } from './calendar';
import type { ISODate, Status } from './types';

/** Working days from Planned Finish to the actual/forecast finish; positive = late. */
export function taskVariance(plannedFinish: ISODate, finishRef: ISODate, cal: Calendar): number {
  return cal.workdayDiff(plannedFinish, finishRef);
}

export function taskStatus(completed: boolean, variance: number, started: boolean): Status {
  if (completed) return 'Completed';
  if (variance > 0) return 'Late';
  if (started) return 'In Progress';
  return 'Not Started';
}
