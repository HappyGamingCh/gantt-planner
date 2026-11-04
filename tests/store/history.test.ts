import { beforeEach, describe, expect, it } from 'vitest';
import type { Change } from '../../src/engine/types';
import { sampleData } from '../../src/sample/sampleData';
import { deleteTasks, editTask, setMode } from '../../src/store/edit';
import { changesUnsaved } from '../../src/store/selectors';
import { useStore } from '../../src/store/store';
import { redo, undo } from '../../src/store/undo';
import { ids, load, result, small, state, task } from './editHelpers';

describe('the delete toast’s Undo undoes the delete only — SPEC §7.11, §8', () => {
  beforeEach(() => load(small()));

  it('a later edit retires the toast, and its stale action does nothing', () => {
    deleteTasks([4]);
    const action = state().toast!.action!;
    editTask(1, 'name', 'Excavate');
    expect(state().toast).toBeNull();
    action.run();
    expect(task(1).name).toBe('Excavate');
    expect(ids()).toEqual([1, 2, 3]);
  });

  it('after Ctrl+Z has undone the delete, the toast goes and can’t undo an earlier edit', () => {
    editTask(1, 'name', 'Excavate');
    deleteTasks([4]);
    const action = state().toast!.action!;
    undo();
    expect(state().toast).toBeNull();
    action.run();
    expect(task(1).name).toBe('Excavate');
    expect(ids()).toEqual([1, 2, 3, 4]);
  });

  it('a toast without an action stays', () => {
    load(small('Track'));
    editTask(1, 'progress', 40);
    editTask(4, 'name', 'Survey');
    expect(state().toast?.message).toBe('Actual start set to 13 Nov — change if needed');
  });
});

describe('"Plan recalculated" in Changes follows undo — SPEC §7.11', () => {
  // Task 9's stored dates break its links, so Plan mode moves it.
  const stale = () => ({ ...sampleData, tasks: sampleData.tasks.map((t) => (t.id === 9 ? { ...t, plannedStart: '2026-10-05', plannedFinish: '2026-10-06' } : t)) });
  const recalculated = () => state().changes.filter((c) => c.reason === 'Plan recalculated');

  beforeEach(() => {
    load(stale());
    useStore.setState({ planModeConfirmed: true });
  });

  it('undo removes the entries of the switch it undoes; switching again lists them once', () => {
    setMode('Plan');
    setMode('Track');
    expect(recalculated()).toHaveLength(2);
    undo();
    undo();
    expect(state().plan!.project.mode).toBe('Track');
    expect(recalculated()).toHaveLength(0);
    setMode('Plan');
    expect(recalculated()).toHaveLength(2);
  });

  it('the file chip reads the very list Save wrote as saved, also after undo and redo; a merged list is not', () => {
    setMode('Plan');
    const saved = state().changes;
    useStore.setState({ changesSaved: saved, cleanPlan: state().plan, dirty: false }); // what Save does
    expect(changesUnsaved(state())).toBe(false);
    undo();
    expect(changesUnsaved(state())).toBe(false); // nothing listed
    redo();
    expect(state().changes).toBe(saved);
    expect(changesUnsaved(state())).toBe(false);
    // A later recalculation of the same dates merges into the list: as long as before, but not what Save wrote.
    useStore.setState({ changes: saved.map((c) => ({ ...c, to: '2026-12-01' })) });
    expect(changesUnsaved(state())).toBe(true);
  });

  it('a date recalculated again keeps one entry, from its value before the first recalculation', () => {
    const earlier: Change = { taskId: 9, field: 'Planned Start', from: '2026-10-07', to: '2026-10-05', kind: 'corrected', reason: 'Plan recalculated' };
    useStore.setState({ changes: [earlier] });
    setMode('Plan');
    expect(recalculated()).toEqual([
      { ...earlier, to: result(9).plannedStart },
      { taskId: 9, field: 'Planned Finish', from: '2026-10-06', to: result(9).plannedFinish, kind: 'corrected', reason: 'Plan recalculated' },
    ]);
  });
});
