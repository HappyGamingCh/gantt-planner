import { describe, expect, it } from 'vitest';
import { RESOURCE_PALETTE } from '../../src/config';
import { computePlan } from '../../src/engine/compute';
import { validationsOf, type Workbook } from '../../src/excel/exceljs';
import { CALC_NOTE, TASK_COLUMNS, findSheet } from '../../src/excel/schema';
import { calculatedChanges } from '../../src/excel/write';
import { bareTasks, barePlan, read, reload, sampleWorkbook, save, taskCell, tasksSheet, templateWith } from './helpers';

const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } } as const;

/** Everything about the Tasks header and sheet setup that a save must not change. */
function sheetSetup(wb: Workbook) {
  const ws = tasksSheet(wb);
  return {
    header: Array.from({ length: ws.getRow(1).cellCount }, (_, i) => {
      const cell = ws.getCell(1, i + 1);
      return { value: cell.value, style: cell.style, note: cell.note };
    }),
    widths: Array.from({ length: 19 }, (_, i) => ws.getColumn(i + 1).width),
    views: ws.views,
    autoFilter: ws.autoFilter,
    validations: validationsOf(ws).model,
  };
}

const rowValues = (wb: Workbook, sheet: string) => findSheet(wb, sheet)!.getSheetValues();

describe('round trip — SPEC §12', () => {
  it('sample: read → write → read gives the same plan and nothing to fill, correct or report', async () => {
    const wb = await sampleWorkbook();
    const first = read(wb);
    const second = read(await save(wb, first));
    expect(barePlan(second.plan)).toEqual(barePlan(first.plan));
    const result = computePlan(second.plan);
    expect([...second.changes, ...result.changes, ...calculatedChanges(second.plan.tasks, second.layout, result)]).toEqual([]);
    expect([...second.issues, ...result.issues]).toEqual([]);
  });

  it('saving again writes the same cells', async () => {
    const once = await save(await sampleWorkbook());
    const twice = await save(once);
    for (const sheet of ['Tasks', 'Project', 'Resources', 'Holidays', 'Read Me']) expect(rowValues(twice, sheet)).toEqual(rowValues(once, sheet));
  });

  it('keeps header fills, notes, column widths, freeze panes, autofilter and data validation', async () => {
    const wb = await sampleWorkbook();
    const before = sheetSetup(wb);
    expect(sheetSetup(await save(wb))).toEqual(before);
  });

  it('leaves another sheet untouched and moves a user column with its task', async () => {
    const wb = await sampleWorkbook();
    const notes = wb.addWorksheet('Site notes');
    notes.getCell('A1').value = 'Permit';
    notes.getCell('A1').font = { bold: true };
    notes.getCell('B2').value = new Date(Date.UTC(2026, 9, 1));
    notes.getColumn(1).width = 30;
    const file = await reload(wb);
    const before = { values: rowValues(file, 'Site notes'), font: findSheet(file, 'Site notes')!.getCell('A1').font };

    const r = read(file);
    r.plan.tasks.reverse();
    const saved = await save(file, r);
    const after = findSheet(saved, 'Site notes')!;
    expect({ values: after.getSheetValues(), font: after.getCell('A1').font }).toEqual(before);
    expect(after.getColumn(1).width).toBe(30);
    expect(tasksSheet(saved).getCell(26, 20).value).toBe('Initial work'); // task 1's Area, now in the last row
    expect(read(saved).plan.tasks.at(-1)).toMatchObject({ id: 1, extra: { Area: 'Initial work' } });
  });
});

