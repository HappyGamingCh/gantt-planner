import { beforeEach, describe, expect, it } from 'vitest';
import { OPTIONAL_COLUMNS } from '../../src/config';
import { computePlan } from '../../src/engine/compute';
import type { Plan } from '../../src/engine/types';
import { linkSelected } from '../../src/store/edit';
import { rowsOf } from '../../src/store/selectors';
import { CLOSED, select, useStore } from '../../src/store/store';
import { visibleColumns } from '../../src/ui/grid/columns';
import { clearCell, gridKey, heldWhileEditing, keepActive, startsTyping, type GridAt, type GridCell, type GridKey, type HiddenCell } from '../../src/ui/grid/gridKeys';
import { makeProject, makeTask } from '../engine/helpers';

const key = (k: string, mods: Partial<GridKey> = {}): GridKey => ({ key: k, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods });
/** Row 3 of 5, column 2 (Task) of 9 active; only that row selected; no drawer. */
const at = (fields: Partial<GridAt> = {}): GridAt => ({
  active: { row: 2, col: 1 },
  rows: 5,
  cols: 9,
  focus: 2,
  selected: true,
  count: 1,
  idCell: false,
  overlay: false,
  ...fields,
});

describe('grid keys — SPEC §7.7, §7.12', () => {
  it('typing starts an edit, but / and ? stay shortcuts and never overwrite the cell', () => {
    expect(gridKey(key('a'), at())).toEqual({ kind: 'type', seed: 'a' });
    expect(gridKey(key('ห'), at())).toEqual({ kind: 'type', seed: 'ห' }); // Thai text types as usual
    expect(gridKey(key('/'), at())).toBeNull();
    expect(gridKey(key('?', { shiftKey: true }), at())).toBeNull();
    expect([startsTyping('5'), startsTyping('/'), startsTyping('?'), startsTyping('Enter')]).toEqual([true, false, false, false]);
  });

  it('arrows move; Ctrl, Alt and Meta keys are left to the window shortcuts', () => {
    expect(gridKey(key('ArrowDown'), at())).toEqual({ kind: 'move', row: 3, col: 1 });
    expect(gridKey(key('ArrowLeft'), at())).toEqual({ kind: 'move', row: 2, col: 0 });
    expect(gridKey(key('ArrowDown', { altKey: true }), at())).toBeNull();
    expect(gridKey(key('z', { ctrlKey: true }), at())).toBeNull();
  });

  it('Tab moves along the row and leaves the grid at either end (no keyboard trap)', () => {
    expect(gridKey(key('Tab'), at())).toEqual({ kind: 'move', row: 2, col: 2 });
    expect(gridKey(key('Tab'), at({ active: { row: 2, col: 8 } }))).toBeNull();
    expect(gridKey(key('Tab', { shiftKey: true }), at({ active: { row: 2, col: 0 } }))).toBeNull();
    expect(gridKey(key('Tab'), at({ active: null }))).toBeNull();
  });

  it('Esc clears the active cell unless a drawer or panel is open (the window closes it first)', () => {
    expect(gridKey(key('Escape'), at())).toEqual({ kind: 'leave' });
    expect(gridKey(key('Escape'), at({ overlay: true }))).toBeNull();
  });

  it('arrows come back on the row the selection ends on, else the first row', () => {
    expect(gridKey(key('ArrowDown'), at({ active: null, focus: 3 }))).toEqual({ kind: 'move', row: 3, col: 1 });
    expect(gridKey(key('ArrowUp'), at({ active: null, focus: -1 }))).toEqual({ kind: 'move', row: 0, col: 1 });
    expect(gridKey(key('ArrowDown'), at({ active: null, rows: 0 }))).toBeNull();
  });

  it('Enter / F2 edit or open the task details; Shift+F2 is the window shortcut', () => {
    expect(gridKey(key('Enter'), at())).toEqual({ kind: 'open' });
    expect(gridKey(key('F2'), at({ idCell: true }))).toEqual({ kind: 'open' });
    expect(gridKey(key('F2', { shiftKey: true }), at())).toBeNull();
  });

  it('Delete / Backspace clear the cell; on the ID cell or with several rows selected Delete deletes the tasks', () => {
    expect(gridKey(key('Delete'), at())).toEqual({ kind: 'clear' });
    expect(gridKey(key('Backspace'), at())).toEqual({ kind: 'clear' });
    expect(gridKey(key('Delete'), at({ idCell: true }))).toBeNull();
    expect(gridKey(key('Delete'), at({ count: 3 }))).toBeNull();
    // Nothing selected (after a delete, or a search pruned the selection): the visible active cell still clears.
    expect(gridKey(key('Delete'), at({ selected: false, count: 0 }))).toEqual({ kind: 'clear' });
    expect(gridKey(key('Backspace'), at({ selected: false, count: 1 }))).toEqual({ kind: 'clear' });
    expect(gridKey(key('Delete'), at({ active: null }))).toBeNull(); // no active cell (after Esc): deletes the selection
    expect(gridKey(key('Delete', { ctrlKey: true }), at())).toBeNull();
  });

  it('while an editor is open on the grid, Delete and typed keys never reach the window shortcuts', () => {
    expect([key('Delete'), key('Backspace'), key('Delete', { ctrlKey: true }), key('/'), key('?', { shiftKey: true }), key('S')].map(heldWhileEditing)).toEqual([true, true, true, true, true, true]);
    expect([key('s', { ctrlKey: true }), key('z', { metaKey: true }), key('Enter'), key('ArrowDown')].map(heldWhileEditing)).toEqual([false, false, false, false]);
  });

  it('Shift+↑/↓ extend the selection from the active row, or from the selection end when it is elsewhere', () => {
    expect(gridKey(key('ArrowDown', { shiftKey: true }), at())).toEqual({ kind: 'move', row: 3, col: 1, extend: true });
    expect(gridKey(key('ArrowUp', { shiftKey: true }), at({ selected: false, focus: 4 }))).toEqual({ kind: 'move', row: 3, col: 1, extend: true });
    expect(gridKey(key('ArrowRight', { shiftKey: true }), at())).toEqual({ kind: 'move', row: 2, col: 2 });
  });
});

