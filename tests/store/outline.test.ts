import { beforeEach, describe, expect, it } from 'vitest';
import type { Plan, Task } from '../../src/engine/types';
import { addTask, deleteSelected, deleteTasks, linkSelected, moveSelected } from '../../src/store/edit';
import { collapseAll, dropRow, expandAll, groupSelected, indentSelected, outdentSelected, setCollapsedOf, toggleCollapsed, ungroupSelected } from '../../src/store/outline';
import { dropLevels, indent, moveAmongSiblings, moveBlock, outdent } from '../../src/store/outlineOps';
import { rowsOf, shownRows } from '../../src/store/selectors';
import { NO_FILTERS, setFilters, useStore } from '../../src/store/store';
import { undo } from '../../src/store/undo';
import { makeProject, makeTask } from '../engine/helpers';
import { ids, load, result, state, task } from './editHelpers';

// Major tasks (SPEC §5.12, §7.7, §8).

const levels = () => state().plan!.tasks.map((t) => [t.id, t.level ?? 1]);
const select = (...selection: number[]) => useStore.setState({ selection, anchor: selection.at(-1) ?? null });

/** 1 Refractory › 2 Arch Panel › 3, 4 · 5 Convection › 6 · 7 (top level). */
function outlined(): Plan {
  const t = (id: number, level: number, fields: Partial<Task> = {}) => makeTask(id, { level, plannedDuration: 1, ...fields });
  return {
    project: makeProject(),
    tasks: [t(1, 1, { name: 'Refractory' }), t(2, 2, { name: 'Arch Panel' }), t(3, 3), t(4, 3, { predecessorsText: '3' }), t(5, 2, { name: 'Convection' }), t(6, 3), t(7, 1)],
    resources: [],
    holidays: [],
  };
}

/** Four tasks, no Levels (a flat plan from an older file). */
const flat = (): Plan => ({ project: makeProject(), tasks: [1, 2, 3, 4].map((id) => makeTask(id, { plannedDuration: 1 })), resources: [], holidays: [] });

beforeEach(() => load(outlined()));

describe('Indent and Outdent — §8', () => {
  it('Indent makes the row above a major task (a toast says so) and writes every Level out', () => {
    load(flat());
    select(2, 3);
    indentSelected();
    expect(levels()).toEqual([[1, 1], [2, 2], [3, 2], [4, 1]]);
    expect(result(1).summary).toEqual({ tasks: 2, actualFinish: undefined });
    expect(state().toast?.message).toBe('"Task 1" is now a major task: its dates and progress come from its tasks');
    undo();
    expect(state().plan!.tasks.every((t) => t.level === undefined)).toBe(true);
  });

  it('a major task moves with its tasks; the first row and a row already under the row above stay', () => {
    expect(indent(outlined().tasks, [1])).toBeNull(); // the first row
    expect(indent(outlined().tasks, [3])).toBeNull(); // already a task of Arch Panel
    const r = indent(outlined().tasks, [5])!;
    expect(r.tasks.map((t) => t.level)).toEqual([1, 2, 3, 3, 3, 4, 1]); // Convection (with 6) goes under Arch Panel
    expect(r.madeSummaries).toEqual([]);
  });

  it('Outdent is positional: the rows below that were its siblings become its tasks', () => {
    const tasks = outdent(outlined().tasks, [3])!;
    expect(tasks.map((t) => t.level)).toEqual([1, 2, 2, 3, 2, 3, 1]); // 4 is now 3's task
    expect(outdent(outlined().tasks, [7])).toBeNull();
    select(7);
    outdentSelected();
    expect(state().toast?.message).toBe('Already at the top level');
  });
});

describe('Group and Ungroup — §8', () => {
  it('Group puts a new major task above the selection, the rows under it, and opens its name', () => {
    select(6, 7);
    groupSelected();
    const id = state().selection[0]!;
    expect(id).toBe(8);
    expect(ids()).toEqual([1, 2, 3, 4, 5, 8, 6, 7]);
    expect(levels().map(([, l]) => l)).toEqual([1, 2, 3, 3, 2, 1, 2, 2]); // 6 (Level 3) and 7 (Level 1) under 8 at Level 1
    expect(task(8).name).toBe('New group');
    expect(state()).toMatchObject({ drawerId: 8, nameFocus: 8 });
    expect(result(8).summary?.tasks).toBe(2);
  });

  it('Ungroup removes the major task\'s row and moves its tasks up a Level', () => {
    select(2);
    ungroupSelected();
    expect(levels()).toEqual([[1, 1], [3, 2], [4, 2], [5, 2], [6, 3], [7, 1]]);
    select(7);
    ungroupSelected();
    expect(state().toast?.message).toBe('Select a major task to ungroup');
  });
});