describe('formatting — SPEC §4.8', () => {
  it('a row keeps its own formatting wherever its task goes; a new task copies the first data row', async () => {
    const wb = await sampleWorkbook();
    const cell = taskCell(wb, 4, 'name'); // task 3
    cell.style = { ...cell.style, fill: YELLOW };
    const r = read(await reload(wb));
    r.plan.tasks.reverse();
    r.plan.tasks.push({ id: 26, name: 'New task', assigned: [], predecessorsText: '', plannedDuration: 1, progress: 0, remarks: '', extra: {} });
    const saved = await save(wb, r);
    const yellow = Array.from({ length: 26 }, (_, i) => taskCell(saved, i + 2, 'name')).filter((c) => c.fill?.type === 'pattern' && c.fill.pattern === 'solid');
    expect(yellow.map((c) => c.value)).toEqual(['Open manhole']);
    expect(taskCell(saved, 27, 'name').style).toEqual(taskCell(saved, 26, 'name').style); // new task = first data row (task 1, now row 26)
  });

  it('writes dates, calculated colours and status fills', async () => {
    const saved = await save(await sampleWorkbook());
    expect(taskCell(saved, 2, 'plannedStart')).toMatchObject({ value: new Date(Date.UTC(2026, 8, 28)), numFmt: 'dd-mmm-yy' });
    expect(taskCell(saved, 2, 'actualDuration').font).toMatchObject({ color: { argb: 'FF64748B' } });
    const fill = (id: number) => taskCell(saved, id + 1, 'status').fill;
    expect(fill(1)).toMatchObject({ fgColor: { argb: 'FFDCFCE7' } }); // Completed
    expect(fill(11)).toMatchObject({ fgColor: { argb: 'FFDBEAFE' } }); // In Progress
    expect(fill(7)).toMatchObject({ fgColor: { argb: 'FFFEE2E2' } }); // Late
    expect(fill(8)).toMatchObject({ pattern: 'none' }); // Not Started
  });

  it("keeps the user's date format; writes progress as a fraction in a % cell", async () => {
    const wb = await sampleWorkbook();
    const start = taskCell(wb, 2, 'plannedStart');
    start.style = { ...start.style, numFmt: 'd/m/yyyy' };
    const progress = taskCell(wb, 17, 'progress'); // task 16, 50%
    progress.style = { ...progress.style, numFmt: '0%' };
    progress.value = 0.5;
    const saved = await save(await reload(wb));
    expect(taskCell(saved, 2, 'plannedStart').numFmt).toBe('d/m/yyyy');
    expect(taskCell(saved, 17, 'progress').value).toBe(0.5);
    expect(read(saved).plan.tasks[15]?.progress).toBe(50);
  });
});

describe('values — SPEC §4.8', () => {
  it('keeps unparseable text in input columns until the field gets a value; calculated columns are overwritten', async () => {
    const wb = templateWith([
      { ID: 1, Task: 'A', 'Planned Start': 'soon', 'Planned Duration': 'two', 'Planned Finish': 'whenever', 'Progress (%)': 'half', 'Actual Start': 'later' },
    ]);
    let saved = await save(wb);
    expect(['plannedStart', 'plannedDuration', 'progress', 'actualStart'].map((f) => taskCell(saved, 2, f as 'progress').value)).toEqual(['soon', 'two', 'half', 'later']);
    expect(taskCell(saved, 2, 'plannedFinish').value).toBeInstanceOf(Date);

    const r = read(saved);
    Object.assign(r.plan.tasks[0]!, { actualStart: '2026-10-28', progress: 40 });
    saved = await save(saved, r);
    expect(taskCell(saved, 2, 'actualStart').value).toEqual(new Date(Date.UTC(2026, 9, 28)));
    expect(taskCell(saved, 2, 'progress').value).toBe(40);
    expect(taskCell(saved, 2, 'plannedStart').value).toBe('soon');
  });

  it('writes unchanged text cells back as they were (hyperlinks, rich text, numbers); changed ones as plain text', async () => {
    const link = { text: 'Permit', hyperlink: 'https://example.com/permit' };
    const rich = { richText: [{ text: 'Pump ', font: { bold: true } }, { text: 'overhaul' }] };
    const wb = templateWith([
      { ID: 1, Task: rich, Remarks: link },
      { ID: 2, Task: 'B', Remarks: 1234, Predecessors: 1 },
    ]);
    const r = read(await reload(wb));
    r.plan.tasks[1]!.name = 'B2';
    const saved = await save(wb, r);
    expect(taskCell(saved, 2, 'remarks').value).toEqual(link);
    expect(taskCell(saved, 2, 'name').value).toEqual(rich);
    expect(taskCell(saved, 3, 'remarks').value).toBe(1234);
    expect(taskCell(saved, 3, 'predecessors').value).toBe(1);
    expect(taskCell(saved, 3, 'name').value).toBe('B2');
  });

  it('replaces formulas with values, in known and user columns', async () => {
    const wb = bareTasks(['ID', 'Task', 'Planned Duration', 'Area'], [[1, 'A', { formula: '1+1', result: 2 }, { formula: 'UPPER("n")', result: 'N' }]]);
    const saved = await save(wb);
    expect([taskCell(saved, 2, 'plannedDuration').value, tasksSheet(saved).getCell('D2').value]).toEqual([2, 'N']);
    expect(read(saved).issues).toEqual([]);
  });

  it('removes rows left over from deleted tasks', async () => {
    const wb = await sampleWorkbook();
    const r = read(wb);
    r.plan.tasks = r.plan.tasks.slice(0, 20).map((t) => ({ ...t, predecessorsText: t.id > 19 ? '' : t.predecessorsText }));
    const saved = await save(wb, r);
    expect(tasksSheet(saved).actualRowCount).toBe(21);
    expect(tasksSheet(saved).getRow(22).getCell(13).fill).toBeUndefined(); // old task 21's status fill is gone too
    expect(read(saved).plan.tasks).toHaveLength(20);
  });
});

