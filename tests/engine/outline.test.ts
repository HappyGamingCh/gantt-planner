import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, normalizeLevels, outlineOf } from '../../src/engine/outline';
import type { Change } from '../../src/engine/types';
import { issuesOf, makeTask, run, taskOf } from './helpers';

// Reference dates: Project Start Mon 2 Nov 2026, status date Fri 13 Nov; every day is a working day.

describe('Levels (§4.7)', () => {
  const levels = (raw: (number | undefined)[]) => {
    const changes: Change[] = [];
    const out = normalizeLevels(
      raw.map((level, i) => makeTask(i + 1, { level })),
      changes,
    );
    return { out, changes };
  };

  it('a plan with no Level is all Level 1 and records nothing', () => {
    expect(levels([undefined, undefined, undefined])).toEqual({ out: [1, 1, 1], changes: [] });
  });

  it('keeps valid Levels as they are', () => {
    expect(levels([1, 2, 3, 2, 1])).toEqual({ out: [1, 2, 3, 2, 1], changes: [] });
  });

  it('a blank takes the Level of the row below, the last rows that of the row above', () => {
    const { out, changes } = levels([1, undefined, 2, 2, undefined]);
    expect(out).toEqual([1, 2, 2, 2, 2]);
    expect(changes.map((c) => [c.taskId, c.from, c.to, c.kind, c.reason])).toEqual([
      [2, undefined, 2, 'filled', 'Same level as the row below'],
      [5, undefined, 2, 'filled', 'Same level as the row above'],
    ]);
  });

  it('corrects the first row, jumps and out-of-range values', () => {
    const { out, changes } = levels([2, 4, 0, 9.4]);
    expect(out).toEqual([1, 2, 1, 2]);
    expect(changes.map((c) => c.reason)).toEqual([
      'The first row is at Level 1',
      'At most one level deeper than the row above',
      `Level is a whole number from 1 to ${MAX_LEVEL}`,
      `Level is a whole number from 1 to ${MAX_LEVEL}`,
    ]);
  });
});

describe('outline (§5.12)', () => {
  it('finds major tasks, their leaf tasks and each row\'s parent', () => {
    // 1 Refractory › 2 Arch Panel › 3, 4 · 5 Convection › 6 · 7 (top-level task)
    const tasks = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id }));
    const o = outlineOf(tasks, [1, 2, 3, 3, 2, 3, 1]);
    expect([...o.summaries]).toEqual([1, 2, 5]);
    expect(Object.fromEntries(o.leavesOf)).toEqual({ 1: [3, 4, 6], 2: [3, 4], 5: [6] });
    expect(Object.fromEntries(o.parentOf)).toEqual({ 1: undefined, 2: 1, 3: 2, 4: 2, 5: 1, 6: 5, 7: undefined });
  });
});

