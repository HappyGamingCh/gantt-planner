import { describe, expect, it } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import { readTasksHeader } from '../../src/excel/schema';
import { bareTasks, read, save, taskCell, tasksSheet, templateWith } from './helpers';

// Major tasks (SPEC §4.7, §4.8, §5.12): the Level column, roll-ups written into major-task rows, the outline in Excel.

const outlined = () =>
  templateWith([
    { ID: 10, Level: 1, Task: 'Refractory', 'Planned Start': 'TBD', 'Planned Duration': 99, 'Progress (%)': 'n/a' },
    { ID: 11, Level: 2, Task: 'Arch Panel' },
    { ID: 1, Level: 3, Task: 'Remove modules', 'Planned Start': new Date(Date.UTC(2026, 10, 2)), 'Planned Duration': 2 },
    { ID: 2, Level: 3, Task: 'Install modules', Predecessors: '1', 'Planned Duration': 3 },
    { ID: 3, Level: 1, Task: 'Close out', Predecessors: '2', 'Planned Duration': 1 },
  ]);

describe('reading Levels — SPEC §4.7', () => {
  it('reads Level; a major task\'s own date, duration and progress cells are not inputs and not reported', () => {
    const r = read(outlined());
    expect(r.plan.tasks.map((t) => t.level)).toEqual([1, 2, 3, 3, 1]);
    expect(r.issues).toEqual([]); // "TBD" and "n/a" sit in a major task's calculated cells
    expect(r.plan.tasks[0]?.unparsed).toBeUndefined();
    const result = computePlan(r.plan);
    expect(result.tasks.filter((t) => t.summary).map((t) => [t.id, t.summary?.tasks])).toEqual([
      [10, 2],
      [11, 2],
    ]);
  });

  it('Level text that is not a number warns, counts as blank and is written back unchanged', async () => {
    const wb = templateWith([
      { ID: 1, Level: 1, Task: 'Group' },
      { ID: 2, Level: 'two', Task: 'A', 'Planned Duration': 1 },
      { ID: 3, Level: 2, Task: 'B', 'Planned Duration': 1 },
    ]);
    const r = read(wb);
    expect(r.issues.map((i) => i.message)).toEqual(['Task 2: "two" in Level is not a valid number']);
    expect(computePlan(r.plan).tasks.map((t) => t.level)).toEqual([1, 2, 2]); // blank → the row below's Level
    expect(taskCell(await save(wb, r), 3, 'level').value).toBe('two');
  });

  it('a file without a Level column is all Level 1, with nothing to report', () => {
    const inputs = ['ID', 'Task', 'Assigned', 'Predecessors', 'Planned Start', 'Planned Duration', 'Progress (%)', 'Actual Start', 'Actual Finish', 'Remarks'];
    const r = read(bareTasks([...inputs, 'Area'], [[1, 'A', '', '', '', 1, 0, '', '', '', 'North'], [2, 'B', '', '', '', 1, 0, '', '', '', 'South']]));
    expect(r.issues).toEqual([]); // no "columns not found: Level" (W_COLUMNS_NOT_FOUND)
    expect(computePlan(r.plan).tasks.map((t) => [t.level, t.summary])).toEqual([
      [1, undefined],
      [1, undefined],
    ]);
  });
});

describe('writing major tasks — SPEC §4.8', () => {
  it('writes the roll-up into a major task\'s row, Level on every row', async () => {
    const saved = await save(outlined());
    const row = (n: number) => ({
      level: taskCell(saved, n, 'level').value,
      start: taskCell(saved, n, 'plannedStart').value,
      days: taskCell(saved, n, 'plannedDuration').value,
      progress: taskCell(saved, n, 'progress').value,
      successors: taskCell(saved, n, 'successors').value,
    });
    expect(row(2)).toEqual({ level: 1, start: new Date(Date.UTC(2026, 10, 2)), days: 5, progress: 0, successors: null });
    expect(row(3)).toMatchObject({ level: 2, days: 5 });
    expect(row(4)).toMatchObject({ level: 3, days: 2 });
    expect(read(saved).issues).toEqual([]);
  });

  it('shows the outline in Excel: bold major tasks, names indented by Level, rows grouped with summaries above', async () => {
    const saved = await save(outlined());
    const ws = tasksSheet(saved);
    expect([2, 3, 4, 5, 6].map((n) => [taskCell(saved, n, 'name').font?.bold ?? false, taskCell(saved, n, 'name').alignment?.indent ?? 0])).toEqual([
      [true, 0],
      [true, 1],
      [false, 2],
      [false, 2],
      [false, 0],
    ]);
    expect([2, 3, 4, 5, 6].map((n) => ws.getRow(n).outlineLevel ?? 0)).toEqual([0, 1, 2, 2, 0]);
    expect(ws.properties.outlineProperties).toMatchObject({ summaryBelow: false });
  });

  it('a sheet without Level gets the column once a row is below Level 1, and only then', async () => {
    const flat = bareTasks(['ID', 'Task'], [[1, 'A'], [2, 'B']]);
    const flatSaved = await save(flat);
    expect(readTasksHeader(tasksSheet(flatSaved)).known.has('level')).toBe(false);

    const wb = bareTasks(['ID', 'Task'], [[1, 'Group'], [2, 'A']]);
    const r = read(wb);
    r.plan.tasks = r.plan.tasks.map((t) => ({ ...t, level: t.id === 2 ? 2 : 1, plannedDuration: 1 }));
    const saved = await save(wb, r);
    const header = readTasksHeader(tasksSheet(saved));
    expect(header.known.get('level')).toBe(3); // appended right of the file's own columns (ID, Task)
    expect(read(saved).plan.tasks.map((t) => t.level)).toEqual([1, 2]);
  });

  it('a plan without major tasks keeps the file\'s own row grouping and Task formatting', async () => {
    const wb = templateWith([
      { ID: 1, Task: 'A', 'Planned Duration': 1 },
      { ID: 2, Task: 'B', 'Planned Duration': 1 },
    ]);
    const ws = tasksSheet(wb);
    ws.getRow(3).outlineLevel = 1;
    taskCell(wb, 3, 'name').font = { bold: true };
    const saved = await save(wb);
    expect(tasksSheet(saved).getRow(3).outlineLevel).toBe(1);
    expect(taskCell(saved, 3, 'name').font?.bold).toBe(true);
  });
});
