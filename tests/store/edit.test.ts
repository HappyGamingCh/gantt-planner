import { beforeEach, describe, expect, it } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import type { Plan } from '../../src/engine/types';
import { readPlan } from '../../src/excel/read';
import { sampleData } from '../../src/sample/sampleData';
import {
  addTask,
  applyFix,
  deleteTasks,
  editTask,
  linkSelected,
  moveSelected,
  renumber,
  rootsOnProjectStart,
  setStatusDate,
  unlinkSelected,
  updateProject,
} from '../../src/store/edit';
import { build } from '../../src/store/files';
import { CLOSED, select, useStore } from '../../src/store/store';
import { redo, undo } from '../../src/store/undo';
import { loadWorkbook } from '../../src/excel/exceljs';
import { toArrayBuffer } from '../../scripts/fixtures';
import { makeProject, makeTask } from '../engine/helpers';
import { sampleWorkbook } from '../excel/helpers';

const state = () => useStore.getState();
const task = (id: number) => state().plan!.tasks.find((t) => t.id === id)!;
const result = (id: number) => state().result!.tasks.find((t) => t.id === id)!;
const ids = () => state().plan!.tasks.map((t) => t.id);

function load(plan: Plan) {
  useStore.setState({ ...CLOSED, plan, result: computePlan(plan), cleanPlan: plan, maxIdEver: Math.max(0, ...plan.tasks.map((t) => t.id)), toast: null });
}

/** Plan mode, Project Start Mon 2 Nov, status date Fri 13 Nov: 1 (5d) → 2 (2d) → 3 (1d), and 4 (3d) on its own. */
const small = (mode: 'Plan' | 'Track' = 'Plan'): Plan => ({
  project: makeProject({ mode }),
  tasks: [
    makeTask(1, { plannedDuration: 5 }),
    makeTask(2, { plannedDuration: 2, predecessorsText: '1' }),
    makeTask(3, { plannedDuration: 1, predecessorsText: '2' }),
    makeTask(4, { plannedDuration: 3 }),
  ],
  resources: [],
  holidays: [],
});

describe('add task — SPEC §8', () => {
  beforeEach(() => load(small()));

  it('appends with the next ID and the defaults, and opens it in the drawer', () => {
    addTask();
    expect(ids()).toEqual([1, 2, 3, 4, 5]);
    expect(task(5)).toMatchObject({ name: 'New task', plannedDuration: 1, plannedStart: '2026-11-02', predecessorsText: '' });
    expect(state()).toMatchObject({ selection: [5], drawerId: 5, nameFocus: 5, dirty: true });
  });

  it("inserts below the selected task, starting on its start", () => {
    select(2);
    addTask();
    expect(ids()).toEqual([1, 2, 5, 3, 4]);
    expect(task(5).plannedStart).toBe(result(2).plannedStart);
  });

  it('never reuses an ID in the session', () => {
    addTask();
    deleteTasks([5]);
    addTask();
    expect(ids()).toEqual([1, 2, 3, 4, 6]);
  });

  it('Track mode tags it "New": its plan stays editable, other tasks keep theirs', () => {
    load(small('Track'));
    addTask();
    expect(task(5).isNewThisSession).toBe(true);
    editTask(5, 'plannedDuration', 4);
    expect(result(5).plannedDuration).toBe(4);
    editTask(4, 'plannedDuration', 9);
    expect(result(4).plannedDuration).toBe(3);
    expect(state().toast?.message).toBe('Switch to Plan mode to change the baseline.');
  });
});

describe('delete — SPEC §8', () => {
  beforeEach(() => load(small()));

  it('deletes at once when nothing depends on it, with Undo in the toast', () => {
    deleteTasks([4]);
    expect(ids()).toEqual([1, 2, 3]);
    expect(state().toast).toMatchObject({ message: 'Task deleted', action: { label: 'Undo' } });
    state().toast!.action!.run();
    expect(ids()).toEqual([1, 2, 3, 4]);
  });

  it('asks first when tasks depend on it, then removes their links', () => {
    deleteTasks([1]);
    expect(state().dialog).toEqual({ kind: 'delete', ids: [1], dependents: 1 });
    expect(ids()).toEqual([1, 2, 3, 4]);
    deleteTasks([1], true);
    expect(ids()).toEqual([2, 3, 4]);
    expect(task(2).predecessorsText).toBe('');
    expect(task(3).predecessorsText).toBe('2'); // untouched
  });
});

