// Half days through the store (SPEC §8, §7.8): durations in steps of 0.5, a drag that starts a task in the afternoon,
// a typed start in the morning, finish edits counted in halves, and the halves kept in Track mode.
import { beforeEach, describe, expect, it } from 'vitest';
import { editTask, setMode } from '../../src/store/edit';
import { undo } from '../../src/store/undo';
import { makeProject, makeTask } from '../engine/helpers';
import { load, result, state, task } from './editHelpers';

const MON = '2026-11-02';
const TUE = '2026-11-03';

beforeEach(() =>
  load({
    project: makeProject({ statusDate: '2026-10-30' }),
    tasks: [makeTask(1, { plannedStart: MON, plannedDuration: 1 }), makeTask(2, { plannedDuration: 1, predecessorsText: '1' })],
    resources: [],
    holidays: [],
  }),
);

describe('half-day edits — SPEC §8', () => {
  it('a duration of 0.5 moves the successor to the afternoon; another decimal goes to the nearest half day', () => {
    editTask(1, 'plannedDuration', 0.5);
    expect(result(1)).toMatchObject({ plannedDuration: 0.5, plannedFinish: MON, plannedFinishMidday: true });
    expect(result(2)).toMatchObject({ plannedStart: MON, plannedStartPM: true, plannedFinish: TUE, plannedFinishMidday: true });
    editTask(1, 'plannedDuration', 1.3);
    expect(task(1).plannedDuration).toBe(1.5);
  });

  it('settle stores the halves, so the plan as saved is the plan as shown', () => {
    editTask(1, 'plannedDuration', 0.5);
    expect(task(1)).toMatchObject({ plannedFinish: MON, plannedFinishMidday: true });
    expect(task(2)).toMatchObject({ plannedStart: MON, plannedStartPM: true, plannedFinishMidday: true });
    editTask(1, 'plannedDuration', 1);
    expect(task(1).plannedFinishMidday).toBeUndefined();
    expect(task(2).plannedStartPM).toBeUndefined();
  });

  it('a drag can start a root task in the afternoon; a typed date starts it in the morning', () => {
    editTask(1, 'plannedStart', { date: MON, afternoon: true });
    expect(task(1)).toMatchObject({ plannedStart: MON, plannedStartPM: true });
    expect(result(1)).toMatchObject({ plannedFinish: TUE, plannedFinishMidday: true });
    expect(result(2)).toMatchObject({ plannedStart: TUE, plannedStartPM: true });
    editTask(1, 'plannedStart', TUE);
    expect(task(1).plannedStartPM).toBeUndefined();
    expect(result(1)).toMatchObject({ plannedStart: TUE, plannedFinish: TUE });
    undo();
    expect(task(1)).toMatchObject({ plannedStart: MON, plannedStartPM: true });
  });

  it('a finish edit counts halves to the end of that day', () => {
    editTask(1, 'plannedStart', { date: MON, afternoon: true });
    editTask(1, 'plannedFinish', MON);
    expect(task(1).plannedDuration).toBe(0.5);
    editTask(1, 'plannedFinish', '2026-11-04');
    expect(task(1).plannedDuration).toBe(2.5);
  });

  it('switching to Track keeps the halves as the baseline', () => {
    editTask(1, 'plannedDuration', 0.5);
    setMode('Track');
    expect(state().plan!.project.mode).toBe('Track');
    expect(task(2)).toMatchObject({ plannedStart: MON, plannedStartPM: true, plannedFinish: TUE, plannedFinishMidday: true });
    expect(result(2)).toMatchObject({ plannedStart: MON, plannedStartPM: true, plannedFinish: TUE, plannedFinishMidday: true });
    expect(result(1)).toMatchObject({ plannedFinishMidday: true });
  });
});
