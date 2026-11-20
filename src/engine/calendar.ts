// Working-day calendar (SPEC §5.1): the project's working weekdays (every day of the week unless set), except holidays.
import { fromDayNumber, isISODate, toDayNumber, weekdayOf } from './dates';
import type { ISODate } from './types';

export interface Calendar {
  isWorkday(d: ISODate): boolean;
  /** `d` if it is a workday, else the next workday after `d`. */
  snapForward(d: ISODate): ISODate;
  /** First workday strictly after `d`. */
  nextWorkday(d: ISODate): ISODate;
  /** Start at snapForward(d) and move `n` workdays forward (n > 0) or backward (n < 0). */
  addWorkdays(d: ISODate, n: number): ISODate;
  /** Workdays in [a, b] inclusive; 0 if b < a. */
  countWorkdays(a: ISODate, b: ISODate): number;
  /** Signed workdays from a to b: b > a → countWorkdays(a+1, b); b < a → −countWorkdays(b+1, a). */
  workdayDiff(a: ISODate, b: ISODate): number;
}

/** Every day of the week, 0 = Sunday … 6 = Saturday. */
export const ALL_WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * `workingDays`: the weekdays worked (0 = Sunday … 6 = Saturday); undefined, or a list with no weekday in it, means
 * every day of the week (§4.2, §5.1).
 */
export function createCalendar(holidays: readonly ISODate[], workingDays?: readonly number[]): Calendar {
  const worked = ALL_WEEKDAYS.map((w) => workingDays === undefined || workingDays.includes(w));
  if (!worked.includes(true)) worked.fill(true);
  /** Worked weekdays among the k days (k ≤ 7) that start on weekday `from`. */
  const workedIn = (from: number, k: number) => {
    let n = 0;
    for (let i = 0; i < k; i++) if (worked[(from + i) % 7]) n++;
    return n;
  };
  const perWeek = workedIn(0, 7);

  // Holidays on a worked weekday, sorted, for range counting: a holiday on a day off takes no working day away.
  const holidayDays = [...new Set(holidays.filter(isISODate).map(toDayNumber))].sort((a, b) => a - b);
  const holidaySet = new Set(holidayDays);
  const counted = holidayDays.filter((n) => worked[weekdayOf(n)]);

  const isWorkdayNum = (n: number) => worked[weekdayOf(n)]! && !holidaySet.has(n);
  const snapNum = (n: number) => {
    while (!isWorkdayNum(n)) n++;
    return n;
  };
  /** Index of the first counted holiday ≥ n. */
  const lowerBound = (n: number) => {
    let lo = 0;
    let hi = counted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (counted[mid]! < n) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const countNum = (a: number, b: number) => {
    if (b < a) return 0;
    const days = b - a + 1;
    return Math.floor(days / 7) * perWeek + workedIn(weekdayOf(a), days % 7) - (lowerBound(b + 1) - lowerBound(a));
  };

  return {
    isWorkday: (d) => isWorkdayNum(toDayNumber(d)),
    snapForward: (d) => fromDayNumber(snapNum(toDayNumber(d))),
    nextWorkday: (d) => fromDayNumber(snapNum(toDayNumber(d) + 1)),
    addWorkdays(d, n) {
      let cur = snapNum(toDayNumber(d));
      const step = n < 0 ? -1 : 1;
      for (let left = Math.abs(n); left > 0; ) {
        cur += step;
        if (isWorkdayNum(cur)) left--;
      }
      return fromDayNumber(cur);
    },
    countWorkdays: (a, b) => countNum(toDayNumber(a), toDayNumber(b)),
    workdayDiff(a, b) {
      const an = toDayNumber(a);
      const bn = toDayNumber(b);
      if (bn > an) return countNum(an + 1, bn);
      if (bn < an) return -countNum(bn + 1, an);
      return 0;
    },
  };
}