describe('major task roll-up (§5.12)', () => {
  // 1 Group › 2 (2 Nov, 3d), 3 (FS after 2, 2d), 4 (milestone after 3) · 5 (top level, after 3).
  const tasks = [
    makeTask(1, { level: 1, name: 'Group', plannedStart: '2026-12-01', plannedDuration: 9, progress: 80 }),
    makeTask(2, { level: 2, plannedStart: '2026-11-02', plannedDuration: 3 }),
    makeTask(3, { level: 2, predecessorsText: '2', plannedDuration: 2 }),
    makeTask(4, { level: 2, predecessorsText: '3', plannedDuration: 0 }),
    makeTask(5, { level: 1, predecessorsText: '3', plannedDuration: 1 }),
  ];

  it('dates span its leaf tasks; its own values in the plan are not used', () => {
    const result = run(tasks, { statusDate: '2026-11-01' }); // before the plan: nothing is late yet
    const r = taskOf(result, 1);
    expect(r).toMatchObject({ level: 1, plannedStart: '2026-11-02', plannedFinish: '2026-11-06', plannedDuration: 5, progress: 0, status: 'Not Started', links: [], successorsText: '' });
    expect(r.summary).toEqual({ tasks: 3, actualFinish: undefined });
    expect(taskOf(result, 5).plannedStart).toBe('2026-11-07');
  });

  it('progress is the mean of its non-milestone leaf tasks; status and variance from its own dates', () => {
    const tracked = tasks.map((t) =>
      t.id === 2 ? { ...t, actualStart: '2026-11-02', actualFinish: '2026-11-04', progress: 100 } : t.id === 3 ? { ...t, actualStart: '2026-11-05', progress: 50 } : t,
    );
    // SD 13 Nov: task 3 (planned to finish 6 Nov) is half done → its forecast runs past the plan, so the group is Late.
    const result = run(tracked, { mode: 'Track' });
    const r = taskOf(result, 1);
    expect(r.progress).toBe(75);
    expect(r.actualStart).toBe('2026-11-02');
    expect(r.summary?.actualFinish).toBeUndefined();
    expect(r.status).toBe('Late');
    expect(r.variance).toBe(taskOf(result, 3).variance); // the milestone after 3 sits on 3's last day: both end the group
    expect(r.variance).toBeGreaterThan(0);
    expect(r.forecastFinish).toBe(taskOf(result, 4).forecastFinish);
  });

  it('Completed with the latest actual finish once every leaf task is done', () => {
    const doneTasks = tasks.map((t) =>
      t.id === 2 ? { ...t, actualStart: '2026-11-02', actualFinish: '2026-11-04' } : t.id === 3 ? { ...t, actualStart: '2026-11-05', actualFinish: '2026-11-07' } : t.id === 4 ? { ...t, actualFinish: '2026-11-07' } : t,
    );
    const r = taskOf(run(doneTasks, { mode: 'Track' }), 1);
    expect(r).toMatchObject({ status: 'Completed', progress: 100, actualStart: '2026-11-02', actualDuration: 6 });
    expect(r.summary?.actualFinish).toBe('2026-11-07');
  });

  it('is left out of the KPIs, the S-curve and the counts', () => {
    const result = run(tasks);
    expect(result.summary.counts.total).toBe(3); // 2, 3 and 5; 4 is a milestone, 1 a major task
    expect(result.summary.milestones.total).toBe(1);
    expect(result.byAssignee.map((a) => [a.name, a.tasks])).toEqual([['Unassigned', 3]]);
  });

  it('a link to a major task is E_SUMMARY_LINK; predecessors on one are W_SUMMARY_PREDS', () => {
    const result = run([...tasks.map((t) => (t.id === 1 ? { ...t, predecessorsText: '5' } : t.id === 5 ? { ...t, predecessorsText: '1' } : t))]);
    expect(issuesOf(result, 5)).toEqual(['E_SUMMARY_LINK']);
    expect(result.issues.find((i) => i.code === 'E_SUMMARY_LINK')?.fix).toEqual({ kind: 'removeLink', taskId: 5, predId: 1 });
    expect(issuesOf(result, 1)).toEqual(['W_SUMMARY_PREDS']);
    expect(taskOf(result, 1).predecessorsText).toBe('5'); // written back as typed
    expect(taskOf(result, 5).predecessorsText).toBe('1');
  });

  it('nested major tasks roll up all their leaf tasks; critical when one of them is', () => {
    const nested = [
      makeTask(1, { level: 1 }),
      makeTask(2, { level: 2 }),
      makeTask(3, { level: 3, plannedStart: '2026-11-02', plannedDuration: 2 }),
      makeTask(4, { level: 2, plannedStart: '2026-11-03', plannedDuration: 4 }),
    ];
    const result = run(nested);
    expect(taskOf(result, 2)).toMatchObject({ plannedStart: '2026-11-02', plannedFinish: '2026-11-03', summary: { tasks: 1 } });
    expect(taskOf(result, 1)).toMatchObject({ plannedStart: '2026-11-02', plannedFinish: '2026-11-06', summary: { tasks: 2 }, critical: true });
    expect(taskOf(result, 2).critical).toBe(false);
  });

  it('a group of milestones on one day has duration 0', () => {
    const ms = [makeTask(1, { level: 1 }), makeTask(2, { level: 2, plannedStart: '2026-11-05', plannedDuration: 0 }), makeTask(3, { level: 2, plannedStart: '2026-11-05', plannedDuration: 0 })];
    expect(taskOf(run(ms), 1)).toMatchObject({ plannedDuration: 0, progress: 0 });
  });
});
