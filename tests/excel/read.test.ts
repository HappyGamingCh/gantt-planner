import { describe, expect, it } from 'vitest';
import { RESOURCE_PALETTE } from '../../src/config';
import { computePlan } from '../../src/engine/compute';
import type { Task } from '../../src/engine/types';
import { newWorkbook } from '../../src/excel/exceljs';
import { findSheet } from '../../src/excel/schema';
import { createTemplate } from '../../src/excel/template';
import { sampleData } from '../../src/sample/sampleData';
import { bareTasks, read, sampleWorkbook, templateWith } from './helpers';

const codes = (r: ReturnType<typeof read>) => r.issues.map((i) => i.code);
const task = (r: ReturnType<typeof read>, id: number) => r.plan.tasks.find((t) => t.id === id)!;

describe('reading the sample workbook', () => {
  it('gives back the sample plan, with the calculated planned dates and nothing to report', async () => {
    const r = read(await sampleWorkbook());
    const strip = ({ plannedStart, plannedFinish, source, ...t }: Task) => t;
    expect(r.plan.project).toEqual(sampleData.project);
    expect(r.plan.tasks.map(strip)).toEqual(sampleData.tasks.map((t) => ({ ...strip(t), level: 1 }))); // the template's Level column
    expect(r.plan.tasks.map((t) => [t.plannedStart, t.plannedFinish])).toEqual(
      computePlan(sampleData).tasks.map((t) => [t.plannedStart, t.plannedFinish]),
    );
    expect(r.plan.resources).toEqual(sampleData.resources.map((res, i) => ({ ...res, color: RESOURCE_PALETTE[i] })));
    expect(r.plan.holidays).toEqual(sampleData.holidays);
    expect(r.issues).toEqual([]);
    expect(r.changes).toEqual([]);
  });

  it('keeps the Excel row of each task on the task, for the writer', async () => {
    const r = read(await sampleWorkbook());
    expect(r.plan.tasks.every((t) => t.source !== undefined)).toBe(true);
    expect(r.layout.firstRow).toBe(r.plan.tasks[0]?.source);
    expect(r.layout.columns.get('status')).toBe(14);
  });
});

describe('columns are found by header — SPEC §4.3', () => {
  it('in any order, with aliases, ignoring case and spaces', () => {
    const wb = bareTasks(['Remark', '  task   NAME ', 'Step No', 'PIC', 'Pred', 'start', 'DURATION', '% Complete'], [
      ['note', 'Survey', 7, 'A; B', '', '2026-11-02', 3, 40],
    ]);
    expect(read(wb).plan.tasks).toEqual([
      expect.objectContaining({ id: 7, name: 'Survey', assigned: ['A', 'B'], plannedStart: '2026-11-02', plannedDuration: 3, progress: 40, remarks: 'note' }),
    ]);
  });

  it('keeps unknown columns in `extra`; a repeated or blank header gets the column letter', () => {
    const wb = bareTasks(['ID', 'Task', 'Area', 'Remarks', 'Remarks', ''], [[1, 'Survey', 'North', 'a', 'b', 'c']]);
    expect(read(wb).plan.tasks[0]).toMatchObject({ remarks: 'a', extra: { Area: 'North', 'Remarks (E)': 'b', 'Column F': 'c' } });
  });
});

