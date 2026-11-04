// Working-day calendar (SPEC §5.1): every day of the week except holidays.
import { fromDayNumber, isISODate, toDayNumber } from './dates';
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

export function createCalendar(holidays: readonly ISODate[]): Calendar {
  // Sorted for range counting.
  const holidayDays = [...new Set(holidays.filter(isISODate).map(toDayNumber))].sort((a, b) => a - b);
  const holidaySet = new Set(holidayDays);

  const isWorkdayNum = (n: number) => !holidaySet.has(n);
  const snapNum = (n: number) => {
    while (!isWorkdayNum(n)) n++;
    return n;
  };
  /** Index of the first holiday ≥ n. */
  const lowerBound = (n: number) => {
    let lo = 0;
    let hi = holidayDays.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (holidayDays[mid] < n) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const countNum = (a: number, b: number) => (b < a ? 0 : b - a + 1 - (lowerBound(b + 1) - lowerBound(a)));

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
