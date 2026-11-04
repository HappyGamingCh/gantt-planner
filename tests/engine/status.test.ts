import { describe, expect, it } from 'vitest';
import { taskStatus } from '../../src/engine/status';
import { makeTask, run, taskOf } from './helpers';

// Task: Mon 2 – Wed 11 Nov (10 days), in progress since 2 Nov. Status date Mon 9 Nov → R = Tue 10 Nov.
const inProgress = (progress: number) =>
  taskOf(run([makeTask(1, { plannedDuration: 10, actualStart: '2026-11-02', progress })], { statusDate: '2026-11-09' }), 1);

describe('status & variance', () => {
  it('early: negative variance, In Progress', () => {
    expect(inProgress(90)).toMatchObject({ forecastFinish: '2026-11-10', variance: -1, status: 'In Progress' });
  });

  it('on time: zero variance', () => {
    expect(inProgress(80)).toMatchObject({ forecastFinish: '2026-11-11', variance: 0, status: 'In Progress' });
  });

  it('late: behind on progress → later forecast finish → Late', () => {
    expect(inProgress(70)).toMatchObject({ forecastFinish: '2026-11-12', variance: 1, status: 'Late' });
  });

  it('completed late keeps a positive variance but is Completed', () => {
    const r = run([makeTask(1, { plannedDuration: 10, actualStart: '2026-11-02', actualFinish: '2026-11-12', progress: 100 })], {
      statusDate: '2026-11-18',
    });
    expect(taskOf(r, 1)).toMatchObject({ variance: 1, status: 'Completed' });
  });

  it('completed early has a negative variance', () => {
    const r = run([makeTask(1, { plannedDuration: 10, actualStart: '2026-11-02', actualFinish: '2026-11-10', progress: 100 })]);
    expect(taskOf(r, 1)).toMatchObject({ variance: -1, status: 'Completed' });
  });

  it('follows the precedence Completed → Late → In Progress → Not Started', () => {
    expect(taskStatus(true, 3, true)).toBe('Completed');
    expect(taskStatus(false, 1, false)).toBe('Late');
    expect(taskStatus(false, 0, true)).toBe('In Progress');
    expect(taskStatus(false, -2, false)).toBe('Not Started');
  });

  it('progress without an Actual Start still counts as In Progress', () => {
    const r = run([makeTask(1, { plannedStart: '2026-11-12', plannedDuration: 5, progress: 10 })], { statusDate: '2026-11-11' });
    expect(taskOf(r, 1).status).toBe('In Progress');
  });
});
