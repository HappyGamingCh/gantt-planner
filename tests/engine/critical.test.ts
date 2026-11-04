import { describe, expect, it } from 'vitest';
import { makeTask, run, taskOf } from './helpers';

// Project Start Mon 2 Nov 2026, status date Fri 13 Nov (R = Sat 14 Nov). Every day is a working day.

const floatOf = (r: ReturnType<typeof run>, id: number) => {
  const t = taskOf(r, id);
  return { totalFloat: t.totalFloat, critical: t.critical };
};

describe('critical path', () => {
  it('simple chain: every task has zero float and is critical', () => {
    const r = run(
      [
        makeTask(1, { plannedDuration: 5 }),
        makeTask(2, { predecessorsText: '1', plannedDuration: 3 }),
        makeTask(3, { predecessorsText: '2', plannedDuration: 2 }),
      ],
      { statusDate: '2026-11-01' },
    );
    for (const id of [1, 2, 3]) expect(floatOf(r, id)).toEqual({ totalFloat: 0, critical: true });
  });

  it('parallel branches: the shorter branch has float and is not critical', () => {
    const r = run(
      [
        makeTask(1, { plannedDuration: 5 }), // 2–6 Nov
        makeTask(2, { plannedDuration: 2 }), // 2–3 Nov
        makeTask(3, { predecessorsText: '1,2', plannedDuration: 1 }), // 7 Nov
      ],
      { statusDate: '2026-11-01' },
    );
    expect(floatOf(r, 1)).toEqual({ totalFloat: 0, critical: true });
    expect(floatOf(r, 2)).toEqual({ totalFloat: 3, critical: false });
    expect(floatOf(r, 3)).toEqual({ totalFloat: 0, critical: true });
  });

  it('a task without links finishing before the project finish has float', () => {
    const r = run([makeTask(1, { plannedDuration: 6 }), makeTask(2, { plannedDuration: 1 })], { statusDate: '2026-11-01' });
    expect(floatOf(r, 2)).toEqual({ totalFloat: 5, critical: false });
  });

  it('SS and lag: the predecessor is held by its successor late start', () => {
    const r = run(
      [
        makeTask(1, { plannedDuration: 5 }), // 2–6 Nov
        makeTask(2, { predecessorsText: '1SS+2', plannedDuration: 5 }), // 4–8 Nov
        makeTask(3, { predecessorsText: '1FS+1', plannedDuration: 1 }), // 8 Nov
        makeTask(4, { plannedDuration: 3 }), // 2–4 Nov
      ],
      { statusDate: '2026-11-01' },
    );
    expect(floatOf(r, 1)).toEqual({ totalFloat: 0, critical: true });
    expect(floatOf(r, 2)).toEqual({ totalFloat: 0, critical: true });
    expect(floatOf(r, 3)).toEqual({ totalFloat: 0, critical: true });
    expect(floatOf(r, 4)).toEqual({ totalFloat: 4, critical: false });
  });

  it('milestones use the same FS gap as the forward pass', () => {
    const r = run(
      [
        makeTask(1, { plannedDuration: 0 }), // start milestone 2 Nov
        makeTask(2, { predecessorsText: '1', plannedDuration: 3 }), // 2–4 Nov
        makeTask(3, { predecessorsText: '2', plannedDuration: 0 }), // milestone 4 Nov
        makeTask(4, { predecessorsText: '3', plannedDuration: 2 }), // 5–6 Nov
        makeTask(5, { plannedDuration: 1 }), // 2 Nov
      ],
      { statusDate: '2026-11-01' },
    );
    for (const id of [1, 2, 3, 4]) expect(floatOf(r, id)).toEqual({ totalFloat: 0, critical: true });
    expect(floatOf(r, 5)).toEqual({ totalFloat: 4, critical: false });
  });

  it('holidays are not counted in float', () => {
    const r = run(
      [
        makeTask(1, { plannedDuration: 2 }), // 2–3 Nov
        makeTask(2, { predecessorsText: '1', plannedDuration: 2 }), // 5–6 Nov (4 Nov holiday)
        makeTask(3, { plannedDuration: 3 }), // 2, 3, 5 Nov
      ],
      { statusDate: '2026-11-01' },
      ['2026-11-04'],
    );
    expect(floatOf(r, 1)).toEqual({ totalFloat: 0, critical: true });
    expect(floatOf(r, 2)).toEqual({ totalFloat: 0, critical: true });
    expect(floatOf(r, 3)).toEqual({ totalFloat: 1, critical: false });
  });

  it('works on the forecast: completed tasks are never critical, late work drives the path', () => {
    const r = run([
      makeTask(1, { plannedDuration: 3, actualStart: '2026-11-02', actualFinish: '2026-11-04', progress: 100 }),
      makeTask(2, { predecessorsText: '1', plannedDuration: 3 }), // planned 5–7 Nov → forecast 14–16 Nov
      makeTask(3, { plannedDuration: 10, actualStart: '2026-11-02', progress: 50 }), // forecast finish 18 Nov
      makeTask(4, { predecessorsText: '3', plannedDuration: 2 }), // forecast 19–20 Nov
    ]);
    expect(floatOf(r, 1)).toEqual({ totalFloat: undefined, critical: false });
    expect(floatOf(r, 2)).toEqual({ totalFloat: 4, critical: false });
    expect(floatOf(r, 3)).toEqual({ totalFloat: 0, critical: true });
    expect(floatOf(r, 4)).toEqual({ totalFloat: 0, critical: true });
  });

  describe('SS from a predecessor that has started (its start is an actual; its finish moves no SS successor)', () => {
    // Track, status date Wed 4 Nov (R = 5 Nov). A: 10 days, started 2 Nov, 20% → forecast finish 12 Nov.
    // B: 1SS+2, 20 days, not started → forecast 5–24 Nov (the project finish).
    const a = () => makeTask(1, { plannedDuration: 10, actualStart: '2026-11-02', progress: 20 });
    const b = () => makeTask(2, { predecessorsText: '1SS+2', plannedDuration: 20 });

    it('does not bound its late finish: A keeps its float', () => {
      const r = run([a(), b()], { mode: 'Track', statusDate: '2026-11-04' });
      expect(taskOf(r, 1).forecastFinish).toBe('2026-11-12');
      expect(floatOf(r, 1)).toEqual({ totalFloat: 12, critical: false });
      expect(floatOf(r, 2)).toEqual({ totalFloat: 0, critical: true });
    });

    it('an FS successor of the same task still bounds it', () => {
      const r = run([a(), b(), makeTask(3, { predecessorsText: '1', plannedDuration: 3 })], { mode: 'Track', statusDate: '2026-11-04' });
      expect(floatOf(r, 1)).toEqual({ totalFloat: 9, critical: false });
      expect(floatOf(r, 3)).toEqual({ totalFloat: 9, critical: false });
    });

    it('a predecessor that has not started, with an SS successor already started, is still flagged (negative float)', () => {
      const r = run([
        makeTask(1, { plannedDuration: 2 }), // not started → forecast 14–15 Nov
        makeTask(2, { predecessorsText: '1SS', plannedDuration: 4, actualStart: '2026-11-10', progress: 50 }), // forecast finish 15 Nov
      ]);
      expect(floatOf(r, 2)).toEqual({ totalFloat: 0, critical: true });
      expect(taskOf(r, 1).totalFloat).toBe(-2);
      expect(taskOf(r, 1).critical).toBe(true);
    });
  });

  it('a task that is not completed but must finish before work already in progress has negative float', () => {
    const r = run([
      makeTask(1, { plannedDuration: 2 }), // not started → forecast 14–15 Nov
      makeTask(2, { predecessorsText: '1', plannedDuration: 4, actualStart: '2026-11-10', progress: 50 }), // forecast 14–15 Nov
    ]);
    expect(floatOf(r, 2)).toEqual({ totalFloat: 0, critical: true });
    expect(taskOf(r, 1).totalFloat).toBeLessThan(0);
    expect(taskOf(r, 1).critical).toBe(true);
  });
});