describe('move, link, unlink, renumber — SPEC §7.6, §8', () => {
  beforeEach(() => load(small()));

  it('moves rows, keeping IDs; nothing moves past the edge', () => {
    select(3);
    moveSelected(-1);
    expect(ids()).toEqual([1, 3, 2, 4]);
    select(1);
    moveSelected(-1);
    expect(ids()).toEqual([1, 3, 2, 4]);
    select(2, 'only');
    select(4, 'toggle');
    moveSelected(-1);
    expect(ids()).toEqual([1, 2, 4, 3]);
  });

  it('Link chains the selected tasks FS in row order; Unlink removes the links among them', () => {
    select(3);
    select(4, 'toggle');
    linkSelected();
    expect(task(4).predecessorsText).toBe('3');
    unlinkSelected();
    expect(task(4).predecessorsText).toBe('');
    expect(task(3).predecessorsText).toBe('2');
  });

  it('Link skips a link that would close a cycle, and says so', () => {
    // Rows in order 3, then 1: linking would make 1 depend on 3, which depends on 1.
    select(3);
    moveSelected(-1);
    moveSelected(-1);
    select(1, 'toggle');
    linkSelected();
    expect(task(1).predecessorsText).toBe('');
    expect(state().toast?.message).toBe('A link was skipped: it would create a circular dependency.');
  });

  it('Renumber gives 1…n in row order and rewrites references', () => {
    load({ ...small(), tasks: [makeTask(10, { plannedDuration: 1 }), makeTask(7, { plannedDuration: 1, predecessorsText: '10SS+1' }), makeTask(3, { predecessorsText: '7, 10' })] });
    renumber();
    expect(state().plan!.tasks.map((t) => [t.id, t.predecessorsText])).toEqual([
      [1, ''],
      [2, '1SS+1'],
      [3, '2, 1'],
    ]);
    addTask();
    expect(ids().at(-1)).toBe(4);
  });
});

describe('plan edits — SPEC §8', () => {
  beforeEach(() => load(small()));

  it('Planned Finish sets the duration; a finish before the start is refused', () => {
    editTask(4, 'plannedFinish', '2026-11-08');
    expect(result(4).plannedDuration).toBe(7);
    const undoSteps = state().undo.length;
    editTask(4, 'plannedFinish', '2026-10-30');
    expect(result(4).plannedDuration).toBe(7);
    expect(state().toast?.message).toBe("Finish can't be before the start (2 Nov) — set Duration to 0 for a milestone");
    expect(state().undo).toHaveLength(undoSteps);
    editTask(4, 'plannedFinish', '2026-11-02'); // finish = start: one day
    expect(result(4).plannedDuration).toBe(1);
  });

  it("a linked task's start can't be edited; a root task's can", () => {
    editTask(2, 'plannedStart', '2026-11-20');
    expect(state().toast?.message).toBe('Set by predecessors — add lag to delay.');
    editTask(4, 'plannedStart', '2026-11-20');
    expect(result(4).plannedStart).toBe('2026-11-20');
  });

  it('successors follow a duration change, and nothing stale is reported afterwards', () => {
    editTask(1, 'plannedDuration', 7);
    expect(result(2).plannedStart).toBe('2026-11-09');
    expect(state().result!.issues).toEqual([]);
  });

  it('a new Project Start can take the root tasks on the old one along, in one step', () => {
    editTask(4, 'name', 'Survey'); // settles every task's dates into the plan
    expect(rootsOnProjectStart(state().plan!, state().result!).map((t) => t.id)).toEqual([1, 4]);
    useStore.setState({ dialog: { kind: 'projectSettings' } });
    const steps = state().undo.length;
    updateProject({ projectStart: '2026-11-09' }, true);
    expect([result(1).plannedStart, result(4).plannedStart]).toEqual(['2026-11-09', '2026-11-09']);
    expect(state().dialog).toBeNull(); // no second dialog
    expect(state().undo).toHaveLength(steps + 1);
    undo();
    updateProject({ projectStart: '2026-11-09' });
    expect([result(1).plannedStart, result(4).plannedStart]).toEqual(['2026-11-02', '2026-11-02']);
    expect(state().plan!.project.projectStart).toBe('2026-11-09');
  });

  it('Plan mode keeps actuals read-only', () => {
    editTask(1, 'progress', 50);
    expect(task(1).progress).toBe(0);
    expect(state().toast?.message).toBe('Switch to Track mode to update progress.');
  });
});