describe('moving rows — §7.7, §8', () => {
  it('Alt+↑/↓ swap a row with its neighbour in the same major task; at the edge a toast says to drag', () => {
    select(4);
    moveSelected(-1);
    expect(ids()).toEqual([1, 2, 4, 3, 5, 6, 7]);
    moveSelected(-1);
    expect(ids()).toEqual([1, 2, 4, 3, 5, 6, 7]);
    expect(state().toast?.message).toBe('Drag the row to move it to another group');
    expect(moveAmongSiblings(outlined().tasks, [5], -1)?.map((t) => t.id)).toEqual([1, 5, 6, 2, 3, 4, 7]); // with its tasks
  });

  it('drag: the Levels a place allows, from the row below\'s to one under the row above', () => {
    expect(dropLevels({ level: 3, collapsed: false }, { level: 1 }, 0)).toEqual({ min: 1, max: 4 });
    expect(dropLevels({ level: 2, collapsed: true }, { level: 2 }, 0)).toEqual({ min: 2, max: 2 }); // beside a collapsed one
    expect(dropLevels(undefined, { level: 1 }, 0)).toEqual({ min: 1, max: 1 }); // the top
    expect(dropLevels({ level: 7, collapsed: false }, undefined, 2)).toEqual({ min: 1, max: 6 }); // 8 Levels at most
  });

  it('drag: the row (a major task with its tasks) goes where it is dropped, at the Level chosen; one undo step', () => {
    dropRow(6, 3, 3); // 6 into Arch Panel, before 3
    expect(ids()).toEqual([1, 2, 6, 3, 4, 5, 7]);
    expect(result(5).summary).toBeUndefined(); // Convection lost its only task: a task again
    undo();
    expect(ids()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    dropRow(2, null, 1); // Arch Panel with its tasks to the end, top level
    expect(levels()).toEqual([[1, 1], [5, 2], [6, 3], [7, 1], [2, 1], [3, 2], [4, 2]]);
    expect(moveBlock(outlined().tasks, 2, 3, 2)).toBeNull(); // inside itself
    expect(moveBlock(outlined().tasks, 7, 1, 3)).toBeNull(); // the first row must be at Level 1
  });

  it('drag is off while a search or filter is on', () => {
    setFilters({ text: 'Task' });
    dropRow(6, 3, 3);
    expect(ids()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(state().toast?.message).toBe('Clear the search and filters to move rows by dragging');
  });
});

describe('add, delete, link — §8', () => {
  it('Add task: an expanded major task gets it first; a collapsed one after its tasks; a task gets it below at its Level', () => {
    select(2);
    addTask();
    expect(ids().slice(0, 4)).toEqual([1, 2, 8, 3]);
    expect(task(8).level).toBe(3);
    toggleCollapsed(5);
    select(5);
    addTask();
    expect(ids().slice(-3)).toEqual([6, 9, 7]);
    expect(task(9).level).toBe(2);
    load(flat());
    select(2);
    addTask();
    expect(task(5).level).toBeUndefined(); // a flat plan stays without Levels
  });

  it('deleting a major task deletes its tasks and always asks first, naming it', () => {
    select(2);
    deleteSelected();
    expect(state().dialog).toEqual({ kind: 'delete', ids: [2, 3, 4], dependents: 0, group: { name: 'Arch Panel', tasks: 2 } });
    deleteTasks([2, 3, 4], true);
    expect(ids()).toEqual([1, 5, 6, 7]);
  });

  it('Link leaves major tasks out', () => {
    select(1, 7);
    linkSelected();
    expect(task(7).predecessorsText).toBe('');
    expect(state().toast?.message).toBe('Select two or more tasks to link: major tasks have no links of their own');
  });
});

describe('collapse and the rows shown — §7.7', () => {
  const shown = () => shownRows(rowsOf(state().plan!, state().result!), state().filters, state().pinned, state().collapsed).map((r) => r.task.id);

  it('a collapsed major task hides its rows; Alt+Shift+−/= act on the active row\'s major task', () => {
    toggleCollapsed(2);
    expect(shown()).toEqual([1, 2, 5, 6, 7]);
    setCollapsedOf(6, true); // 6's major task: Convection
    expect(shown()).toEqual([1, 2, 5, 7]);
    setCollapsedOf(5, false);
    expect(shown()).toEqual([1, 2, 5, 6, 7]);
    collapseAll();
    expect(shown()).toEqual([1, 7]);
    expandAll();
    expect(shown()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('a shown task brings its major tasks; a major task\'s name shows all its tasks', () => {
    setFilters({ ...NO_FILTERS, text: 'Task 6' });
    expect(shown()).toEqual([1, 5, 6]);
    setFilters({ ...NO_FILTERS, text: 'arch' });
    expect(shown()).toEqual([1, 2, 3, 4]);
  });
});
