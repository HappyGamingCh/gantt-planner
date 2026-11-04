import { describe, expect, it } from 'vitest';
import { sampleBytes, toArrayBuffer } from '../../scripts/fixtures';
import { computePlan } from '../../src/engine/compute';
import type { Task } from '../../src/engine/types';
import { conditionalFormatsOf, loadWorkbook, mergesOf, tablesOf, validationsOf, workbookBytes, type Workbook } from '../../src/excel/exceljs';
import { readPlan } from '../../src/excel/read';
import { findSheet } from '../../src/excel/schema';
import { scanFile } from '../../src/excel/unsupported';
import { writePlan } from '../../src/excel/write';
import { NOW, TODAY, bareTasks, fixture, read, reload, sampleWorkbook, save, taskCell, tasksSheet, templateWith } from './helpers';
import { patchZip, unzip } from './zip';

const TASKS = 'xl/worksheets/sheet2.xml'; // the sample's Tasks sheet
const newTask = (id: number, name = 'New task'): Task => ({ id, name, assigned: [], predecessorsText: '', plannedDuration: 1, progress: 0, remarks: '', extra: {} });

/** Save as the app does and return the file's bytes. */
async function savedBytes(wb: Workbook, r = read(wb)): Promise<Uint8Array> {
  writePlan(wb, r.plan, computePlan(r.plan), r.layout, NOW);
  return workbookBytes(wb);
}