describe('the active cell when its row goes — SPEC §7.7', () => {
  type Keys = GridCell['col'][];
  const all = [10, 11, 12, 13, 22];
  const cols: Keys = ['id', 'task', 'assigned'];
  interface State {
    active: GridCell | null;
    hidden: HiddenCell | null;
    lastRow: number;
  }
  /** The grid's effect, run again after each change as React does, until the active cell settles. */
  const settle = (s: State, order: number[], tasks = all, shown = cols): State => {
    for (let n = 0; n < 5; n++) {
      const kept = keepActive(s.active, s.hidden, s.lastRow, order, shown, (id) => tasks.includes(id));
      s = { active: kept.next === undefined ? s.active : kept.next, hidden: kept.hidden, lastRow: kept.lastRow };
      if (kept.next === undefined) return s;
    }
    throw new Error('the active cell never settles');
  };
  const on12 = (): State => settle({ active: { id: 12, col: 'assigned' }, hidden: null, lastRow: 0 }, all);

  it('a deleted row: the row now in its place, same column; the last row when it was the last', () => {
    expect(settle(on12(), [10, 11, 13, 22], [10, 11, 13, 22]).active).toEqual({ id: 13, col: 'assigned' });
    const last = settle({ active: { id: 22, col: 'task' }, hidden: null, lastRow: 0 }, all);
    expect(settle(last, [10, 11, 12, 13], [10, 11, 12, 13])).toMatchObject({ active: { id: 13, col: 'task' }, hidden: null });
  });

  it('a row the search hides stands in with the row now there and comes back when the search clears', () => {
    const start = on12();
    const searched = settle(start, [22]);
    expect(searched.active).toEqual({ id: 22, col: 'assigned' });
    expect(settle(searched, all).active).toBe(start.active);
    // Narrowed twice, then nothing matches: the original still comes back.
    const narrowed = settle(settle(settle(start, [13, 22]), [13]), []);
    expect(narrowed.active).toBeNull();
    expect(settle(narrowed, all).active).toBe(start.active);
  });

  it('once the user moves on, clearing the search leaves the active cell where the user put it', () => {
    const searched = settle(on12(), [13, 22]);
    const moved: State = { ...searched, active: { id: 13, col: 'task' } };
    expect(settle(settle(moved, [13, 22]), all).active).toEqual({ id: 13, col: 'task' });
  });

  it('a hidden column moves the active cell to Task on the same row', () => {
    expect(settle(on12(), all, all, ['id', 'task']).active).toEqual({ id: 12, col: 'task' });
  });
});

