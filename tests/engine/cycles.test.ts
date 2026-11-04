import { describe, expect, it } from 'vitest';
import { issuesOf, makeTask, run, taskOf } from './helpers';

describe('cycles', () => {
  const cycle = () => [
    makeTask(1, { predecessorsText: '3', plannedDuration: 1 }),
    makeTask(2, { predecessorsText: '1', plannedDuration: 1 }),
    makeTask(3, { predecessorsText: '2', plannedDuration: 1 }),
  ];

  it('reports the cycle once and ignores its links for calculation', () => {
    const r = run(cycle());
    expect(r.issues).toEqual([
      expect.objectContaining({ code: 'E_CYCLE', severity: 'error', taskId: 1, message: 'Circular dependency: 1, 2, 3' }),
    ]);
    for (const id of [1, 2, 3]) {
      expect(taskOf(r, id).plannedStart).toBe('2026-11-02'); // treated as root tasks
      expect(taskOf(r, id).links).toEqual([]);
    }
    expect(taskOf(r, 2).predecessorsText).toBe('1'); // notation itself is valid: kept
  });

  it('keeps calculating tasks downstream and upstream of a cycle', () => {
    const r = run([
      makeTask(5, { plannedDuration: 2 }), // 2–3 Nov
      makeTask(1, { predecessorsText: '3, 5', plannedDuration: 1 }),
      makeTask(2, { predecessorsText: '1', plannedDuration: 1 }),
      makeTask(3, { predecessorsText: '2', plannedDuration: 1 }),
      makeTask(4, { predecessorsText: '3', plannedDuration: 1 }),
    ]);
    expect(issuesOf(r)).toEqual(['E_CYCLE']);
    expect(taskOf(r, 1).plannedStart).toBe('2026-11-04'); // still driven by 5
    expect(taskOf(r, 3).plannedStart).toBe('2026-11-02');
    expect(taskOf(r, 4).plannedStart).toBe('2026-11-03'); // still driven by 3
    expect(taskOf(r, 4).links).toEqual([{ predId: 3, type: 'FS', lag: 0 }]);
  });

  it('reports separate cycles separately', () => {
    const r = run([
      ...cycle(),
      makeTask(7, { predecessorsText: '8SS', plannedDuration: 1 }),
      makeTask(8, { predecessorsText: '7', plannedDuration: 1 }),
    ]);
    expect(r.issues.map((i) => i.message)).toEqual(['Circular dependency: 1, 2, 3', 'Circular dependency: 7, 8']);
  });
});
