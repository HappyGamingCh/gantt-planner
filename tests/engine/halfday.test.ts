// Half-day durations (SPEC §5.1, §5.4–§5.10): durations and lags in steps of 0.5; whole-day plans as before.
import { describe, expect, it } from 'vitest';
import { createCalendar, dayOf, endOfDayOf, finishHalf, halfOf, isAfternoon, morningOf } from '../../src/engine/calendar';
import { compute } from '../../src/engine/compute';
import { remainingHalves } from '../../src/engine/forecast';
import { plannedPct } from '../../src/engine/scurve';
import { issuesOf, makeProject, makeTask, run, taskOf } from './helpers';

// Mon 2 Nov 2026 … ; every day is a working day unless a test passes holidays or working days.
const MON = '2026-11-02';
const TUE = '2026-11-03';
const WED = '2026-11-04';

describe('half-day calendar (§5.1)', () => {
  const cal = createCalendar(['2026-11-04']); // Wed off
  it('numbers halves: day × 2, + 1 for the afternoon', () => {
    expect(halfOf(MON, true) - halfOf(MON)).toBe(1);
    expect(dayOf(halfOf(TUE, true))).toBe(TUE);
    expect(isAfternoon(halfOf(TUE, true))).toBe(true);
    expect(morningOf(halfOf(TUE, true))).toBe(halfOf(TUE));
    expect(endOfDayOf(halfOf(TUE))).toBe(halfOf(TUE, true));
    expect(finishHalf(TUE)).toBe(halfOf(TUE, true));
    expect(finishHalf(TUE, true)).toBe(halfOf(TUE));
    // Dates before 1970 have negative day numbers.
    expect(dayOf(halfOf('1960-05-17', true))).toBe('1960-05-17');
    expect(isAfternoon(halfOf('1960-05-17', true))).toBe(true);
  });

  it('snapHalf: a non-working day moves to the next working morning', () => {
    expect(cal.snapHalf(halfOf(TUE, true))).toBe(halfOf(TUE, true));
    expect(cal.snapHalf(halfOf(WED, true))).toBe(halfOf('2026-11-05'));
  });

  it('addHalves skips non-working days and keeps the half when it starts on one', () => {
    expect(cal.addHalves(halfOf(TUE), 1)).toBe(halfOf(TUE, true));
    expect(cal.addHalves(halfOf(TUE, true), 1)).toBe(halfOf('2026-11-05'));
    expect(cal.addHalves(halfOf(TUE, true), 3)).toBe(halfOf('2026-11-06'));
    expect(cal.addHalves(halfOf('2026-11-05'), -1)).toBe(halfOf(TUE, true));
    expect(cal.addHalves(halfOf('2026-11-05', true), -3)).toBe(halfOf(TUE));
    // A finish on a non-working day counts as the next workday's end, as addWorkdays snapped a date.
    expect(cal.addHalves(halfOf(WED, true), 0)).toBe(halfOf('2026-11-05', true));
    expect(cal.addHalves(halfOf(WED, true), 1)).toBe(halfOf('2026-11-06'));
  });

  it('countHalves counts working halves in a range', () => {
    expect(cal.countHalves(halfOf(MON), halfOf(MON))).toBe(1);
    expect(cal.countHalves(halfOf(MON, true), halfOf(TUE))).toBe(2);
    expect(cal.countHalves(halfOf(MON), halfOf('2026-11-05', true))).toBe(6); // Wed off
    expect(cal.countHalves(halfOf(TUE, true), halfOf(MON))).toBe(0);
    expect(cal.countHalves(halfOf(WED), halfOf(WED, true))).toBe(0);
  });

  it('halfDiff is twice workdayDiff between halves of one kind, with the half difference otherwise', () => {
    const days = (a: string, b: string) => cal.workdayDiff(a, b);
    for (const [a, b] of [[MON, '2026-11-06'], ['2026-11-06', MON], [WED, '2026-11-08'], [TUE, WED], [MON, MON]] as const) {
      expect(cal.halfDiff(halfOf(a), halfOf(b))).toBe(2 * days(a, b));
      expect(cal.halfDiff(halfOf(a, true), halfOf(b, true))).toBe(2 * days(a, b));
    }
    expect(cal.halfDiff(halfOf(MON), halfOf(MON, true))).toBe(1);
    expect(cal.halfDiff(halfOf(MON, true), halfOf(TUE))).toBe(1);
    expect(cal.halfDiff(halfOf(TUE), halfOf(MON, true))).toBe(-1);
  });
});