describe('Track auto-fills — SPEC §8', () => {
  beforeEach(() => load(small('Track')));

  it('progress > 0 without Actual Start sets it to the status date', () => {
    editTask(1, 'progress', 40);
    expect(task(1)).toMatchObject({ progress: 40, actualStart: '2026-11-13' });
    expect(state().toast?.message).toBe('Actual start set to 13 Nov — change if needed');
  });

  it('100% without Actual Finish sets it (and a blank Actual Start) to the status date', () => {
    editTask(1, 'progress', 100);
    expect(task(1)).toMatchObject({ actualStart: '2026-11-13', actualFinish: '2026-11-13' });
    expect(state().toast?.message).toBe('Actual start and finish set to 13 Nov — change if needed');
  });

  it('Actual Finish entered → 100%; cleared → 99%', () => {
    editTask(1, 'actualStart', '2026-11-02');
    editTask(1, 'actualFinish', '2026-11-06');
    expect(task(1).progress).toBe(100);
    editTask(1, 'actualFinish', '');
    expect(task(1)).toMatchObject({ progress: 99, actualFinish: undefined });
    expect(state().toast?.message).toBe('Progress set to 99% — the task has no actual finish');
  });

  it('progress below 100 on a finished task clears its Actual Finish', () => {
    editTask(1, 'actualFinish', '2026-11-06');
    editTask(1, 'progress', 80);
    expect(task(1)).toMatchObject({ progress: 80, actualFinish: undefined });
  });

  it('the status date recomputes everything and writes nothing to tasks', () => {
    const tasks = state().plan!.tasks;
    setStatusDate('2026-11-20');
    expect(state().plan!.tasks).toBe(tasks);
    expect(state().result!.summary.elapsedDays).toBeGreaterThan(0);
    expect(state().plan!.project.statusDate).toBe('2026-11-20');
  });
});

describe('quick fixes — SPEC §5.11', () => {
  it('remove a link, set Actual Start, set Actual Finish', () => {
    load({ ...small('Track'), tasks: [makeTask(1, { plannedDuration: 2, progress: 100 }), makeTask(2, { predecessorsText: '1, 9' })] });
    const fixes = state().result!.issues.flatMap((i) => (i.fix ? [i.fix] : []));
    expect(fixes.map((f) => f.kind).sort()).toEqual(['removeLink', 'setActualFinish', 'setActualStart']);
    for (const fix of fixes) applyFix(fix);
    expect(task(2).predecessorsText).toBe('1');
    expect(task(1)).toMatchObject({ actualStart: '2026-11-02', actualFinish: '2026-11-13' });
  });
});

describe('undo and redo — SPEC §8', () => {
  beforeEach(() => load(small()));

  it('each action is one step; redo replays it; a new action clears redo', () => {
    const start = state().plan;
    editTask(1, 'name', 'Excavate');
    editTask(1, 'plannedDuration', 6);
    undo();
    expect(task(1)).toMatchObject({ name: 'Excavate', plannedDuration: 5 });
    undo();
    expect(state().plan).toBe(start);
    expect(state().dirty).toBe(false); // back to the saved state
    redo();
    expect(task(1).name).toBe('Excavate');
    editTask(4, 'name', 'Survey');
    expect(state().redo).toEqual([]);
  });

  it('keeps 100 steps', () => {
    for (let i = 0; i < 105; i++) editTask(1, 'plannedDuration', i + 1);
    expect(state().undo).toHaveLength(100);
  });
});

describe('save → reopen — SPEC §14 M3', () => {
  it('shows the same plan after a save and a reopen', async () => {
    const wb = await sampleWorkbook();
    const read = readPlan(wb, '2026-10-30');
    load(read.plan);
    useStore.setState({ file: { name: 'sample-project.xlsx', workbook: wb, layout: read.layout, unsupported: [] } });
    // Track mode edits: progress, actuals, a new task with a link, a rename, a deletion.
    editTask(8, 'progress', 50);
    editTask(11, 'actualFinish', '2026-09-30');
    select(25);
    addTask();
    editTask(26, 'name', 'Final walkdown');
    editTask(26, 'predecessorsText', '25');
    editTask(26, 'assigned', ['ACME', 'NewCo']);
    deleteTasks([14]);
    editTask(5, 'remarks', 'ถอดได้แล้ว');

    const reopened = readPlan(await loadWorkbook(toArrayBuffer(await build())), '2026-10-30');
    const after = computePlan(reopened.plan);
    expect(after.tasks).toEqual(state().result!.tasks);
    const shown = (p: Plan) => p.tasks.map((t) => [t.id, t.name, t.assigned, t.remarks, t.extra]);
    expect(shown(reopened.plan)).toEqual(shown(state().plan!));
    expect(reopened.plan.project).toEqual(state().plan!.project);
    expect(reopened.plan.resources.map((r) => r.name)).toContain('NewCo');
  });
});

describe('sample data is untouched by the tests', () => {
  it('still has 25 tasks', () => {
    expect(sampleData.tasks).toHaveLength(25);
  });
});
