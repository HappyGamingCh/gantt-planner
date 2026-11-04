import { describe, expect, it } from 'vitest';
import { MAX_DAYS } from '../../src/config';
import { issuesOf, makeTask, run, taskOf } from './helpers';

// Project Start Mon 2 Nov 2026, Plan mode unless stated. Weekends are working days.

describe('planned schedule — links', () => {
  it('SPEC §5.4 example: FS and SS+2', () => {
    const r = run([
      makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 5 }),
      makeTask(2, { predecessorsText: '1', plannedDuration: 3 }),
      makeTask(3, { predecessorsText: '1SS+2', plannedDuration: 1 }),
    ]);
    expect(taskOf(r, 1).plannedFinish).toBe('2026-11-06');
    expect(taskOf(r, 2).plannedStart).toBe('2026-11-07');
    expect(taskOf(r, 2).plannedFinish).toBe('2026-11-09');
    expect(taskOf(r, 3).plannedStart).toBe('2026-11-04');
  });

  it.each([
    ['1+2', '2026-11-09'], // FS lag 2
    ['1-2', '2026-11-05'], // FS lead 2
    ['1SS-1', '2026-11-01'], // SS lead 1
    ['1SS+4', '2026-11-06'],
  ])('lag/lead %s → %s', (pred, start) => {
    const r = run([makeTask(1, { plannedDuration: 5 }), makeTask(2, { predecessorsText: pred, plannedDuration: 1 })]);
    expect(taskOf(r, 2).plannedStart).toBe(start);
  });

  it('with several predecessors the latest start wins', () => {
    const r = run([
      makeTask(1, { plannedDuration: 5 }), // 2–6 Nov
      makeTask(2, { plannedDuration: 2 }), // 2–3 Nov
      makeTask(3, { predecessorsText: '1, 2', plannedDuration: 1 }),
      makeTask(4, { predecessorsText: '2, 1SS+4', plannedDuration: 1 }),
    ]);
    expect(taskOf(r, 3).plannedStart).toBe('2026-11-07');
    expect(taskOf(r, 4).plannedStart).toBe('2026-11-06');
  });

  it('milestones: no FS gap into a milestone; after it, the next working day unless it is a start milestone', () => {
    const r = run([
      makeTask(1, { plannedDuration: 5 }), // ends Fri 6 Nov
      makeTask(2, { predecessorsText: '1', plannedDuration: 0 }), // end of 6 Nov
      makeTask(3, { predecessorsText: '2', plannedDuration: 2 }),
      makeTask(4, { predecessorsText: '1' }), // blank duration is not a milestone
      makeTask(5, { plannedDuration: 0 }), // start milestone: start of Mon 2 Nov
      makeTask(6, { predecessorsText: '5', plannedDuration: 0 }), // only start-milestone predecessors: also a start milestone
      makeTask(7, { predecessorsText: '6', plannedDuration: 1 }),
    ]);
    expect(taskOf(r, 2)).toMatchObject({ plannedStart: '2026-11-06', plannedFinish: '2026-11-06', plannedDuration: 0 });
    expect(taskOf(r, 3)).toMatchObject({ plannedStart: '2026-11-07', plannedFinish: '2026-11-08' });
    expect(taskOf(r, 4)).toMatchObject({ plannedStart: '2026-11-07', plannedDuration: 1 });
    expect(taskOf(r, 6).plannedStart).toBe('2026-11-02');
    expect(taskOf(r, 7)).toMatchObject({ plannedStart: '2026-11-02', plannedFinish: '2026-11-02' });
  });

  it('a milestone between two tasks does not move the successor (A → M → B equals A → B)', () => {
    const r = run([
      makeTask(1, { plannedDuration: 5 }), // 2–6 Nov
      makeTask(2, { predecessorsText: '1+2', plannedDuration: 0 }),
      makeTask(3, { predecessorsText: '2', plannedDuration: 1 }),
      makeTask(4, { predecessorsText: '1+2', plannedDuration: 1 }),
    ]);
    expect(taskOf(r, 2).plannedStart).toBe('2026-11-08');
    expect(taskOf(r, 3).plannedStart).toBe('2026-11-09');
    expect(taskOf(r, 4).plannedStart).toBe('2026-11-09');
  });

  it('a linked start that differs from the file is corrected (W_START_DRIVEN); a blank one is filled', () => {
    const r = run([
      makeTask(1, { plannedDuration: 5 }),
      makeTask(2, { predecessorsText: '1', plannedStart: '2026-11-04', plannedDuration: 1 }),
      makeTask(3, { predecessorsText: '1', plannedDuration: 1 }),
    ]);
    expect(taskOf(r, 2).plannedStart).toBe('2026-11-07');
    expect(r.changes).toContainEqual({
      taskId: 2,
      field: 'Planned Start',
      from: '2026-11-04',
      to: '2026-11-07',
      kind: 'corrected',
      reason: 'Driven by predecessors — use lag to delay',
    });
    expect(issuesOf(r, 2)).toEqual(['W_START_DRIVEN']);
    expect(r.issues.find((i) => i.taskId === 2)?.severity).toBe('info');
    expect(r.changes).toContainEqual(expect.objectContaining({ taskId: 3, field: 'Planned Start', kind: 'filled' }));
    expect(issuesOf(r, 3)).toEqual([]);
  });
});