describe('missing parts — SPEC §4.1, §4.8', () => {
  it('appends missing known columns (styled, with width and validation), then user columns from `extra`', async () => {
    const wb = bareTasks(['ID', 'Task'], [[1, 'A']]);
    const r = read(wb);
    r.plan.tasks[0]!.extra = { 'Cost code': 'CC-1' };
    const saved = await save(wb, r);
    const ws = tasksSheet(saved);
    // Level is added only once a row is below Level 1 (§4.8).
    const rest = TASK_COLUMNS.filter((c) => c.field !== 'id' && c.field !== 'name' && c.field !== 'level');
    expect(ws.getRow(1).values).toEqual([undefined, 'ID', 'Task', ...rest.map((c) => c.header), 'Cost code']);
    const variance = ws.getCell(1, 2 + rest.findIndex((c) => c.field === 'variance') + 1);
    expect(variance).toMatchObject({ note: CALC_NOTE, font: { italic: true } });
    expect(ws.getColumn(2 + rest.findIndex((c) => c.field === 'remarks') + 1).width).toBe(40);
    expect(validationsOf(ws).model.H2).toMatchObject({ type: 'decimal', formulae: [0, 100] }); // Progress is column H here too
    expect(ws.getCell('S2').value).toBe('CC-1');
  });

  it('creates missing plan sheets, but never Read Me', async () => {
    const saved = await save(bareTasks(['ID', 'Task'], [[1, 'A']]));
    expect(saved.worksheets.map((ws) => ws.name)).toEqual(['Tasks', 'Project', 'Resources', 'Holidays']);
  });

  it('Project: values by Field, user rows untouched, missing fields appended', async () => {
    const wb = bareTasks(['ID', 'Task'], [[1, 'A']]);
    const project = wb.addWorksheet('Project');
    for (const row of [['Mode', 'Track'], ['Client', 'ACME'], ['project name', 'Old name']]) project.addRow(row);
    const r = read(wb);
    r.plan.project = { ...r.plan.project, name: 'Pump station', owner: 'Somchai', projectStart: '2026-11-02', statusDate: '2026-11-13' };
    const saved = await save(wb, r);
    const values = Object.fromEntries(findSheet(saved, 'Project')!.getSheetValues().slice(1).map((row) => [(row as unknown[])[1], (row as unknown[])[2]]));
    expect(values).toEqual({
      Mode: 'Track',
      Client: 'ACME',
      'project name': 'Pump station',
      Owner: 'Somchai',
      'Project Start': new Date(Date.UTC(2026, 10, 2)),
      'Status Date': new Date(Date.UTC(2026, 10, 13)),
      'Last Saved': new Date(Date.UTC(2026, 8, 30, 17, 0)),
      'App Version': '1.0.0',
    });
  });

  it('Resources: appends new assignees with a palette colour; existing rows stay', async () => {
    const wb = await sampleWorkbook();
    const r = read(wb);
    r.plan.tasks[1]!.assigned = ['ACME', 'NewCo'];
    const saved = await save(wb, r);
    const rows = findSheet(saved, 'Resources')!.getSheetValues();
    expect(rows[2]).toEqual([undefined, 'ACME', 'Contractor', RESOURCE_PALETTE[0]]);
    expect(rows[11]).toEqual([undefined, 'NewCo', undefined, RESOURCE_PALETTE[9]]);
  });
});

describe('calculatedChanges — SPEC §5.3', () => {
  it('reports calculated-only columns the save will fill or correct', async () => {
    const wb = await sampleWorkbook();
    taskCell(wb, 2, 'status').value = 'Late';
    taskCell(wb, 3, 'successors').value = null;
    const r = read(wb);
    expect(calculatedChanges(r.plan.tasks, r.layout, computePlan(r.plan))).toEqual([
      { taskId: 1, field: 'Status', from: 'Late', to: 'Completed', kind: 'corrected', reason: 'Calculated' },
      { taskId: 2, field: 'Successors', from: undefined, to: '3SS, 14, 15FS+1', kind: 'filled', reason: 'Calculated' },
    ]);
  });
});