describe('planned schedule in half days (§5.4 example)', () => {
  const result = run([
    makeTask(1, { plannedStart: MON, plannedDuration: 0.5 }),
    makeTask(2, { plannedDuration: 0.5, predecessorsText: '1' }),
    makeTask(3, { plannedDuration: 1, predecessorsText: '2' }),
    makeTask(4, { plannedStart: MON, plannedDuration: 1.5 }),
    makeTask(5, { plannedDuration: 1, predecessorsText: '4' }),
    makeTask(6, { plannedDuration: 1, predecessorsText: '4+0.5' }),
    makeTask(7, { plannedDuration: 0, predecessorsText: '1' }),
    makeTask(8, { plannedDuration: 1, predecessorsText: '7' }),
    makeTask(9, { plannedDuration: 1, predecessorsText: '4SS+0.5' }),
  ]);

  it('two 0.5-day tasks share a day: morning, then afternoon', () => {
    expect(taskOf(result, 1)).toMatchObject({ plannedStart: MON, plannedFinish: MON, plannedFinishMidday: true, plannedDuration: 0.5 });
    expect(taskOf(result, 1).plannedStartPM).toBeUndefined();
    expect(taskOf(result, 2)).toMatchObject({ plannedStart: MON, plannedStartPM: true, plannedFinish: MON });
    expect(taskOf(result, 2).plannedFinishMidday).toBeUndefined();
    expect(taskOf(result, 3)).toMatchObject({ plannedStart: TUE, plannedFinish: TUE });
  });

  it('1.5 days finish at midday; FS goes on in the afternoon, a half-day lag the next morning', () => {
    expect(taskOf(result, 4)).toMatchObject({ plannedFinish: TUE, plannedFinishMidday: true });
    expect(taskOf(result, 5)).toMatchObject({ plannedStart: TUE, plannedStartPM: true, plannedFinish: WED, plannedFinishMidday: true });
    expect(taskOf(result, 6)).toMatchObject({ plannedStart: WED, plannedFinish: WED });
    expect(taskOf(result, 6).plannedStartPM).toBeUndefined();
    expect(taskOf(result, 9)).toMatchObject({ plannedStart: MON, plannedStartPM: true, plannedFinish: TUE, plannedFinishMidday: true });
  });

  it('a milestone after a midday finish sits at midday, and its successor starts that afternoon', () => {
    expect(taskOf(result, 7)).toMatchObject({ plannedStart: MON, plannedFinish: MON, plannedFinishMidday: true });
    expect(taskOf(result, 7).plannedStartPM).toBeUndefined();
    expect(taskOf(result, 8)).toMatchObject({ plannedStart: MON, plannedStartPM: true, plannedFinish: TUE, plannedFinishMidday: true });
  });

  it('records half days in Changes as words', () => {
    const start = result.changes.find((c) => c.taskId === 2 && c.field === 'Planned Start');
    expect(start).toMatchObject({ from: undefined, to: `${MON} afternoon`, kind: 'filled' });
    const finish = result.changes.find((c) => c.taskId === 1 && c.field === 'Planned Finish');
    expect(finish).toMatchObject({ to: `${MON} midday` });
  });
});