describe('Excel tables — SPEC §3.5', () => {
  /**
   * The sample with Ctrl+T on its task list, as Excel writes it: no headerRowCount, the sheet's filter moved into the
   * table. `filtered`: saved filtered on Assigned, the criteria in the table part and rows 3 and 4 hidden.
   */
  async function taskTableBytes(filtered = false): Promise<Uint8Array> {
    const ws = tasksSheet(await sampleWorkbook());
    const headers = (ws.getRow(1).values as unknown[]).slice(1).map(String);
    const ref = `A1:T${ws.rowCount}`; // ID … Remarks, Area
    const criteria = filtered ? '<filterColumn colId="2"><filters><filter val="ACME"/></filters></filterColumn>' : '';
    const table =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="TaskTable" displayName="TaskTable" ref="${ref}" totalsRowShown="0">` +
      `<autoFilter ref="${ref}">${criteria}</autoFilter><tableColumns count="${headers.length}">${headers.map((h, i) => `<tableColumn id="${i + 1}" name="${h}"/>`).join('')}</tableColumns>` +
      '<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>';
    return patchZip(await sampleBytes(), {
      [TASKS]: (xml) =>
        xml
          .replace(/<autoFilter [^>]*\/>/, '')
          .replace('</worksheet>', '<tableParts count="1"><tablePart r:id="rId9"/></tableParts></worksheet>')
          .replace(/<row r="(3|4)"/g, filtered ? '<row r="$1" hidden="1"' : '<row r="$1"'),
      'xl/worksheets/_rels/sheet2.xml.rels': (xml) =>
        xml.replace('</Relationships>', '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>'),
      '[Content_Types].xml': (xml) =>
        xml.replace('</Types>', '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>'),
      'xl/tables/table1.xml': () => table,
    });
  }
  const withTaskTable = async (): Promise<Workbook> => loadWorkbook(toArrayBuffer(await taskTableBytes()));

  it('are reported at load and asked about before the first Save', async () => {
    const wb = await withTaskTable();
    const permits = wb.addWorksheet('Permits');
    permits.addTable({ name: 'PermitTable', ref: 'A1', headerRow: true, columns: [{ name: 'Permit' }, { name: 'Owner' }], rows: [['Hot work', 'Safety']] });
    const r = read(wb);
    expect(r.issues.map((i) => i.code)).toEqual(['W_EXCEL_TABLES']);
    expect(r.issues[0]?.message).toContain('("TaskTable", "PermitTable")');
    expect(r.converted).toEqual(['Excel tables (their cells stay, as normal ranges)']);
  });

  it('become normal ranges on Save: no table part, values and notes kept, the filter back on the sheet', async () => {
    const wb = await withTaskTable();
    expect(tablesOf(tasksSheet(wb)).map((t) => t.name)).toEqual(['TaskTable']);
    const first = read(wb);
    const bytes = await savedBytes(wb, first);
    expect([...unzip(bytes).keys()].filter((name) => name.includes('tables/'))).toEqual([]);
    const saved = await loadWorkbook(toArrayBuffer(bytes));
    expect(tablesOf(tasksSheet(saved))).toEqual([]);
    expect(tasksSheet(saved).autoFilter).toBe(`A1:T${tasksSheet(wb).rowCount}`);
    expect(taskCell(saved, 1, 'variance').note).toBeTruthy(); // the header note (legacy drawing) is still there
    const again = read(saved);
    expect(again.plan.tasks.map((t) => [t.id, t.name, t.assigned])).toEqual(first.plan.tasks.map((t) => [t.id, t.name, t.assigned]));
    expect(again.issues).toEqual([]);
  });

  it('a table saved filtered: its filter is found in the table part, and Save shows the rows it hid', async () => {
    const bytes = await taskTableBytes(true);
    const wb = await loadWorkbook(toArrayBuffer(bytes));
    expect(tasksSheet(wb).getRow(3).hidden).toBe(true);
    const r = readPlan(wb, TODAY, (await scanFile(bytes)).filtered);
    expect(r.issues.map((i) => i.code)).toEqual(['W_EXCEL_TABLES', 'W_EXCEL_FILTER']);
    const saved = await save(wb, r);
    expect(tablesOf(tasksSheet(saved))).toEqual([]);
    expect([3, 4].map((n) => tasksSheet(saved).getRow(n).hidden)).toEqual([false, false]);
  });
});

describe('merged cells in Tasks — SPEC §4.7, §4.8', () => {
  /** Tasks 1–5; Assigned D3:D5 (tasks 2–4) merged as ACME, task 5 NDT2. */
  async function mergedAssigned(): Promise<Workbook> {
    const wb = templateWith(
      [1, 2, 3, 4, 5].map((id) => ({ ID: id, Task: `T${id}`, Assigned: id === 5 ? 'NDT2' : id >= 2 ? 'ACME' : null, 'Planned Duration': 1 })),
    );
    tasksSheet(wb).mergeCells('D3:D5');
    return reload(wb);
  }
  const assignedAfter = async (edit: (tasks: Task[]) => Task[]) => {
    const wb = await mergedAssigned();
    const r = read(wb);
    r.plan.tasks = edit(r.plan.tasks);
    const saved = await save(wb, r);
    expect(mergesOf(tasksSheet(saved)).filter((m) => m.bottom >= 2)).toEqual([]);
    return read(saved).plan.tasks.map((t) => [t.name, t.assigned.join(', ')]);
  };

  it('a value merged down belongs to every row; the load warns that Save splits it', async () => {
    const r = read(await mergedAssigned());
    expect(r.plan.tasks.map((t) => t.assigned)).toEqual([[], ['ACME'], ['ACME'], ['ACME'], ['NDT2']]);
    expect(r.issues.map((i) => i.message)).toEqual(['Merged cells in Tasks (D3:D5) will be split when you save; each task keeps its own value']);
    expect(r.converted).toEqual(['merged cells in Tasks (each task keeps its value)']);
  });

  it('an edit, a delete or a move lands on its own task', async () => {
    const edited = await assignedAfter((tasks) => tasks.map((t) => (t.id === 3 ? { ...t, assigned: ['NDT'] } : t)));
    expect(edited).toEqual([['T1', ''], ['T2', 'ACME'], ['T3', 'NDT'], ['T4', 'ACME'], ['T5', 'NDT2']]);
    const deleted = await assignedAfter((tasks) => tasks.filter((t) => t.id !== 4));
    expect(deleted).toEqual([['T1', ''], ['T2', 'ACME'], ['T3', 'ACME'], ['T5', 'NDT2']]);
    const moved = await assignedAfter((tasks) => [tasks[0]!, tasks[4]!, ...tasks.slice(1, 4)]);
    expect(moved).toEqual([['T1', ''], ['T5', 'NDT2'], ['T2', 'ACME'], ['T3', 'ACME'], ['T4', 'ACME']]);
  });

  it('a heading merged across a row stays in its own cell: no bad dates, no made-up resource, no lost task', async () => {
    const wb = templateWith([
      { ID: 1, Task: 'Open manhole', Assigned: 'ACME', 'Planned Duration': 1 },
      { ID: 2, Task: 'Inspect', Assigned: 'ACME', 'Planned Duration': 1 },
      { Task: 'Mechanical works' },
      { ID: 3, Task: 'Box up', Assigned: 'NDT2', 'Planned Duration': 1 },
    ]);
    tasksSheet(wb).mergeCells('C4:S4'); // Task … Remarks
    const file = await reload(wb);
    const r = read(file);
    expect(r.plan.tasks.map((t) => [t.name, t.assigned.join(', ')])).toEqual([
      ['Open manhole', 'ACME'],
      ['Inspect', 'ACME'],
      ['Mechanical works', ''],
      ['Box up', 'NDT2'],
    ]);
    expect(r.issues.map((i) => i.code)).toEqual(['W_MERGED_CELLS']);
    r.plan.tasks = r.plan.tasks.filter((t) => t.id !== 1);
    const saved = await save(file, r);
    expect(read(saved).plan.tasks.map((t) => [t.name, t.assigned.join(', ')])).toEqual([
      ['Inspect', 'ACME'],
      ['Mechanical works', ''],
      ['Box up', 'NDT2'],
    ]);
    expect(findSheet(saved, 'Resources')!.getColumn(1).values.slice(2)).toEqual(['ACME', 'NDT2']);
  });

  it('a heading merged across the whole row from ID (Merge & Center) becomes a named task; Save keeps its text', async () => {
    const wb = templateWith([
      { ID: 1, Task: 'Open manhole', Assigned: 'ACME', 'Planned Duration': 1 },
      { ID: 2, Task: 'Inspect', Assigned: 'ACME', 'Planned Duration': 1 },
      { ID: 'Mechanical works' },
      { ID: 3, Task: 'Box up', Assigned: 'NDT2', 'Planned Duration': 1 },
    ]);
    tasksSheet(wb).mergeCells('A4:R4');
    const file = await reload(wb);
    const r = read(file);
    expect(r.plan.tasks.map((t) => [t.id, t.name, t.assigned.join(', ')])).toEqual([
      [1, 'Open manhole', 'ACME'],
      [2, 'Inspect', 'ACME'],
      [4, 'Mechanical works', ''],
      [3, 'Box up', 'NDT2'],
    ]);
    expect(r.issues.map((i) => i.code)).toEqual(['W_MERGED_CELLS']);
    expect(r.changes.filter((c) => c.taskId === 4).map((c) => [c.field, c.kind, c.reason])).toEqual([['ID', 'filled', 'Next free ID']]);
    const saved = await save(file, r);
    expect(mergesOf(tasksSheet(saved)).filter((m) => m.bottom >= 2)).toEqual([]);
    expect([taskCell(saved, 4, 'id').value, taskCell(saved, 4, 'name').value]).toEqual([4, 'Mechanical works']);
    expect(read(saved).plan.tasks.map((t) => [t.id, t.name])).toEqual([
      [1, 'Open manhole'],
      [2, 'Inspect'],
      [4, 'Mechanical works'],
      [3, 'Box up'],
    ]);
  });
});

describe('an Excel filter — SPEC §3.5, §4.8', () => {
  /** The sample saved by Excel while filtered on Assigned: rows 3 and 4 hidden by the filter. */
  const filteredBytes = async () =>
    patchZip(await sampleBytes(), {
      [TASKS]: (xml) =>
        xml
          .replace(/<autoFilter ref="([^"]+)"\/>/, '<autoFilter ref="$1"><filterColumn colId="2"><filters><filter val="ACME"/></filters></filterColumn></autoFilter>')
          .replace(/<row r="(3|4)"/g, '<row r="$1" hidden="1"'),
    });

  it('shows the rows it hid once Save drops it, and says so at load', async () => {
    const bytes = await filteredBytes();
    const wb = await loadWorkbook(toArrayBuffer(bytes));
    expect(tasksSheet(wb).getRow(3).hidden).toBe(true);
    const r = readPlan(wb, TODAY, (await scanFile(bytes)).filtered);
    expect(r.issues.map((i) => [i.code, i.severity])).toEqual([['W_EXCEL_FILTER', 'info']]);
    expect(r.converted).toEqual([]);
    const saved = await save(wb, r);
    expect([3, 4].map((n) => tasksSheet(saved).getRow(n).hidden)).toEqual([false, false]);
  });

  it('a row hidden by hand in a sheet without a filter stays hidden, with its task', async () => {
    const wb = await sampleWorkbook();
    tasksSheet(wb).getRow(3).hidden = true; // task 2
    const file = await reload(wb);
    const r = read(file);
    r.plan.tasks.unshift(newTask(26));
    const saved = await save(file, r);
    expect([3, 4].map((n) => tasksSheet(saved).getRow(n).hidden)).toEqual([false, true]);
  });
});

describe('notes and row groups travel with their task — SPEC §4.8', () => {
  const hasNote = (wb: Workbook, row: number) => taskCell(wb, row, 'name').note !== undefined;

  it('a note stays on its task when tasks move, are added or deleted', async () => {
    const wb = await fixture('excel-saved.xlsx'); // note "Check with QC" on B10, task 9
    const first = read(wb);
    const swapped = [...first.plan.tasks];
    [swapped[7], swapped[8]] = [swapped[8]!, swapped[7]!];
    let saved = await save(wb, { ...first, plan: { ...first.plan, tasks: swapped } });
    expect([9, 10].map((n) => [taskCell(saved, n, 'id').value, hasNote(saved, n)])).toEqual([
      [9, true],
      [8, false],
    ]);

    const r = read(saved);
    r.plan.tasks = [newTask(27), ...r.plan.tasks.filter((t) => t.id !== 9)];
    saved = await save(saved, r);
    expect(Array.from({ length: 27 }, (_, i) => i + 2).filter((n) => hasNote(saved, n))).toEqual([]);
  });

  it('a row keeps its outline level with its hidden state; a new task joins the group above it', async () => {
    const wb = await sampleWorkbook();
    const ws = tasksSheet(wb);
    for (let n = 16; n <= 20; n++) Object.assign(ws.getRow(n), { outlineLevel: 1, hidden: true });
    ws.properties.outlineLevelRow = 1;
    const file = await reload(wb);
    const r = read(file);
    const at = r.plan.tasks.findIndex((t) => t.id === 15); // row 16, the first of the group
    r.plan.tasks.splice(at + 1, 0, newTask(26));
    r.plan.tasks.unshift(newTask(27));
    const saved = await save(file, r);
    const rows = Array.from({ length: 8 }, (_, i) => tasksSheet(saved).getRow(i + 16));
    expect(rows.map((row) => [row.number, row.outlineLevel, row.hidden])).toEqual([
      [16, 0, false],
      [17, 1, true], // task 15
      [18, 1, false], // new task 26
      [19, 1, true],
      [20, 1, true],
      [21, 1, true],
      [22, 1, true], // task 19
      [23, 0, false],
    ]);
  });
});

describe('ranges over the task rows follow them — SPEC §4.3, §4.8', () => {
  it('conditional formats and the print area grow and shrink with the task block; other ranges stay', async () => {
    const wb = await fixture('excel-saved.xlsx'); // 26 tasks: rows 2–27, a conditional format on P2:P27
    tasksSheet(wb).pageSetup.printArea = 'A1:R27';
    const file = await reload(wb);
    const r = read(file);
    r.plan.tasks.splice(3, 0, newTask(27), newTask(28), newTask(29));
    let saved = await save(file, r);
    expect(conditionalFormatsOf(tasksSheet(saved)).map((cf) => cf.ref)).toEqual(['P2:P30']);
    expect(tasksSheet(saved).pageSetup.printArea).toBe('A1:R30');

    const shorter = read(saved);
    shorter.plan.tasks = shorter.plan.tasks.slice(0, 22).map((t) => ({ ...t, predecessorsText: '' }));
    saved = await save(saved, shorter);
    expect(conditionalFormatsOf(tasksSheet(saved)).map((cf) => cf.ref)).toEqual(['P2:P23']);
    expect(tasksSheet(saved).pageSetup.printArea).toBe('A1:R23');

    tasksSheet(saved).pageSetup.printArea = 'A1:R1000';
    saved = await save(saved);
    expect(tasksSheet(saved).pageSetup.printArea).toBe('A1:R1000');
  });

  it('the header filter widens to columns added on the right, but a filter the user removed stays removed', async () => {
    const wb = templateWith([{ ID: 1, Task: 'A', 'Planned Duration': 1 }]);
    const r = read(wb);
    r.plan.tasks[0]!.extra = { Area: 'Furnace' };
    expect(tasksSheet(await save(wb, r)).autoFilter).toBe('A1:T1');

    const none = bareTasks(['ID', 'Task'], [[1, 'A']]);
    expect(tasksSheet(await save(none)).autoFilter).toBeFalsy();
  });

  it('a drop-down that covered every task row reaches the new ones', async () => {
    const wb = bareTasks(['ID', 'Task', 'Assigned'], [[1, 'A', 'X'], [2, 'B', 'Y']]);
    validationsOf(tasksSheet(wb)).add('C2:C3', { type: 'list', allowBlank: true, formulae: ['"X,Y"'] });
    const file = await reload(wb); // one rule per cell, as ExcelJS loads a file
    const r = read(file);
    r.plan.tasks.push(newTask(3), newTask(4));
    const saved = await save(file, r);
    expect(['C4', 'C5'].map((a) => validationsOf(tasksSheet(saved)).model[a]?.type)).toEqual(['list', 'list']);
  });
});
