import { describe, expect, it } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import { findSheet } from '../../src/excel/schema';
import { createTemplate } from '../../src/excel/template';
import { read, reload, sampleWorkbook, save, taskCell, tasksSheet, templateWith } from './helpers';

const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } } as const;
const isYellow = (fill: unknown) => JSON.stringify(fill) === JSON.stringify(YELLOW);

describe('unparsed planned text — SPEC §4.8', () => {
  const wb = () =>
    templateWith([
      { ID: 1, Task: 'Erect scaffold', 'Planned Duration': 'สองวัน' },
      { ID: 2, Task: 'Open manhole', 'Planned Start': 'TBC', 'Planned Duration': 1 },
    ]);

  it('the reader records which planned fields it couldn’t read', () => {
    expect(read(wb()).plan.tasks.map((t) => t.unparsed)).toEqual([['plannedDuration'], ['plannedStart']]);
  });

  it('survives the planned values the app derives after an edit; a value the user sets replaces it', async () => {
    const file = await reload(wb());
    const r = read(file);
    // What settle() does after any edit in Plan mode: every task stores its derived planned values.
    const derived = computePlan(r.plan);
    r.plan.tasks = r.plan.tasks.map((t, i) => ({ ...t, plannedStart: derived.tasks[i]!.plannedStart, plannedDuration: derived.tasks[i]!.plannedDuration }));
    let saved = await save(file, r);
    expect([taskCell(saved, 2, 'plannedDuration').value, taskCell(saved, 3, 'plannedStart').value]).toEqual(['สองวัน', 'TBC']);

    const again = read(saved);
    again.plan.tasks[0] = { ...again.plan.tasks[0]!, plannedDuration: 2, unparsed: undefined }; // the user typed 2
    saved = await save(saved, again);
    expect([taskCell(saved, 2, 'plannedDuration').value, taskCell(saved, 3, 'plannedStart').value]).toEqual([2, 'TBC']);
  });
});

describe('cell formats — SPEC §4.8', () => {
  it("an existing task's blank cell doesn't take the first row's formatting; a new task still copies it", async () => {
    const wb = await sampleWorkbook();
    const ws = tasksSheet(wb);
    for (let c = 1; c <= 19; c++) {
      const cell = ws.getCell(2, c);
      cell.style = { ...cell.style, fill: YELLOW }; // a new style object: ExcelJS shares them between cells
    }
    const file = await reload(wb);
    const r = read(file);
    r.plan.tasks.push({ id: 26, name: 'New task', assigned: [], predecessorsText: '', plannedDuration: 1, progress: 0, remarks: 'New', extra: {} });
    const saved = await save(file, r);
    const yellowRows = new Set<number>();
    tasksSheet(saved).eachRow((row, n) => row.eachCell((cell) => isYellow(cell.fill) && yellowRows.add(n)));
    expect([...yellowRows]).toEqual([2, 27]);
    expect(isYellow(taskCell(saved, 27, 'remarks').fill)).toBe(true);
  });

  it('a format with a literal % (0"%") is not a percent format: 50 stays 50, and 1 means 1%', async () => {
    const wb = templateWith([
      { ID: 1, Task: 'A', 'Planned Duration': 1, 'Progress (%)': 50 },
      { ID: 2, Task: 'B', 'Planned Duration': 1, 'Progress (%)': 1 },
      { ID: 3, Task: 'C', 'Planned Duration': 1, 'Progress (%)': 0.4 },
    ]);
    taskCell(wb, 2, 'progress').numFmt = '0"%"';
    taskCell(wb, 3, 'progress').numFmt = '[Red]0"%"';
    taskCell(wb, 4, 'progress').numFmt = '0%';
    const file = await reload(wb);
    expect(read(file).plan.tasks.map((t) => t.progress)).toEqual([50, 1, 40]);
    const saved = await save(file);
    expect([2, 3, 4].map((n) => taskCell(saved, n, 'progress').value)).toEqual([50, 1, 0.4]);
  });

  it('Predecessors cells are Text, so Excel keeps "5,120" and "3-1" as typed', async () => {
    expect(findSheet(await reload(createTemplate()), 'Tasks')!.getColumn(5).numFmt).toBe('@'); // Predecessors: column E
    const saved = await save(templateWith([{ ID: 1, Task: 'A', 'Planned Duration': 1 }, { ID: 2, Task: 'B', 'Planned Duration': 1, Predecessors: 1 }]));
    expect([taskCell(saved, 2, 'predecessors').numFmt, taskCell(saved, 3, 'predecessors')]).toMatchObject(['@', { numFmt: '@', value: 1 }]);
    expect(taskCell(saved, 1, 'predecessors').numFmt).toBeUndefined(); // the header keeps its own style
  });

  it('warns when Excel already turned Predecessors into a number or a date', async () => {
    const wb = templateWith([
      { ID: 1, Task: 'A', 'Planned Duration': 1, Predecessors: 1234 },
      { ID: 2, Task: 'B', 'Planned Duration': 1, Predecessors: new Date(Date.UTC(2026, 2, 1)) },
      { ID: 3, Task: 'C', 'Planned Duration': 1, Predecessors: 1 },
    ]);
    taskCell(wb, 2, 'predecessors').numFmt = '#,##0';
    taskCell(wb, 3, 'predecessors').numFmt = 'dd-mmm';
    const r = read(await reload(wb));
    expect(r.issues.map((i) => i.message)).toEqual([
      'Task 1: Excel changed the Predecessors you typed into the number 1,234. Retype them with a space after each comma (5, 120), or write a lead as 3FS-1',
      'Task 2: Excel changed the Predecessors you typed into the date 2026-03-01. Retype them with a space after each comma (5, 120), or write a lead as 3FS-1',
    ]);
  });
});

describe('Resources — SPEC §4.4, §4.7', () => {
  it('a name typed with a double or non-breaking space is not listed again', async () => {
    const wb = templateWith([{ ID: 1, Task: 'A', 'Planned Duration': 1, Assigned: 'Somchai  K., ทีม ช่าง' }]);
    const resources = findSheet(wb, 'Resources')!;
    resources.addRow(['Somchai  K.', 'Person', '#112233']);
    resources.addRow(['ทีม ช่าง', 'Team', '#445566']);
    const saved = await save(await reload(wb));
    expect(findSheet(saved, 'Resources')!.getColumn(1).values.slice(2)).toEqual(['Somchai  K.', 'ทีม ช่าง']);
  });
});