describe('root tasks and stored halves', () => {
  it('an afternoon Planned Start starts the task that afternoon', () => {
    const r = taskOf(run([makeTask(1, { plannedStart: MON, plannedStartPM: true, plannedDuration: 1 })]), 1);
    expect(r).toMatchObject({ plannedStart: MON, plannedStartPM: true, plannedFinish: TUE, plannedFinishMidday: true });
  });

  it('an afternoon start on a non-working day moves to the next working morning', () => {
    const result = run([makeTask(1, { plannedStart: MON, plannedStartPM: true, plannedDuration: 1 })], {}, [MON]);
    expect(taskOf(result, 1)).toMatchObject({ plannedStart: TUE, plannedFinish: TUE });
    expect(taskOf(result, 1).plannedStartPM).toBeUndefined();
    expect(issuesOf(result, 1)).toContain('W_NONWORKDAY');
    expect(result.changes.find((c) => c.field === 'Planned Start')).toMatchObject({ from: `${MON} afternoon`, to: TUE });
  });

  it('a blank duration comes from a midday finish in half days', () => {
    const result = run([makeTask(1, { plannedStart: MON, plannedFinish: TUE, plannedFinishMidday: true })]);
    expect(taskOf(result, 1)).toMatchObject({ plannedDuration: 1.5, plannedFinish: TUE, plannedFinishMidday: true });
  });

  it('a stored finish that differs only by its half is recalculated', () => {
    const result = run([makeTask(1, { plannedStart: MON, plannedDuration: 1, plannedFinish: MON, plannedFinishMidday: true })]);
    expect(issuesOf(result, 1)).toContain('W_FINISH_RECALC');
    expect(result.changes.find((c) => c.field === 'Planned Finish')).toMatchObject({ from: `${MON} midday`, to: MON });
  });

  it('Track mode keeps stored halves (frozen)', () => {
    const task = makeTask(1, { plannedStart: MON, plannedStartPM: true, plannedDuration: 1, plannedFinish: TUE, plannedFinishMidday: true });
    const r = taskOf(run([task], { mode: 'Track', statusDate: '2026-10-30' }), 1);
    expect(r).toMatchObject({ plannedStart: MON, plannedStartPM: true, plannedFinish: TUE, plannedFinishMidday: true });
    expect(r).toMatchObject({ forecastStart: MON, forecastStartPM: true, forecastFinish: TUE, forecastFinishMidday: true, variance: 0 });
  });

  it('a stored duration that is not a multiple of half a day is taken to the nearest half', () => {
    expect(taskOf(run([makeTask(1, { plannedStart: MON, plannedDuration: 1.3 })]), 1).plannedDuration).toBe(1.5);
    expect(taskOf(run([makeTask(1, { plannedStart: MON, plannedDuration: 0.1 })]), 1).plannedDuration).toBe(0.5);
  });
});

describe('forecast, variance and status in half days (§5.6, §5.7)', () => {
  it('remaining work rounds up to whole days for whole durations, to halves otherwise', () => {
    expect(remainingHalves(3, 50)).toBe(4); // 1.5 days → 2 days, as before
    expect(remainingHalves(5, 50)).toBe(6);
    expect(remainingHalves(2.5, 50)).toBe(3); // 1.25 days → 1.5 days
    expect(remainingHalves(0.5, 90)).toBe(1);
    expect(remainingHalves(1.5, 0)).toBe(3);
    expect(remainingHalves(4, 99)).toBe(2); // at least a day for whole days
  });

  it('an in-progress task with a half in its duration is forecast in halves', () => {
    const task = makeTask(1, { plannedStart: MON, plannedDuration: 2.5, progress: 50, actualStart: MON });
    const r = taskOf(run([task], { mode: 'Track', statusDate: MON }), 1);
    // R = Tue morning; 1.25 days left → 1.5 days → finishes Wed at midday. Planned: Wed midday too.
    expect(r).toMatchObject({ forecastFinish: WED, forecastFinishMidday: true, variance: 0, status: 'In Progress' });
  });

  it('a task not started past its afternoon is late by half a day', () => {
    const tasks = [makeTask(1, { plannedStart: MON, plannedDuration: 0.5 }), makeTask(2, { plannedDuration: 0.5, predecessorsText: '1' })];
    const result = run(tasks, { mode: 'Track', statusDate: MON });
    // Task 1 not started either: both pushed to R (Tue morning). Task 2: Tue afternoon, planned Mon afternoon.
    expect(taskOf(result, 1)).toMatchObject({ forecastStart: TUE, forecastFinish: TUE, forecastFinishMidday: true, variance: 1 });
    expect(taskOf(result, 2)).toMatchObject({ forecastStart: TUE, forecastStartPM: true, variance: 1, status: 'Late' });
    const one = run([makeTask(1, { plannedStart: MON, plannedStartPM: true, plannedDuration: 0.5 })], { mode: 'Track', statusDate: MON });
    expect(taskOf(one, 1)).toMatchObject({ forecastStart: TUE, forecastFinish: TUE, forecastFinishMidday: true, variance: 0.5, status: 'Late' });
  });

  it('a completed task compares days: a 0.5-day task done on its day is on time', () => {
    const done = makeTask(1, { plannedStart: MON, plannedDuration: 0.5, progress: 100, actualStart: MON, actualFinish: MON });
    const late = makeTask(2, { plannedStart: MON, plannedDuration: 0.5, progress: 100, actualStart: MON, actualFinish: TUE });
    const result = run([done, late], { mode: 'Track', statusDate: WED });
    expect(taskOf(result, 1)).toMatchObject({ variance: 0, status: 'Completed', actualDuration: 1 });
    expect(taskOf(result, 2)).toMatchObject({ variance: 1, status: 'Completed' });
    expect(result.summary.finishVariance).toBe(1); // every task done: days
  });

  it('a successor of a completed task starts the morning after its actual finish', () => {
    const tasks = [
      makeTask(1, { plannedStart: MON, plannedDuration: 0.5, progress: 100, actualStart: MON, actualFinish: MON }),
      makeTask(2, { plannedDuration: 0.5, predecessorsText: '1' }),
    ];
    const r = taskOf(run(tasks, { mode: 'Track', statusDate: MON }), 2);
    expect(r).toMatchObject({ forecastStart: TUE, forecastFinish: TUE, forecastFinishMidday: true, variance: 0.5, status: 'Late' });
  });
});