describe('planned schedule — root tasks, duration and finish', () => {
  it('root task on a holiday snaps to the next working day (W_NONWORKDAY); a weekend start stays', () => {
    const r = run([makeTask(1, { plannedStart: '2026-11-04', plannedDuration: 2 })], {}, ['2026-11-04']);
    expect(taskOf(r, 1)).toMatchObject({ plannedStart: '2026-11-05', plannedFinish: '2026-11-06' });
    expect(r.changes).toContainEqual(expect.objectContaining({ field: 'Planned Start', kind: 'corrected', reason: 'Moved to next working day' }));
    expect(issuesOf(r)).toEqual(['W_NONWORKDAY']);

    const weekend = run([makeTask(1, { plannedStart: '2026-11-07', plannedDuration: 2 })]);
    expect(taskOf(weekend, 1)).toMatchObject({ plannedStart: '2026-11-07', plannedFinish: '2026-11-08' });
    expect(weekend.issues).toEqual([]);
  });

  it('root task without a start uses Project Start, snapped forward', () => {
    const r = run([makeTask(1, { plannedDuration: 1 })], { projectStart: '2026-11-01' }, ['2026-11-01']);
    expect(taskOf(r, 1).plannedStart).toBe('2026-11-02');
    expect(r.changes).toContainEqual(expect.objectContaining({ field: 'Planned Start', kind: 'filled', to: '2026-11-02' }));
  });

  it('blank duration is derived from the finish in the file', () => {
    const r = run([makeTask(1, { plannedStart: '2026-11-02', plannedFinish: '2026-11-11' })]);
    expect(taskOf(r, 1)).toMatchObject({ plannedDuration: 10, plannedFinish: '2026-11-11' });
    expect(r.changes).toContainEqual(expect.objectContaining({ field: 'Planned Duration', to: 10, kind: 'filled' }));
    expect(r.changes.some((c) => c.field === 'Planned Finish')).toBe(false);
    expect(r.issues).toEqual([]);
  });

  it('blank duration without a usable finish becomes 1 day (W_NO_DURATION)', () => {
    const none = run([makeTask(1, { plannedStart: '2026-11-02' })]);
    expect(taskOf(none, 1)).toMatchObject({ plannedDuration: 1, plannedFinish: '2026-11-02' });
    expect(issuesOf(none)).toEqual(['W_NO_DURATION']);

    const before = run([makeTask(1, { plannedStart: '2026-11-04', plannedFinish: '2026-11-02' })]);
    expect(taskOf(before, 1)).toMatchObject({ plannedDuration: 1, plannedFinish: '2026-11-04' });
    expect(issuesOf(before)).toEqual(['W_NO_DURATION', 'W_FINISH_RECALC']);
  });

  it('duration wins over finish (W_FINISH_RECALC)', () => {
    const r = run([makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 5, plannedFinish: '2026-11-20' })]);
    expect(taskOf(r, 1).plannedFinish).toBe('2026-11-06');
    expect(r.changes).toContainEqual({
      taskId: 1,
      field: 'Planned Finish',
      from: '2026-11-20',
      to: '2026-11-06',
      kind: 'corrected',
      reason: 'Recalculated from duration',
    });
    expect(issuesOf(r)).toEqual(['W_FINISH_RECALC']);
  });

  it(`a duration above ${MAX_DAYS} days is W_BAD_NUMBER and treated as blank`, () => {
    const huge = run([makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 46000 })]);
    expect(huge.issues[0]).toMatchObject({ code: 'W_BAD_NUMBER', taskId: 1, message: 'Task 1: "46000" in Planned Duration is not a valid number' });
    expect(issuesOf(huge)).toEqual(['W_BAD_NUMBER', 'W_NO_DURATION']);
    expect(taskOf(huge, 1)).toMatchObject({ plannedDuration: 1, plannedFinish: '2026-11-02' });

    const withFinish = run([makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 1e9, plannedFinish: '2026-11-11' })]);
    expect(issuesOf(withFinish)).toEqual(['W_BAD_NUMBER']);
    expect(taskOf(withFinish, 1)).toMatchObject({ plannedDuration: 10, plannedFinish: '2026-11-11' });

    const max = run([makeTask(1, { plannedStart: '2026-11-02', plannedDuration: MAX_DAYS })]);
    expect(max.issues).toEqual([]);
    expect(taskOf(max, 1).plannedDuration).toBe(MAX_DAYS);
  });

  it('durations skip holidays', () => {
    const r = run([makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 5 })], {}, ['2026-11-04']);
    expect(taskOf(r, 1).plannedFinish).toBe('2026-11-07');
  });
});

