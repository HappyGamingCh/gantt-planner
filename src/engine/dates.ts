// ISO date helpers. All arithmetic is in UTC day numbers, so results never depend on the local timezone.
import type { ISODate } from './types';

const MS_PER_DAY = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 (UTC). */
export function toDayNumber(d: ISODate): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / MS_PER_DAY;
}

/** Day numbers of 0100-01-01 and 9999-12-31: the span where both conversions are exact and the year has 4 digits. */
const MIN_DAY = -683_003;
const MAX_DAY = 2_932_896;

/** Clamped to years 0100–9999, so an absurd span gives an absurd but well-formed date instead of a RangeError. */
export function fromDayNumber(n: number): ISODate {
  return new Date(Math.min(MAX_DAY, Math.max(MIN_DAY, n)) * MS_PER_DAY).toISOString().slice(0, 10);
}

export function isISODate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** First and last date the plan accepts (SPEC §4.7); also the min/max of the app's date inputs. */
export const PLAN_DATE_MIN = '1950-01-01';
export const PLAN_DATE_MAX = '2199-12-31';

/** Dates the plan accepts (SPEC §4.7): 1950–2199, so a stray small number or a 2-digit year can't stretch the plan. */
export function isPlanDate(s: string): boolean {
  return isISODate(s) && s >= PLAN_DATE_MIN && s <= PLAN_DATE_MAX;
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromDayNumber(toDayNumber(d) + n);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(d: ISODate): number {
  return weekdayOf(toDayNumber(d));
}

/** Day of week of a day number (1970-01-01 was a Thursday). */
export function weekdayOf(dayNumber: number): number {
  return (((dayNumber + 4) % 7) + 7) % 7;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}
