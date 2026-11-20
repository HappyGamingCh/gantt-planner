// Working-day calendar (SPEC §5.1): the project's working weekdays (every day of the week unless set), except holidays.
// Days, and half days: a half is `day number × 2`, + 1 for the afternoon (Half, below).
import { fromDayNumber, isISODate, toDayNumber, weekdayOf } from './dates';
import type { ISODate } from './types';

/** A half working day (§5.1): day number × 2, + 1 for the afternoon. */
export type Half = number;

/** The morning of `d`, or its afternoon. */
export const halfOf = (d: ISODate, afternoon = false): Half => toDayNumber(d) * 2 + (afternoon ? 1 : 0);
/** The day a half is in. */
export const dayOf = (h: Half): ISODate => fromDayNumber(Math.floor(h / 2));
export const isAfternoon = (h: Half): boolean => (h & 1) === 1;
/** The morning of the half's day. */
export const morningOf = (h: Half): Half => h - (h & 1);
/** The afternoon of the half's day: the end of that day. */
export const endOfDayOf = (h: Half): Half => h | 1;
/** The half a task finishes in when it finishes on `d`: the afternoon, or the morning when it finishes at midday. */
export const finishHalf = (d: ISODate, midday = false): Half => halfOf(d, !midday);

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
  /** `h` if its day is a workday, else the morning of the next workday. */
  snapHalf(h: Half): Half;
  /**
   * Move `n` working halves forward (n > 0) or backward (n < 0) from `h`; a half on a non-working day first moves to the
   * same half of the next workday, as a date did (a finish on a Sunday counts as Monday's end).
   */
  addHalves(h: Half, n: number): Half;
  /** Working halves in [a, b] inclusive; 0 if b < a. */
  countHalves(a: Half, b: Half): number;
  /**
   * Signed working halves from a to b: 2 × workdayDiff of their days, plus b's half less a's (a morning is 0, an
   * afternoon 1). Two halves of the same kind (two finishes, two starts) are exactly twice workdayDiff apart.
   */
  halfDiff(a: Half, b: Half): number;
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

  /** From workday `n` (snapped first), `k` workdays forward (k > 0) or backward (k < 0). */
  const addNum = (n: number, k: number) => {
    let cur = snapNum(n);
    const step = k < 0 ? -1 : 1;
    for (let left = Math.abs(k); left > 0; ) {
      cur += step;
      if (isWorkdayNum(cur)) left--;
    }
    return cur;
  };
  const snapHalf = (h: Half) => (isWorkdayNum(Math.floor(h / 2)) ? h : snapNum(Math.floor(h / 2)) * 2);
  const countHalves = (a: Half, b: Half) => {
    if (b < a) return 0;
    const da = Math.floor(a / 2);
    const db = Math.floor(b / 2);
    // Whole days in [da, db], less the morning of da when a is its afternoon and the afternoon of db when b is its morning.
    return 2 * countNum(da, db) - (isAfternoon(a) && isWorkdayNum(da) ? 1 : 0) - (!isAfternoon(b) && isWorkdayNum(db) ? 1 : 0);
  };

  return {
    isWorkday: (d) => isWorkdayNum(toDayNumber(d)),
    snapForward: (d) => fromDayNumber(snapNum(toDayNumber(d))),
    nextWorkday: (d) => fromDayNumber(snapNum(toDayNumber(d) + 1)),
    addWorkdays: (d, n) => fromDayNumber(addNum(toDayNumber(d), n)),
    countWorkdays: (a, b) => countNum(toDayNumber(a), toDayNumber(b)),
    workdayDiff(a, b) {
      const an = toDayNumber(a);
      const bn = toDayNumber(b);
      if (bn > an) return countNum(an + 1, bn);
      if (bn < an) return -countNum(bn + 1, an);
      return 0;
    },
    snapHalf,
    addHalves(h, n) {
      const total = (h & 1) + n; // halves from the morning of h's day, which addNum snaps to a workday first
      const days = Math.floor(total / 2);
      return addNum(Math.floor(h / 2), days) * 2 + (total - days * 2);
    },
    countHalves,
    halfDiff(a, b) {
      const da = Math.floor(a / 2);
      const db = Math.floor(b / 2);
      const days = db > da ? countNum(da + 1, db) : db < da ? -countNum(db + 1, da) : 0;
      return 2 * days + (b & 1) - (a & 1);
    },
  };
}