describe('critical path, progress and S-curve in half days (§5.8–§5.10)', () => {
  it('floats count halves: a 0.5-day task beside a full day has half a day of float', () => {
    const result = run([
      makeTask(1, { plannedStart: MON, plannedDuration: 0.5 }),
      makeTask(2, { plannedDuration: 0.5, predecessorsText: '1' }),
      makeTask(3, { plannedStart: MON, plannedDuration: 0.5 }),
    ]);
    expect(taskOf(result, 1)).toMatchObject({ totalFloat: 0, critical: true });
    expect(taskOf(result, 2)).toMatchObject({ totalFloat: 0, critical: true });
    expect(taskOf(result, 3)).toMatchObject({ totalFloat: 0.5, critical: false });
  });

  it('planned % counts halves: a 1-day task from an afternoon is half done at the end of that day', () => {
    const cal = createCalendar([]);
    const t = { plannedStart: MON, plannedDuration: 1, plannedFinish: TUE, ps: halfOf(MON, true) };
    expect(plannedPct(t, MON, cal)).toBe(50);
    expect(plannedPct(t, TUE, cal)).toBe(100);
    const half = { plannedStart: MON, plannedDuration: 0.5, plannedFinish: MON, ps: halfOf(MON) };
    expect(plannedPct(half, MON, cal)).toBe(100);
    expect(plannedPct(half, '2026-11-01', cal)).toBe(0);
  });

  it('project duration and elapsed time count halves', () => {
    const result = run([makeTask(1, { plannedStart: MON, plannedDuration: 1.5 })], { statusDate: MON });
    expect(result.summary).toMatchObject({ durationDays: 1.5, elapsedDays: 1 });
  });

  it('the S-curve reaches 100 at the end of the day a 0.5-day plan finishes', () => {
    const result = compute(makeProject({ statusDate: '2026-10-30' }), [makeTask(1, { plannedStart: MON, plannedDuration: 0.5 })], createCalendar([]));
    expect(result.sCurve.find((p) => p.date === MON)?.planned).toBe(100);
  });

  it('a major task rolls up halves: its start, duration and midday finish', () => {
    const result = run([
      makeTask(1, { level: 1 }),
      makeTask(2, { level: 2, plannedStart: MON, plannedStartPM: true, plannedDuration: 0.5 }),
      makeTask(3, { level: 2, plannedDuration: 0.5, predecessorsText: '2' }),
    ], { statusDate: '2026-10-30' }); // before the plan: forecasts as planned
    expect(taskOf(result, 1)).toMatchObject({ plannedStart: MON, plannedStartPM: true, plannedFinish: TUE, plannedFinishMidday: true, plannedDuration: 1 });
    expect(taskOf(result, 1)).toMatchObject({ forecastStartPM: true, forecastFinishMidday: true });
  });
});

describe('a plan of whole days is unchanged (§17)', () => {
  it('sets no half-day flag', () => {
    const result = run([
      makeTask(1, { plannedStart: MON, plannedDuration: 3 }),
      makeTask(2, { plannedDuration: 0, predecessorsText: '1' }),
      makeTask(3, { plannedDuration: 2, predecessorsText: '2SS+1' }),
      makeTask(4, { plannedDuration: 0 }),
      makeTask(5, { plannedDuration: 4, predecessorsText: '4', progress: 30, actualStart: MON }),
    ], { mode: 'Track', statusDate: TUE });
    for (const r of result.tasks) {
      expect(Object.keys(r).filter((k) => /PM$|Midday$/.test(k))).toEqual([]);
      expect(Number.isInteger(r.variance) && Number.isInteger(r.plannedDuration)).toBe(true);
    }
  });
});
