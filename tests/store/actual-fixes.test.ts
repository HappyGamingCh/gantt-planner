import { describe, expect, it } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import type { Plan, Task } from '../../src/engine/types';
import { applyFix, editTask } from '../../src/store/edit';
import { CLOSED, useStore } from '../../src/store/store';
import { makeProject, makeTask } from '../engine/helpers';

// Track mode, Project Start Mon 2 Nov, status date Fri 13 Nov.
const state = () => useStore.getState();
const task = (id: number) => state().plan!.tasks.find((t) => t.id === id)!;
const result = (id: number) => state().result!.tasks.find((t) => t.id === id)!;

function load(tasks: Task[]) {
  const plan: Plan = { project: makeProject({ mode: 'Track' }), tasks, resources: [], holidays: [] };
  useStore.setState({ ...CLOSED, plan, result: computePlan(plan), cleanPlan: plan, maxIdEver: Math.max(0, ...tasks.map((t) => t.id)), toast: null });
}

describe('quick fix "Set Actual Finish" — SPEC §5.5, §5.11', () => {
  it('on a 100% task with neither date it also sets the start used for calculation, so no number changes', () => {
    load([makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 5, progress: 100 }), makeTask(2, { plannedDuration: 20 })]);
    const before = state().result!;
    const fix = before.issues.find((i) => i.code === 'W_100_NO_AF')!.fix!;
    applyFix(fix);
    expect(task(1)).toMatchObject({ actualStart: '2026-11-02', actualFinish: '2026-11-13' });
    expect(result(1)).toMatchObject({ actualDuration: 12, forecastStart: '2026-11-02', forecastFinish: '2026-11-13' });
    expect(state().result!.summary.weekActualDelta).toBe(before.summary.weekActualDelta);
    expect(state().result!.issues).toEqual([]);
  });

  it('never replaces an Actual Start the task already has', () => {
    load([makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 5, progress: 100 })]);
    applyFix({ kind: 'setActualFinish', taskId: 1, value: '2026-11-13', actualStart: '2026-11-02' });
    expect(task(1).actualStart).toBe('2026-11-02');
    load([makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 5, progress: 100, actualStart: '2026-11-04' })]);
    applyFix({ kind: 'setActualFinish', taskId: 1, value: '2026-11-13', actualStart: '2026-11-02' });
    expect(task(1)).toMatchObject({ actualStart: '2026-11-04', actualFinish: '2026-11-13' });
  });

  it('replaces an Actual Start outside 1950–2199 with the start the engine used in its place', () => {
    load([makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 5, progress: 100, actualStart: '0026-11-02' }), makeTask(2, { plannedDuration: 20 })]);
    const before = state().result!;
    applyFix(before.issues.find((i) => i.code === 'W_100_NO_AF')!.fix!);
    expect(task(1)).toMatchObject({ actualStart: '2026-11-02', actualFinish: '2026-11-13' });
    expect(result(1)).toMatchObject({ actualDuration: 12, forecastStart: '2026-11-02' });
    expect(state().result!.summary.weekActualDelta).toBe(before.summary.weekActualDelta);
    expect(state().result!.issues).toEqual([]);
  });

  it('a milestone with an Actual Start only: Actual Finish = Actual Start', () => {
    load([makeTask(1, { plannedStart: '2026-11-06', plannedDuration: 0, actualStart: '2026-11-06' })]);
    expect(result(1).status).toBe('Completed');
    applyFix(state().result!.issues.find((i) => i.code === 'W_MS_NO_AF')!.fix!);
    expect(task(1)).toMatchObject({ actualStart: '2026-11-06', actualFinish: '2026-11-06' });
    expect(result(1)).toMatchObject({ status: 'Completed', progress: 100 });
  });
});

describe('progress on a milestone — SPEC §8', () => {
  it('any progress above 0 marks it reached: 100%, Actual Start and Finish = status date', () => {
    load([makeTask(1, { plannedStart: '2026-11-06', plannedDuration: 0 })]);
    editTask(1, 'progress', 25);
    expect(task(1)).toMatchObject({ progress: 100, actualStart: '2026-11-13', actualFinish: '2026-11-13' });
    expect(state().toast?.message).toBe('Actual start and finish set to 13 Nov — change if needed');
    expect(state().result!.issues).toEqual([]);
  });

  it('a milestone that has an Actual Start is reached on that day', () => {
    load([makeTask(1, { plannedStart: '2026-11-06', plannedDuration: 0, actualStart: '2026-11-06' })]);
    editTask(1, 'progress', 100);
    expect(task(1)).toMatchObject({ progress: 100, actualStart: '2026-11-06', actualFinish: '2026-11-06' });
    expect(state().toast?.message).toBe('Actual finish set to 6 Nov — change if needed');
  });

  it('progress 0 un-completes it: both actual dates cleared, so its Actual Start alone does not mark it reached', () => {
    load([makeTask(1, { plannedStart: '2026-11-06', plannedDuration: 0, progress: 100, actualStart: '2026-11-06', actualFinish: '2026-11-06' })]);
    editTask(1, 'progress', 0);
    expect(task(1)).toMatchObject({ progress: 0 });
    expect(task(1).actualStart).toBeUndefined();
    expect(task(1).actualFinish).toBeUndefined();
    expect(state().toast?.message).toBe('Milestone not reached — actual dates cleared');
    expect(result(1).status).not.toBe('Completed');
    expect(state().result!.issues).toEqual([]);
  });

  it('progress 0 on a milestone reached by its Actual Start alone clears that start', () => {
    load([makeTask(1, { plannedStart: '2026-11-06', plannedDuration: 0, actualStart: '2026-11-06' })]);
    expect(result(1).status).toBe('Completed');
    editTask(1, 'progress', 0);
    expect(task(1).actualStart).toBeUndefined();
    expect(result(1).status).not.toBe('Completed');
  });

  it('clearing Actual Finish un-completes it: Actual Start cleared too, progress 0', () => {
    load([makeTask(1, { plannedStart: '2026-11-06', plannedDuration: 0, progress: 100, actualStart: '2026-11-06', actualFinish: '2026-11-06' })]);
    editTask(1, 'actualFinish', '');
    expect(task(1)).toMatchObject({ progress: 0 });
    expect(task(1).actualStart).toBeUndefined();
    expect(task(1).actualFinish).toBeUndefined();
    expect(state().toast?.message).toBe('Milestone not reached — actual dates cleared');
    expect(result(1).status).not.toBe('Completed');
    expect(state().result!.issues).toEqual([]);
  });

  it('a task with duration keeps partial progress', () => {
    load([makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 5 })]);
    editTask(1, 'progress', 25);
    expect(task(1)).toMatchObject({ progress: 25, actualStart: '2026-11-13' });
    expect(task(1).actualFinish).toBeUndefined();
  });
});
