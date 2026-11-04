import { describe, expect, it } from 'vitest';
import { MAX_DAYS } from '../../src/config';
import type { Task } from '../../src/engine/types';
import { makeTask, run } from './helpers';

// 1: Mon 2 – Fri 6 Nov, 40% done since 2 Nov.  2: FS after 1, 7–11 Nov.  3: milestone after 2.
// Status date Wed 4 Nov → R = Thu 5 Nov. Forecast: 1 ends Sat 7 Nov; 2 runs Sun 8 – Thu 12 Nov.
const tasks = (first: Partial<Task> = { actualStart: '2026-11-02', progress: 40 }) => [
  makeTask(1, { plannedDuration: 5, ...first }),
  makeTask(2, { predecessorsText: '1', plannedDuration: 5 }),
  makeTask(3, { predecessorsText: '2', plannedDuration: 0 }),
];
const curve = (first?: Partial<Task>, statusDate = '2026-11-04', holidays: string[] = []) =>
  run(tasks(first), { statusDate }, holidays);
const at = (points: ReturnType<typeof curve>['sCurve'], date: string) => {
  const p = points.find((x) => x.date === date);
  if (!p) throw new Error(`no point at ${date}`);
  return p;
};

describe('S-curve', () => {
  it('spans every working day from the earliest start to the latest planned/forecast finish', () => {
    const { sCurve } = curve();
    expect(sCurve[0]?.date).toBe('2026-11-02');
    expect(sCurve.at(-1)?.date).toBe('2026-11-12');
    expect(sCurve.map((p) => p.date)).toContain('2026-11-07'); // weekends are working days
    expect(sCurve).toHaveLength(11);
  });

  it('planned reaches 100 at the project planned finish', () => {
    const { sCurve } = curve();
    expect(at(sCurve, '2026-11-10').planned).toBeLessThan(100);
    expect(at(sCurve, '2026-11-11').planned).toBe(100);
    expect(at(sCurve, '2026-11-04').planned).toBeCloseTo(30, 10); // (60 + 0) / 2
  });

  it('actual at the status date equals mean progress; it is null afterwards', () => {
    const r = curve();
    expect(at(r.sCurve, '2026-11-04').actual).toBe(r.summary.actualPct);
    expect(r.summary.actualPct).toBe(20);
    expect(at(r.sCurve, '2026-11-02').actual).toBeCloseTo(40 / 3 / 2, 10); // linear from 0 to 40% over 2–4 Nov
    expect(at(r.sCurve, '2026-11-05').actual).toBeNull();
  });

  it('forecast joins actual at the status date and reaches 100 at the forecast finish', () => {
    const r = curve();
    expect(at(r.sCurve, '2026-11-03').forecast).toBeNull();
    expect(at(r.sCurve, '2026-11-04').forecast).toBe(at(r.sCurve, '2026-11-04').actual);
    expect(at(r.sCurve, '2026-11-05').forecast).toBeCloseTo(30, 10); // task 1: 40 → 100 over 5–7 Nov = 60; task 2: 0
    expect(at(r.sCurve, '2026-11-10').forecast).toBeCloseTo(80, 10); // task 1 done; task 2: 3 of 5 days
    expect(r.summary.forecastFinish).toBe('2026-11-12');
    expect(at(r.sCurve, '2026-11-11').forecast).toBeLessThan(100);
    expect(at(r.sCurve, '2026-11-12').forecast).toBe(100);
  });

  it('completed tasks rise linearly from Actual Start to Actual Finish', () => {
    const r = curve({ actualStart: '2026-11-02', actualFinish: '2026-11-04', progress: 100 }, '2026-11-05');
    expect(at(r.sCurve, '2026-11-03').actual).toBeCloseTo(((100 * 2) / 3 + 0) / 2, 10);
    expect(at(r.sCurve, '2026-11-05').actual).toBe(50);
    expect(at(r.sCurve, '2026-11-06').forecast).toBe(50); // task 1 stays 100, task 2 not started yet
  });

  it('samples a span of decades (absurd durations or lags), keeping the first day, the status date and the last day', () => {
    const r = run(
      [
        makeTask(1, { plannedDuration: MAX_DAYS, actualStart: '2026-11-02', progress: 1 }),
        makeTask(2, { predecessorsText: `1FS+${MAX_DAYS}`, plannedDuration: MAX_DAYS }),
      ],
      { statusDate: '2026-11-13' },
    );
    const dates = r.sCurve.map((p) => p.date);
    expect(r.sCurve.length).toBeLessThanOrEqual(2002);
    expect(dates[0]).toBe('2026-11-02');
    expect(dates.at(-1)).toBe(r.summary.forecastFinish);
    expect(dates).toContain('2026-11-13');
    expect([...dates].sort()).toEqual(dates);
    expect(at(r.sCurve, '2026-11-13').forecast).toBe(at(r.sCurve, '2026-11-13').actual);
    expect(r.sCurve.at(-1)?.forecast).toBe(100);
  });

  it(`a 200-task chain at the largest duration and lag (${MAX_DAYS} days) computes without throwing`, () => {
    const chain = Array.from({ length: 200 }, (_, i) =>
      makeTask(i + 1, { plannedDuration: MAX_DAYS, predecessorsText: i === 0 ? '' : `${i}FS+${MAX_DAYS}` }),
    );
    const r = run(chain);
    expect(r.issues).toEqual([]);
    expect(r.summary.plannedFinish).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.sCurve.length).toBeLessThanOrEqual(2002);
  });

  it('skips holidays but includes a status date that falls on one', () => {
    const r = curve(undefined, '2026-11-07', ['2026-11-07', '2026-11-09']);
    const sd = at(r.sCurve, '2026-11-07');
    expect(sd.actual).toBe(r.summary.actualPct);
    expect(sd.forecast).toBe(sd.actual);
    expect(at(r.sCurve, '2026-11-08').actual).toBeNull();
    expect(r.sCurve.map((p) => p.date)).not.toContain('2026-11-09');
  });
});