describe('rows — SPEC §4.3', () => {
  it('skips blank rows and rows with only an ID; a row with only user data is an untitled task', () => {
    const wb = bareTasks(['ID', 'Task', 'Area'], [[1, 'A', null], [null, null, null], [9, null, null], [null, null, 'North'], [2, 'B', null]]);
    const r = read(wb);
    expect(r.plan.tasks.map((t) => [t.id, t.name])).toEqual([[1, 'A'], [3, '(Untitled)'], [2, 'B']]);
    expect(r.issues.filter((i) => i.code !== 'W_COLUMNS_NOT_FOUND')).toEqual([
      expect.objectContaining({ code: 'W_UNTITLED', taskId: 3, message: 'Row 5 has data but no task name' }),
    ]);
  });

  it('IDs: blank → next free, repeated → new ID (error), not a whole number → new ID', () => {
    const wb = bareTasks(['ID', 'Task'], [[5, 'A'], [null, 'B'], [5, 'C'], ['x', 'D'], [2.5, 'E'], [0, 'F'], ['3', 'G']]);
    const r = read(wb);
    expect(r.plan.tasks.map((t) => t.id)).toEqual([5, 6, 7, 8, 9, 10, 3]);
    expect(r.issues).toEqual([expect.objectContaining({ code: 'E_DUP_ID', taskId: 7, message: 'ID 5 is used more than once; row 4 got ID 7' })]);
    expect(r.changes.filter((c) => c.field === 'ID').map((c) => [c.taskId, c.from, c.kind])).toEqual([
      [6, undefined, 'filled'],
      [7, 5, 'corrected'],
      [8, 'x', 'corrected'],
      [9, '2.5', 'corrected'],
      [10, '0', 'corrected'],
    ]);
  });

  it('tidies text and records it', () => {
    const wb = bareTasks(['ID', 'Task', 'Assigned', 'Remarks'], [[1, '  Pump   overhaul ', 'ACME;NDT ,  Team  A', ' check '], [2, 'B', 'ACME, NDT', '']]);
    const r = read(wb);
    expect(task(r, 1)).toMatchObject({ name: 'Pump overhaul', assigned: ['ACME', 'NDT', 'Team A'], remarks: 'check' });
    expect(r.changes.filter((c) => c.taskId !== undefined).map((c) => `${c.taskId} ${c.field}`)).toEqual(['1 Task', '1 Assigned', '1 Remarks']);
  });
});

describe('values — SPEC §4.7', () => {
  it('bad dates and numbers: warning, treated as blank', () => {
    const wb = templateWith([{ ID: 1, Task: 'A', 'Planned Start': 'soon', 'Planned Duration': 'two', 'Progress (%)': 'half', 'Actual Finish': '31/02/2026' }]);
    const r = read(wb);
    expect(r.issues.map((i) => i.message)).toEqual([
      'Task 1: "soon" in Planned Start is not a date',
      'Task 1: "two" in Planned Duration is not a valid number',
      'Task 1: "half" in Progress (%) is not a valid number',
      'Task 1: "31/02/2026" in Actual Finish is not a date',
    ]);
    expect(task(r, 1)).toMatchObject({ plannedStart: undefined, plannedDuration: undefined, progress: 0, actualFinish: undefined });
  });

  it('Planned Duration: rounded (corrected), negative is bad', () => {
    const r = read(templateWith([{ ID: 1, Task: 'A', 'Planned Duration': 2.5 }, { ID: 2, Task: 'B', 'Planned Duration': -1 }]));
    expect(task(r, 1).plannedDuration).toBe(3);
    expect(r.changes).toContainEqual(expect.objectContaining({ taskId: 1, field: 'Planned Duration', from: 2.5, to: 3, kind: 'corrected' }));
    expect(codes(r)).toEqual(['W_BAD_NUMBER']);
  });

  it('Progress: a %-formatted fraction is a percentage; "50%" text is 50; out of range is left to the engine', () => {
    const wb = templateWith([
      { ID: 1, Task: 'A', 'Progress (%)': 0.55 },
      { ID: 2, Task: 'B', 'Progress (%)': '50%' },
      { ID: 3, Task: 'C', 'Progress (%)': 1 },
      { ID: 4, Task: 'D', 'Progress (%)': 150 },
    ]);
    const ws = findSheet(wb, 'Tasks')!;
    for (const row of [2, 4]) ws.getCell(row, 9).style = { numFmt: '0%' }; // Progress (%): column I
    expect(read(wb).plan.tasks.map((t) => t.progress)).toEqual([55, 50, 100, 150]);
  });

  it('formulas: the cached result is used, with one warning', () => {
    const wb = templateWith([
      { ID: 1, Task: { formula: '"Pump"&" A"', result: 'Pump A' }, 'Planned Duration': { formula: '1+1', result: 2 } },
      { ID: 2, Task: 'B', 'Planned Start': { sharedFormula: 'E2', result: new Date(Date.UTC(2026, 10, 2)) } },
    ]);
    const r = read(wb);
    expect(r.plan.tasks.map((t) => [t.name, t.plannedDuration, t.plannedStart])).toEqual([['Pump A', 2, undefined], ['B', undefined, '2026-11-02']]);
    expect(codes(r)).toEqual(['W_FORMULA']);
  });

  it('counts a formula in a skipped row too', () => {
    const r = read(templateWith([{ ID: 1, Task: 'A' }, { Task: { formula: 'IF(1,"","")', result: '' } }]));
    expect(r.plan.tasks).toHaveLength(1);
    expect(codes(r)).toEqual(['W_FORMULA']);
  });

  it('user columns keep rich values; formulas become their result', () => {
    const wb = bareTasks(['ID', 'Task', 'Link', 'Calc'], [[1, 'A', { text: 'Permit', hyperlink: 'https://example.com' }, { formula: '2*3', result: 6 }]]);
    expect(read(wb).plan.tasks[0]?.extra).toEqual({ Link: { text: 'Permit', hyperlink: 'https://example.com' }, Calc: 6 });
  });
});