/** 1 (5d) → 2 (2d, Remarks, assigned); 3 finished on 6 Nov; status date Fri 13 Nov. */
const plan = (mode: 'Plan' | 'Track'): Plan => ({
  project: makeProject({ mode }),
  tasks: [
    makeTask(1, { plannedDuration: 5 }),
    makeTask(2, { plannedDuration: 2, predecessorsText: '1', assigned: ['Somchai'], remarks: 'Check valve' }),
    makeTask(3, { plannedDuration: 3, progress: 100, actualStart: '2026-11-02', actualFinish: '2026-11-06' }),
  ],
  resources: [],
  holidays: [],
});

describe('Delete clears the active cell — SPEC §7.12, §8', () => {
  const state = () => useStore.getState();
  const task = (id: number) => state().plan!.tasks.find((t) => t.id === id)!;
  const columns = visibleColumns(OPTIONAL_COLUMNS);
  const clear = (id: number, col: string) => {
    const { plan: p, result } = state();
    const row = rowsOf(p!, result!).find((r) => r.task.id === id)!;
    clearCell(row, columns.find((c) => c.key === col)!, p!.project.mode);
  };
  const load = (p: Plan) => useStore.setState({ ...CLOSED, plan: p, result: computePlan(p), cleanPlan: p, toast: null });

  describe('Plan mode', () => {
    beforeEach(() => load(plan('Plan')));

    it('blanks Predecessors, Assigned and Remarks, one undo step each', () => {
      clear(2, 'predecessors');
      clear(2, 'assigned');
      clear(2, 'remarks');
      expect(task(2)).toMatchObject({ predecessorsText: '', assigned: [], remarks: '' });
      expect(state()).toMatchObject({ dirty: true });
      expect(state().undo).toHaveLength(3);
    });

    it("a linked Start, a required field or a calculated cell isn't cleared: a toast says why", () => {
      clear(2, 'start');
      expect(state().toast?.message).toBe('Set by predecessors — add lag to delay.');
      clear(1, 'task');
      expect(state().toast?.message).toBe("Task name can't be blank — press Ctrl+Delete to delete the task.");
      clear(1, 'duration');
      expect(state().toast?.message).toBe("Duration can't be blank — press Ctrl+Delete to delete the task.");
      clear(1, 'status');
      expect(state().toast?.message).toBe("Calculated — this cell can't be cleared.");
      clear(3, 'actualFinish');
      expect(state().toast?.message).toBe('Switch to Track mode to update progress.');
      expect(state().undo).toHaveLength(0);
      expect(task(1).name).toBe('Task 1');
    });

    it('Ctrl+L with one task selected says how to select more instead of doing nothing (§7.6)', () => {
      select(1);
      linkSelected();
      expect(state().toast?.message).toBe('Select two or more tasks to link (Shift+↑/↓ or Shift+click).');
      expect(state().undo).toHaveLength(0);
    });
  });

  describe('Track mode', () => {
    beforeEach(() => load(plan('Track')));

    it('clearing Actual Finish keeps the task and puts progress at 99 (§8)', () => {
      clear(3, 'actualFinish');
      expect(task(3)).toMatchObject({ actualFinish: undefined, progress: 99, actualStart: '2026-11-02' });
      expect(state().toast?.message).toBe('Progress set to 99% — the task has no actual finish');
      expect(state().plan!.tasks).toHaveLength(3);
    });

    it('the baseline stays locked', () => {
      clear(1, 'finish');
      expect(state().toast?.message).toBe('Switch to Plan mode to change the baseline.');
      expect(state().undo).toHaveLength(0);
    });
  });
});
