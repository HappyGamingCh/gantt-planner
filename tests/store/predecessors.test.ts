import { describe, expect, it } from 'vitest';
import { dependents, linksOf, renumberBlockers, renumberLinks, withLink, withoutLinks, wouldCycle } from '../../src/store/predecessors';
import { makeTask } from '../engine/helpers';

describe('predecessor text edits — SPEC §5.2, §8', () => {
  it('adds a link in canonical form, replacing one to the same predecessor', () => {
    expect(withLink('', { predId: 3, type: 'FS', lag: 0 })).toBe('3');
    expect(withLink('3,5ss', { predId: 7, type: 'SS', lag: -1 })).toBe('3, 5SS, 7SS-1');
    expect(withLink('3, 5SS', { predId: 5, type: 'FS', lag: 2 })).toBe('3, 5FS+2');
  });

  it('keeps tokens it cannot read', () => {
    expect(withLink('3, abc', { predId: 4, type: 'FS', lag: 0 })).toBe('3, abc, 4');
    expect(withoutLinks('3, abc, 4FF', new Set([3]))).toBe('abc, 4FF');
  });

  it('removes links; leaves text alone when nothing is removed', () => {
    expect(withoutLinks('3, 5SS+1, 7', new Set([5, 7]))).toBe('3');
    expect(withoutLinks('3 , 4', new Set([9]))).toBe('3 , 4');
  });

  it('renumbers references, FF/SF links included (the rest as typed)', () => {
    expect(renumberLinks('10, 12SS+1, x', new Map([[10, 1], [12, 2]]))).toBe('1, 2SS+1, x');
    expect(renumberLinks('5', new Map([[10, 1]]))).toBe('5');
    expect(renumberLinks('20ff+2, 10', new Map([[20, 2], [10, 1]]))).toBe('2ff+2, 1');
    expect(renumberLinks('20 SF', new Map([[20, 2]]))).toBe('2 SF');
  });

  it('finds the references Renumber would give another meaning', () => {
    const tasks = [
      makeTask(10),
      makeTask(20, { predecessorsText: '10FF, 10' }), // fine: FF to a task that exists
      makeTask(30, { predecessorsText: '20, 3' }), // 3 doesn't exist
      makeTask(40, { predecessorsText: '7SF' }), // FF/SF to a missing task
      makeTask(50, { predecessorsText: '2 weeks' }), // unreadable, with a number
      makeTask(60, { predecessorsText: 'TBD, 50' }), // unreadable, no number: kept as typed
    ];
    expect(renumberBlockers(tasks)).toEqual([30, 40, 50]);
  });

  it('finds what depends on a task, and what would close a cycle', () => {
    const tasks = [makeTask(1), makeTask(2, { predecessorsText: '1' }), makeTask(3, { predecessorsText: '2SS' }), makeTask(4)];
    expect([...dependents(tasks, 1)].sort()).toEqual([2, 3]);
    expect(linksOf(tasks[2]!)).toEqual([{ predId: 2, type: 'SS', lag: 0 }]);
    expect(wouldCycle(tasks, 3, 1)).toBe(true); // 1 → 2 → 3 → 1
    expect(wouldCycle(tasks, 1, 1)).toBe(true);
    expect(wouldCycle(tasks, 4, 1)).toBe(false);
  });
});
