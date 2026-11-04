import { describe, expect, it } from 'vitest';
import { createCalendar } from '../../src/engine/calendar';
import { scheduleState } from '../../src/engine/progress';
import { plannedPct } from '../../src/engine/scurve';
import { makeTask, run } from './helpers';

describe('plannedPct', () => {
  const task = { plannedStart: '2026-11-02', plannedDuration: 5, plannedFinish: '2026-11-06' };
  const cal = createCalendar([]);

  it.each([
    ['2026-11-01', 0],
    ['2026-11-02', 20],
    ['2026-11-04', 60],
    ['2026-11-06', 100],
    ['2026-11-07', 100],
  ])('at %s → %d%%', (d, pct) => {
    expect(plannedPct(task, d, cal)).toBeCloseTo(pct, 10);
  });

  it('counts working days only', () => {
    const withHoliday = createCalendar(['2026-11-04']);
    const t = { plannedStart: '2026-11-02', plannedDuration: 4, plannedFinish: '2026-11-06' };
    expect(plannedPct(t, '2026-11-04', withHoliday)).toBe(50);
  });
});

describe('project metrics', () => {
  it('exclude milestones from percentages and task counts', () => {
    const r = run([
      makeTask(1, { plannedDuration: 2, actualStart: '2026-11-02', progress: 50 }),
      makeTask(2, { plannedDuration: 0, actualStart: '2026-11-02', actualFinish: '2026-11-02', progress: 100 }),
    ]);
    expect(r.summary.actualPct).toBe(50);
    expect(r.summary.counts.total).toBe(1);
    expect(r.summary.milestones).toEqual({ done: 1, total: 1 });
  });

  it('handle a project of milestones only', () => {
    const r = run([makeTask(1, { plannedDuration: 0 }), makeTask(2, { predecessorsText: '1', plannedDuration: 0 })]);
    expect(r.summary).toMatchObject({
      actualPct: 0,
      plannedPct: 0,
      variancePts: 0,
      spi: null,
      state: 'On track',
      counts: { completed: 0, inProgress: 0, notStarted: 0, late: 0, total: 0 },
      milestones: { done: 0, total: 2 },
    });
    expect(r.sCurve.every((p) => p.planned === 0)).toBe(true);
  });

  it('handle a project without tasks', () => {
    const r = run([]);
    expect(r.summary).toMatchObject({ plannedStart: '2026-11-02', plannedFinish: '2026-11-02', durationDays: 0, elapsedDays: 0 });
    expect(r.sCurve).toEqual([]);
    expect(r.byAssignee).toEqual([]);
  });

  it('report finish variance, duration and time elapsed in working days', () => {
    // 2–11 Nov, half done at Mon 9 Nov → 5 days left from Tue 10 Nov → Sat 14 Nov.
    const r = run([makeTask(1, { plannedDuration: 10, actualStart: '2026-11-02', progress: 50 })], { statusDate: '2026-11-09' });
    expect(r.summary).toMatchObject({
      plannedFinish: '2026-11-11',
      forecastFinish: '2026-11-14',
      finishVariance: 3,
      durationDays: 10,
      elapsedDays: 8,
      plannedPct: 80,
      actualPct: 50,
      variancePts: -30,
      state: 'Behind',
    });
    expect(r.summary.spi).toBeCloseTo(0.625, 10);
  });

  it('cap time elapsed at the planned finish', () => {
    const r = run([makeTask(1, { plannedDuration: 5 })], { statusDate: '2026-11-20' });
    expect(r.summary.elapsedDays).toBe(5);
  });

  it('this week = change over the 7 days ending at the status date', () => {
    // 2–11 Nov, 40% at Mon 9 Nov. A week earlier (Mon 2 Nov): actual 40 × 1/8 = 5, planned 10.
    const r = run([makeTask(1, { plannedDuration: 10, actualStart: '2026-11-02', progress: 40 })], { statusDate: '2026-11-09' });
    expect(r.summary.weekActualDelta).toBeCloseTo(35, 10);
    expect(r.summary.weekPlannedDelta).toBeCloseTo(70, 10);
  });

  it.each([
    [2, 'Ahead'],
    [1.9, 'On track'],
    [-1.9, 'On track'],
    [-2, 'Slightly behind'],
    [-4.9, 'Slightly behind'],
    [-5, 'Behind'],
  ] as const)('schedule state at %d pts is %s', (pts, state) => {
    expect(scheduleState(pts)).toBe(state);
  });
});

describe('progress by assignee', () => {
  const resources = [
    { name: 'Alice', type: 'Person' as const },
    { name: 'Bob', type: 'Team' as const },
    { name: 'Dave', type: 'Person' as const },
  ];
  const tasks = [
    makeTask(1, { assigned: ['Alice', 'Bob'], plannedDuration: 2, actualStart: '2026-11-02', progress: 50 }),
    makeTask(2, { assigned: ['alice'], plannedDuration: 2, actualStart: '2026-11-02', actualFinish: '2026-11-03', progress: 100 }),
    makeTask(3, { plannedDuration: 2 }),
    makeTask(4, { assigned: ['Carol'], plannedDuration: 2 }),
    makeTask(5, { assigned: ['Bob'], plannedDuration: 0 }),
    makeTask(6, { assigned: ['Bob', ' bob '], plannedDuration: 2, plannedStart: '2026-11-16' }),
  ];

  it('counts a shared task fully for each assignee, groups tasks without one as Unassigned', () => {
    const r = run(tasks, { statusDate: '2026-11-03' }, [], resources);
    expect(r.byAssignee.map((a) => [a.name, a.type, a.tasks])).toEqual([
      ['Alice', 'Person', 2],
      ['Bob', 'Team', 2],
      ['Carol', undefined, 1],
      ['Unassigned', undefined, 1],
    ]);
    const alice = r.byAssignee[0];
    expect(alice).toMatchObject({ completed: 1, late: 1, actualPct: 75, plannedPct: 100, variancePts: -25 });
  });

  it('reports assignees missing from Resources', () => {
    const r = run(tasks, {}, [], resources);
    expect(r.issues.filter((i) => i.code === 'W_NEW_RESOURCE').map((i) => i.message)).toEqual(['Added "Carol" to Resources']);
    expect(r.changes).toContainEqual({ taskId: 4, field: 'Resources', from: undefined, to: 'Carol', kind: 'filled', reason: 'New assignee' });
  });
});
