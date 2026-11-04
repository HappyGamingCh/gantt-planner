import { describe, expect, it } from 'vitest';
import { makeTask, run, taskOf } from './helpers';

// Status date Fri 13 Nov 2026 → R = Sat 14 Nov.

describe('forecast', () => {
  it('completed: Actual Start → Actual Finish', () => {
    const r = run([makeTask(1, { plannedDuration: 5, actualStart: '2026-11-03', actualFinish: '2026-11-10', progress: 100 })]);
    expect(taskOf(r, 1)).toMatchObject({ forecastStart: '2026-11-03', forecastFinish: '2026-11-10' });
  });

  it.each([
    [10, 33, '2026-11-20'], // remaining ceil(6.7) = 7 → R + 6
    [10, 99, '2026-11-14'], // remaining max(1, ceil(0.1)) = 1 → R
    [3, 50, '2026-11-15'], // remaining ceil(1.5) = 2
    [3, 0, '2026-11-16'], // started, nothing done: full duration from R
  ])('in progress: duration %i at %i%% finishes %s', (duration, progress, finish) => {
    const r = run([makeTask(1, { plannedDuration: duration, actualStart: '2026-11-02', progress })]);
    expect(taskOf(r, 1)).toMatchObject({ forecastStart: '2026-11-02', forecastFinish: finish });
  });

  it('not started and past its planned start: pushed to R', () => {
    const r = run([makeTask(1, { plannedStart: '2026-11-09', plannedDuration: 3 })]);
    expect(taskOf(r, 1)).toMatchObject({ forecastStart: '2026-11-14', forecastFinish: '2026-11-16', variance: 5, status: 'Late' });
  });

  it('not started in the future: stays on plan', () => {
    const r = run([makeTask(1, { plannedStart: '2026-11-18', plannedDuration: 2 })]);
    expect(taskOf(r, 1)).toMatchObject({ forecastStart: '2026-11-18', forecastFinish: '2026-11-19', status: 'Not Started' });
  });

  it('pushed by a late predecessor (FS)', () => {
    const r = run([
      makeTask(1, { plannedDuration: 10, actualStart: '2026-11-02', progress: 50 }), // forecast finish Wed 18 Nov
      makeTask(2, { predecessorsText: '1', plannedDuration: 2 }), // planned 12–13 Nov
    ]);
    expect(taskOf(r, 1).forecastFinish).toBe('2026-11-18');
    expect(taskOf(r, 2)).toMatchObject({ forecastStart: '2026-11-19', forecastFinish: '2026-11-20', variance: 7, status: 'Late' });
  });

  it('pushed by a late predecessor (SS)', () => {
    const r = run([
      makeTask(1, { plannedStart: '2026-11-09', plannedDuration: 5 }), // not started → starts R
      makeTask(2, { predecessorsText: '1SS+2', plannedDuration: 1 }), // planned Wed 11 Nov
    ]);
    expect(taskOf(r, 2)).toMatchObject({ plannedStart: '2026-11-11', forecastStart: '2026-11-16' });
  });

  it('FS after a milestone: same day after a start milestone, next working day after one that follows a task', () => {
    const r = run([
      makeTask(1, { plannedStart: '2026-11-18', plannedDuration: 0 }),
      makeTask(2, { predecessorsText: '1', plannedDuration: 1 }),
      makeTask(3, { predecessorsText: '2', plannedDuration: 0 }),
      makeTask(4, { predecessorsText: '3', plannedDuration: 1 }),
    ]);
    expect(taskOf(r, 2).forecastStart).toBe('2026-11-18');
    expect(taskOf(r, 3).forecastStart).toBe('2026-11-18');
    expect(taskOf(r, 4).forecastStart).toBe('2026-11-19');
  });

  it('in-progress tasks are not moved by predecessors', () => {
    const r = run([
      makeTask(1, { plannedDuration: 10, actualStart: '2026-11-02', progress: 50 }),
      makeTask(2, { predecessorsText: '1', plannedDuration: 2, actualStart: '2026-11-12', progress: 50 }),
    ]);
    expect(taskOf(r, 2)).toMatchObject({ forecastStart: '2026-11-12', forecastFinish: '2026-11-14' });
  });

  it('an Actual Start after the status date counts remaining work from that start', () => {
    const r = run([makeTask(1, { plannedDuration: 3, actualStart: '2026-11-18', progress: 10 })]);
    expect(taskOf(r, 1)).toMatchObject({ forecastStart: '2026-11-18', forecastFinish: '2026-11-20' });
  });
});