describe('Project sheet — SPEC §4.2', () => {
  it('fills blanks: name, Project Start = earliest start of tasks without predecessors, Status Date = today, Mode = Plan', () => {
    const r = read(templateWith([
      { ID: 1, Task: 'A', 'Planned Start': '2026-11-09' },
      { ID: 2, Task: 'B', 'Planned Start': '2026-11-02', Predecessors: '1' },
      { ID: 3, Task: 'C', 'Planned Start': '2026-11-05', Predecessors: '9' },
    ]));
    expect(r.plan.project).toEqual({ name: 'Untitled project', owner: '', projectStart: '2026-11-05', statusDate: '2026-10-30', mode: 'Plan' });
    expect(r.changes.filter((c) => c.taskId === undefined).map((c) => [c.field, c.to, c.kind])).toEqual([
      ['Project Name', 'Untitled project', 'filled'],
      ['Project Start', '2026-11-05', 'filled'],
      ['Status Date', '2026-10-30', 'filled'],
    ]);
  });

  it('falls back to today, and corrects values it cannot use', () => {
    const wb = createTemplate();
    const project = findSheet(wb, 'Project')!;
    project.getCell('B2').value = '  Control   room ';
    project.getCell('B4').value = 'TBC';
    project.getCell('B5').value = new Date(Date.UTC(2026, 10, 13));
    project.getCell('B6').value = 'tracking';
    const r = read(wb);
    expect(r.plan.project).toEqual({ name: 'Control room', owner: '', projectStart: '2026-10-30', statusDate: '2026-11-13', mode: 'Plan' });
    expect(r.changes.map((c) => [c.field, c.from, c.kind])).toEqual([
      ['Project Name', '  Control   room ', 'corrected'],
      ['Project Start', 'TBC', 'corrected'],
      ['Mode', 'tracking', 'corrected'],
    ]);
  });

  it('a workbook without plan sheets is an empty plan', () => {
    const wb = newWorkbook();
    wb.addWorksheet('Budget').getCell('A1').value = 'x';
    const r = read(wb);
    expect(r.plan).toMatchObject({ tasks: [], resources: [], holidays: [], project: { name: 'Untitled project', mode: 'Plan' } });
  });
});

describe('Resources and Holidays — SPEC §4.4, §4.5', () => {
  it('resources: type and colour when valid, names tidied, duplicates and blanks skipped', () => {
    const wb = createTemplate();
    const ws = findSheet(wb, 'Resources')!;
    for (const row of [['Somchai  K.', 'person', '#2563eb'], ['ACME', 'Vendor', 'blue'], ['somchai k.', 'Team', ''], [null, 'Team', '#000000']]) ws.addRow(row);
    expect(read(wb).plan.resources).toEqual([{ name: 'Somchai K.', type: 'Person', color: '#2563EB' }, { name: 'ACME' }]);
  });

  it('holidays: dates in any accepted form; a bad one is reported and ignored', () => {
    const wb = createTemplate([{ date: '2026-12-31', description: 'New Year' }]);
    const ws = findSheet(wb, 'Holidays')!;
    ws.addRow(['5-Dec-26', 'Father’s Day']);
    ws.addRow(['TBC', 'Company day']);
    const r = read(wb);
    expect(r.plan.holidays).toEqual([{ date: '2026-12-31', description: 'New Year' }, { date: '2026-12-05', description: 'Father’s Day' }]);
    expect(r.issues).toEqual([expect.objectContaining({ code: 'W_BAD_HOLIDAY', message: 'Holidays row 4: "TBC" is not a date' })]);
  });
});
