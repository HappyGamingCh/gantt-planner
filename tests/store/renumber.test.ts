import { describe, expect, it } from 'vitest';
import type { Change, Plan } from '../../src/engine/types';
import { askRenumber, deleteTasks, editTask, renumber } from '../../src/store/edit';
import { rowsOf, shownRows } from '../../src/store/selectors';
import { openDrawer, revealTask, select, setFilters, useStore } from '../../src/store/store';
import { redo, undo } from '../../src/store/undo';
import { makeProject, makeTask } from '../engine/helpers';
import { ids, load, result, state, task } from './editHelpers';

const plan = (...tasks: Plan['tasks']): Plan => ({ project: makeProject(), tasks, resources: [], holidays: [] });
const errors = () => state().result!.issues.flatMap((i) => (i.severity === 'error' ? [i.code] : []));

describe('Renumber keeps every reference meaning the same task — SPEC §8', () => {
  it('rewrites the ID of an FF/SF link too, keeping the rest as typed', () => {
    load(plan(makeTask(10), makeTask(20), makeTask(30, { predecessorsText: '20FF+1, 10' })));
    const start = result(30).plannedStart;
    renumber();
    expect(task(3).predecessorsText).toBe('2FF+1, 1');
    expect(result(3).plannedStart).toBe(start);
    expect(errors()).toEqual(['E_UNSUPPORTED_LINK']);
  });

  it('is refused while a predecessor names a missing task: it could become another task’s number', () => {
    load(plan(makeTask(10), makeTask(20), makeTask(30, { predecessorsText: '20, 2' }), makeTask(40, { predecessorsText: '7FF' })));
    askRenumber();
    expect(state().dialog).toBeNull();
    expect(state().toast).toMatchObject({ message: 'Fix the predecessors of tasks 30, 40 first — Renumber would change what they point to', action: { label: 'Review' } });
    useStore.setState({ dialog: { kind: 'renumber' } });
    renumber(); // the dialog's button, in case the plan changed meanwhile
    expect(ids()).toEqual([10, 20, 30, 40]);
    expect(task(30).predecessorsText).toBe('20, 2');
    expect(state()).toMatchObject({ dialog: null, undo: [] });
  });

  it('is refused while unreadable predecessor text holds a number', () => {
    load(plan(makeTask(10), makeTask(20, { predecessorsText: '10 days' })));
    askRenumber();
    expect(state().toast?.message).toBe('Fix the predecessors of task 20 first — Renumber would change what they point to');
    expect(ids()).toEqual([10, 20]);
  });
});

describe('Renumber and its undo keep the view on the same tasks — SPEC §7.11, §8', () => {
  const rows = () => plan(makeTask(1, { name: 'T1' }), makeTask(2, { name: 'T2' }), makeTask(4, { name: 'T4' }), makeTask(3, { name: 'T3' }));
  const change: Change = { taskId: 4, field: 'Planned Start', from: '2026-11-02', to: '2026-11-03', kind: 'corrected', reason: 'Driven by predecessors' };

  it('moves the drawer, selection, Shift-click anchor and Changes rows along, and back on undo', () => {
    load(rows());
    useStore.setState({ changes: [change] });
    select(1);
    select(4, 'toggle'); // anchor = T4
    openDrawer(4);
    renumber();
    expect(task(3).name).toBe('T4');
    expect(state()).toMatchObject({ drawerId: 3, selection: [3], anchor: 3 });
    expect(state().changes[0]!.taskId).toBe(3);

    undo();
    expect(task(4).name).toBe('T4');
    expect(state()).toMatchObject({ drawerId: 4, selection: [4], anchor: 4 });
    expect(state().changes[0]!.taskId).toBe(4);

    redo();
    expect(task(3).name).toBe('T4');
    expect(state()).toMatchObject({ drawerId: 3, selection: [3], anchor: 3 });

    undo();
    editTask(state().drawerId!, 'remarks', 'checked');
    expect(task(4)).toMatchObject({ name: 'T4', remarks: 'checked' }); // the task the drawer shows, not T3
  });

  it('a deleted task’s Changes row and pin never point at the task that gets its number', () => {
    load(plan(...[1, 2, 3, 4, 5, 6].map((id) => makeTask(id, { name: `T${id}` }))));
    useStore.setState({ changes: [{ ...change, taskId: 5 }, { ...change, taskId: 6 }] });
    setFilters({ text: 'zzz' });
    revealTask(5); // pinned [5]
    deleteTasks([5]);
    renumber();
    expect(task(5).name).toBe('T6');
    expect(state().changes.map((c) => c.taskId)).toEqual([undefined, 5]); // the deleted task's row names no task
    expect(state().pinned).toEqual([]);
    expect(shownRows(rowsOf(state().plan!, state().result!), state().filters, state().pinned)).toEqual([]); // T6 stays filtered out

    undo();
    expect(state().changes.map((c) => c.taskId)).toEqual([5, 6]);
  });
});