describe('Track mode freezes the baseline; Plan mode recomputes', () => {
  const tasks = (fields = {}) => [
    makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 5, plannedFinish: '2026-11-06' }),
    makeTask(2, { predecessorsText: '1', plannedStart: '2026-11-12', plannedDuration: 2, plannedFinish: '2026-11-13', ...fields }),
  ];

  it('Plan mode derives planned values from links', () => {
    const r = run(tasks());
    expect(taskOf(r, 2)).toMatchObject({ plannedStart: '2026-11-07', plannedFinish: '2026-11-08' });
  });

  it('Track mode keeps stored planned values', () => {
    const r = run(tasks(), { mode: 'Track' });
    expect(taskOf(r, 2)).toMatchObject({ plannedStart: '2026-11-12', plannedFinish: '2026-11-13' });
    expect(r.changes.filter((c) => c.taskId === 2)).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it('Track mode derives blank planned fields with the same rules', () => {
    const r = run(tasks({ plannedStart: undefined, plannedFinish: undefined }), { mode: 'Track' });
    expect(taskOf(r, 2)).toMatchObject({ plannedStart: '2026-11-07', plannedFinish: '2026-11-08' });
    const onlyFinishBlank = run(tasks({ plannedFinish: undefined }), { mode: 'Track' });
    expect(taskOf(onlyFinishBlank, 2)).toMatchObject({ plannedStart: '2026-11-12', plannedFinish: '2026-11-13' });
  });

  it('tasks added in Track mode this session are computed as in Plan mode', () => {
    const r = run(tasks({ isNewThisSession: true }), { mode: 'Track' });
    expect(taskOf(r, 2)).toMatchObject({ plannedStart: '2026-11-07', plannedFinish: '2026-11-08' });
  });
});
