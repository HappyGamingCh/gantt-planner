import { beforeEach, describe, expect, it } from 'vitest';
import { addTask, deleteSelected, editTask, linkSelected, moveSelected, unlinkSelected } from '../../src/store/edit';
import { matches, rowsOf, shownRows, shownSelection } from '../../src/store/selectors';
import { NO_FILTERS, revealTask, select, setFilters, useStore } from '../../src/store/store';
import { makeProject, makeTask } from '../engine/helpers';
import { ids, load, state, task } from './editHelpers';

/** Plan mode: pumps 1, 2, 5 and valves 3, 4, in that row order. */
const plan = () => ({
  project: makeProject(),
  tasks: [
    makeTask(1, { name: 'Pump A', plannedDuration: 1 }),
    makeTask(2, { name: 'Pump B', plannedDuration: 1 }),
    makeTask(3, { name: 'Valve C', plannedDuration: 1 }),
    makeTask(4, { name: 'Valve D', plannedDuration: 1 }),
    makeTask(5, { name: 'Pump E', plannedDuration: 1 }),
  ],
  resources: [],
  holidays: [],
});
const shown = () => shownRows(rowsOf(state().plan!, state().result!), state().filters, state().pinned).map((row) => row.task.id);

describe('actions on the selection skip rows the search or filters hide — SPEC §7.6', () => {
  beforeEach(() => load(plan()));

  it('a new search drops hidden rows from the selection', () => {
    select(3);
    select(1, 'toggle');
    setFilters({ text: 'pump' });
    expect(state()).toMatchObject({ selection: [1], anchor: 1 });
  });

  it('Delete removes only the selected rows that are shown', () => {
    setFilters({ text: 'pump' });
    select(1);
    select(2, 'toggle');
    useStore.setState({ selection: [3, 1, 2] }); // e.g. a row hidden by an edit while selected
    expect(shownSelection(state())).toEqual([1, 2]);
    deleteSelected();
    expect(ids()).toEqual([3, 4, 5]);
    expect(state().toast?.message).toBe('2 tasks deleted');
  });

  it('Link and Unlink chain only the shown rows', () => {
    setFilters({ text: 'pump' });
    useStore.setState({ selection: [1, 3, 5] });
    linkSelected();
    expect([task(3).predecessorsText, task(5).predecessorsText]).toEqual(['', '1']);
    useStore.setState({ selection: [1, 3, 5] });
    unlinkSelected();
    expect(task(5).predecessorsText).toBe('');
  });

  it('Move jumps over hidden rows; at the edge of the shown rows nothing happens', () => {
    setFilters({ text: 'pump' }); // shows 1, 2, 5
    select(5);
    moveSelected(-1);
    expect(ids()).toEqual([1, 5, 2, 3, 4]);
    expect(shown()).toEqual([1, 5, 2]);
    select(1);
    moveSelected(-1);
    expect(state().undo).toHaveLength(1);
    select(2);
    moveSelected(1);
    expect(state().undo).toHaveLength(1);
    select(1);
    moveSelected(1);
    expect(ids()).toEqual([5, 1, 2, 3, 4]);
  });

  it('without a filter, Move swaps with the next row as before', () => {
    select(2);
    select(4, 'toggle');
    moveSelected(1);
    expect(ids()).toEqual([1, 3, 2, 5, 4]);
  });
});

describe('a new or jumped-to task shows despite the search and filters — SPEC §7.6', () => {
  beforeEach(() => load(plan()));

  it('Add task below the last shown selected row: the new row is shown and scrolled to until the filters change', () => {
    setFilters({ text: 'valve' });
    useStore.setState({ selection: [3, 5] }); // 5 is hidden
    const reveal = state().reveal;
    addTask();
    expect(ids()).toEqual([1, 2, 3, 6, 4, 5]);
    expect(state().reveal).toBe(reveal + 1);
    expect(shown()).toEqual([3, 6, 4]);
    setFilters({ text: 'valv' });
    expect(state().pinned).toEqual([]);
    expect(shown()).toEqual([3, 4]);
  });

  it('a task added with nothing selected is appended and scrolled to', () => {
    const reveal = state().reveal;
    addTask();
    expect(ids().at(-1)).toBe(6);
    expect(state()).toMatchObject({ reveal: reveal + 1, selection: [6] });
  });

  it('jumping to a hidden task (Issues panel, successors) shows it', () => {
    setFilters({ text: 'valve' });
    revealTask(1);
    expect(state().selection).toEqual([1]);
    expect(shown()).toEqual([1, 3, 4]);
  });

  it('a pinned row stays even when an edit stops it matching, and counts for actions', () => {
    setFilters({ text: 'valve' });
    addTask();
    editTask(6, 'name', 'Scaffold');
    expect(shown()).toContain(6);
    expect(shownSelection(state())).toEqual([6]);
    setFilters(NO_FILTERS);
    expect(shown()).toHaveLength(6);
  });
});

describe('search — SPEC §7.6', () => {
  const row = (id: number, name = 'Task') => ({ task: makeTask(id, { name }), r: { status: 'Not Started' } }) as Parameters<typeof matches>[0];
  const search = (text: string) => ({ ...NO_FILTERS, text });

  it('finds an ID typed as shown in the app (#12), exactly', () => {
    expect(matches(row(24), search('#24'))).toBe(true);
    expect(matches(row(24), search(' # 24 '))).toBe(true);
    expect(matches(row(24), search('24'))).toBe(true);
    expect(matches(row(24), search('#2'))).toBe(false);
    expect(matches(row(3, '#3 pump'), search('#3 p'))).toBe(true); // names still match as typed
  });
});
