import { describe, expect, it } from 'vitest';
import { createCalendar } from '../../src/engine/calendar';
import { addDays, dayOfWeek, fromDayNumber, isISODate, maxDate, minDate, toDayNumber } from '../../src/engine/dates';

// Every day of the week is a working day. Holidays: Wed 11 Nov, Sat 14 Nov, Sun 15 Nov.
const cal = createCalendar(['2026-11-11', '2026-11-14', '2026-11-15', 'not a date']);
const plain = createCalendar([]);

describe('dates', () => {
  it('converts day numbers both ways, across leap days and year ends', () => {
    expect(toDayNumber('1970-01-01')).toBe(0);
    expect(fromDayNumber(toDayNumber('2028-02-29'))).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('keeps an absurd day number to a well-formed date (years 0100–9999) instead of throwing', () => {
    expect(fromDayNumber(1e9)).toBe('9999-12-31');
    expect(fromDayNumber(-1e9)).toBe('0100-01-01');
    expect(fromDayNumber(toDayNumber('9999-12-31'))).toBe('9999-12-31');
    expect(fromDayNumber(toDayNumber('0100-01-01'))).toBe('0100-01-01');
    expect(addDays('2026-11-02', 3_000_000)).toBe('9999-12-31'); // not '+010240-…'
    expect(plain.addWorkdays('2026-11-02', -1_000_000)).toBe('0100-01-01');
  });

  it('validates ISO dates', () => {
    expect(isISODate('2028-02-29')).toBe(true);
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('26-11-02')).toBe(false);
  });

  it('gives the weekday and min/max', () => {
    expect(dayOfWeek('2026-11-02')).toBe(1); // Monday
    expect(dayOfWeek('2026-11-08')).toBe(0); // Sunday
    expect(dayOfWeek('1969-12-31')).toBe(3); // Wednesday, negative day number
    expect(minDate('2026-11-02', '2026-10-30')).toBe('2026-10-30');
    expect(maxDate('2026-11-02', '2026-10-30')).toBe('2026-11-02');
  });
});

describe('isWorkday', () => {
  it('includes weekends and excludes holidays', () => {
    expect(cal.isWorkday('2026-11-02')).toBe(true);
    expect(cal.isWorkday('2026-11-07')).toBe(true); // Sat
    expect(cal.isWorkday('2026-11-08')).toBe(true); // Sun
    expect(cal.isWorkday('2026-11-11')).toBe(false); // holiday
    expect(cal.isWorkday('2026-11-14')).toBe(false); // holiday on a Saturday
    expect(cal.isWorkday('2026-11-12')).toBe(true);
  });
});

describe('snapForward / nextWorkday', () => {
  it('snaps holidays forward and keeps weekends', () => {
    expect(cal.snapForward('2026-11-12')).toBe('2026-11-12');
    expect(cal.snapForward('2026-11-07')).toBe('2026-11-07');
    expect(cal.snapForward('2026-11-11')).toBe('2026-11-12');
    expect(cal.snapForward('2026-11-14')).toBe('2026-11-16'); // two holidays in a row
  });

  it('returns the first workday strictly after', () => {
    expect(cal.nextWorkday('2026-11-06')).toBe('2026-11-07');
    expect(cal.nextWorkday('2026-11-10')).toBe('2026-11-12');
    expect(cal.nextWorkday('2026-11-13')).toBe('2026-11-16');
  });
});

describe('addWorkdays', () => {
  it('moves forward skipping holidays', () => {
    expect(cal.addWorkdays('2026-11-02', 4)).toBe('2026-11-06');
    expect(cal.addWorkdays('2026-11-06', 1)).toBe('2026-11-07');
    expect(cal.addWorkdays('2026-11-10', 1)).toBe('2026-11-12');
    expect(cal.addWorkdays('2026-11-09', 5)).toBe('2026-11-17');
  });

  it('moves backward skipping holidays', () => {
    expect(cal.addWorkdays('2026-11-09', -1)).toBe('2026-11-08');
    expect(cal.addWorkdays('2026-11-12', -1)).toBe('2026-11-10');
    expect(cal.addWorkdays('2026-11-16', -1)).toBe('2026-11-13');
  });

  it('with n = 0 snaps forward', () => {
    expect(cal.addWorkdays('2026-11-06', 0)).toBe('2026-11-06');
    expect(cal.addWorkdays('2026-11-07', 0)).toBe('2026-11-07');
    expect(cal.addWorkdays('2026-11-11', 0)).toBe('2026-11-12');
  });

  it('starting on a holiday, snaps forward first, then moves', () => {
    expect(cal.addWorkdays('2026-11-14', 1)).toBe('2026-11-17');
    expect(cal.addWorkdays('2026-11-11', -1)).toBe('2026-11-10');
  });
});

describe('countWorkdays', () => {
  it('counts inclusive ranges, weekends included', () => {
    expect(plain.countWorkdays('2026-11-02', '2026-11-06')).toBe(5);
    expect(plain.countWorkdays('2026-11-02', '2026-11-08')).toBe(7);
    expect(plain.countWorkdays('2026-11-06', '2026-11-09')).toBe(4);
    expect(plain.countWorkdays('2026-11-02', '2026-11-02')).toBe(1);
    expect(plain.countWorkdays('2026-11-07', '2026-11-08')).toBe(2);
  });

  it('is 0 when b < a', () => {
    expect(plain.countWorkdays('2026-11-06', '2026-11-02')).toBe(0);
  });

  it('skips holidays', () => {
    expect(cal.countWorkdays('2026-11-09', '2026-11-13')).toBe(4);
    expect(cal.countWorkdays('2026-11-02', '2026-11-17')).toBe(13);
    expect(cal.countWorkdays('2026-11-11', '2026-11-11')).toBe(0);
    expect(cal.countWorkdays('2026-11-14', '2026-11-15')).toBe(0);
  });

  it('matches a day-by-day count over many ranges', () => {
    const holidays = ['2026-01-01', '2026-04-13', '2026-04-14', '2026-04-15', '2026-05-02', '2026-12-31', '2027-01-01'];
    const c = createCalendar(holidays);
    const brute = (a: string, b: string) => {
      let n = 0;
      for (let d = a; d <= b; d = addDays(d, 1)) if (c.isWorkday(d)) n++;
      return n;
    };
    let seed = 7;
    const rand = (max: number) => (seed = (seed * 48271) % 2147483647) % max;
    for (let i = 0; i < 300; i++) {
      const a = addDays('2025-12-01', rand(420));
      const b = addDays(a, rand(60) - 5);
      expect(c.countWorkdays(a, b)).toBe(b < a ? 0 : brute(a, b));
    }
  });
});

describe('workdayDiff', () => {
  it('is signed: positive forward, negative backward, 0 on the same day', () => {
    expect(plain.workdayDiff('2026-11-06', '2026-11-09')).toBe(3);
    expect(plain.workdayDiff('2026-11-09', '2026-11-06')).toBe(-3);
    expect(plain.workdayDiff('2026-11-02', '2026-11-06')).toBe(4);
    expect(plain.workdayDiff('2026-11-02', '2026-11-02')).toBe(0);
  });

  it('skips holidays', () => {
    expect(cal.workdayDiff('2026-11-10', '2026-11-12')).toBe(1);
    expect(cal.workdayDiff('2026-11-12', '2026-11-10')).toBe(-1);
    expect(cal.workdayDiff('2026-11-13', '2026-11-16')).toBe(1);
  });
});

// Working days of the week (§4.2, §5.1). Nov 2026: Mon 2, Sat 7, Sun 8; holidays Wed 11 Nov (worked) and Sun 15 Nov.
describe('working days of the week — SPEC §5.1', () => {
  const MON_FRI = [1, 2, 3, 4, 5];
  const MON_SAT = [1, 2, 3, 4, 5, 6];
  const week5 = createCalendar(['2026-11-11', '2026-11-15'], MON_FRI);
  const week6 = createCalendar([], MON_SAT);

  it('a weekday the project does not work is a non-working day, like a holiday', () => {
    expect(week5.isWorkday('2026-11-06')).toBe(true); // Fri
    expect(week5.isWorkday('2026-11-07')).toBe(false); // Sat
    expect(week5.isWorkday('2026-11-08')).toBe(false); // Sun
    expect(week5.isWorkday('2026-11-11')).toBe(false); // holiday on a worked day
    expect(week6.isWorkday('2026-11-07')).toBe(true);
    expect(week6.isWorkday('2026-11-08')).toBe(false);
  });

  it('snaps, steps and adds across weekends and holidays', () => {
    expect(week5.snapForward('2026-11-07')).toBe('2026-11-09');
    expect(week5.nextWorkday('2026-11-06')).toBe('2026-11-09');
    expect(week5.nextWorkday('2026-11-10')).toBe('2026-11-12'); // past the Wednesday holiday
    expect(week5.addWorkdays('2026-11-06', 1)).toBe('2026-11-09');
    expect(week5.addWorkdays('2026-11-02', 4)).toBe('2026-11-06');
    expect(week5.addWorkdays('2026-11-02', 9)).toBe('2026-11-16'); // the holiday on the 11th costs a day
    expect(week5.addWorkdays('2026-11-09', -1)).toBe('2026-11-06');
    expect(week5.addWorkdays('2026-11-08', 0)).toBe('2026-11-09');
    expect(week6.addWorkdays('2026-11-02', 6)).toBe('2026-11-09'); // Mon + 6 working days, Sunday skipped
  });

  it('counts working days in whole weeks and parts of weeks; a holiday on a day off costs nothing', () => {
    expect(week5.countWorkdays('2026-11-02', '2026-11-08')).toBe(5);
    expect(week5.countWorkdays('2026-11-02', '2026-11-15')).toBe(9); // 10 weekdays less Wed 11; Sun 15 was off anyway
    expect(week5.countWorkdays('2026-11-07', '2026-11-08')).toBe(0);
    expect(week5.countWorkdays('2026-11-06', '2026-11-09')).toBe(2);
    expect(week6.countWorkdays('2026-11-01', '2026-11-30')).toBe(25); // November 2026 has 5 Sundays
    expect(week5.workdayDiff('2026-11-06', '2026-11-09')).toBe(1);
    expect(week5.workdayDiff('2026-11-09', '2026-11-06')).toBe(-1);
  });

  it('one working day a week', () => {
    const mondays = createCalendar([], [1]);
    expect(mondays.addWorkdays('2026-11-02', 2)).toBe('2026-11-16');
    expect(mondays.countWorkdays('2026-11-01', '2026-11-30')).toBe(5);
    expect(mondays.snapForward('2026-11-03')).toBe('2026-11-09');
  });

  it('no working weekday at all, or a list without weekdays, counts every day (never an endless search)', () => {
    for (const days of [[], [9]]) {
      const c = createCalendar([], days);
      expect(c.isWorkday('2026-11-08')).toBe(true);
      expect(c.countWorkdays('2026-11-02', '2026-11-08')).toBe(7);
    }
    expect(createCalendar([], undefined).countWorkdays('2026-11-02', '2026-11-08')).toBe(7);
  });

  it('matches a day-by-day count for every pattern of working days', () => {
    const holidays = ['2026-01-01', '2026-04-13', '2026-04-14', '2026-04-15', '2026-05-02', '2026-05-03', '2026-12-31'];
    let seed = 11;
    const rand = (max: number) => (seed = (seed * 48271) % 2147483647) % max;
    for (let mask = 1; mask < 128; mask++) {
      const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => mask & (1 << d));
      const c = createCalendar(holidays, days);
      const brute = (a: string, b: string) => {
        let n = 0;
        for (let d = a; d <= b; d = addDays(d, 1)) if (c.isWorkday(d)) n++;
        return n;
      };
      for (let i = 0; i < 12; i++) {
        const a = addDays('2025-12-20', rand(420));
        const b = addDays(a, rand(40) - 3);
        expect(c.countWorkdays(a, b)).toBe(b < a ? 0 : brute(a, b));
        const n = rand(20) - 5;
        const moved = c.addWorkdays(a, n);
        expect(c.isWorkday(moved)).toBe(true);
        expect(c.workdayDiff(c.snapForward(a), moved)).toBe(n);
      }
    }
  });
});
