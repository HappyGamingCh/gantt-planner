// Reading rules added after the audit (SPEC §4.4, §4.5, §4.7, §5.11): odd cells, odd sheets, Thai input.
import { describe, expect, it } from 'vitest';
import { MAX_ID } from '../../src/config';
import { computePlan } from '../../src/engine/compute';
import { isDateFormat } from '../../src/excel/cells';
import { newWorkbook, workbookBytes, type CellValue, type Worksheet } from '../../src/excel/exceljs';
import { findSheet, readTasksHeader } from '../../src/excel/schema';
import { createTemplate } from '../../src/excel/template';
import { calculatedChanges, writePlan } from '../../src/excel/write';
import { bareTasks, NOW, read, reload, sampleWorkbook, save, taskCell, tasksSheet, templateWith } from './helpers';
import { unzip } from './zip';

type Read = ReturnType<typeof read>;
const codes = (r: Read) => r.issues.map((i) => i.code);
const task = (r: Read, id: number) => r.plan.tasks.find((t) => t.id === id)!;
const utc = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m - 1, d, h));
const WORK_ORDER = 4_500_123_456; // a 10-digit number pasted into a date column

describe('a huge number in a date cell is a warning, never a failed Open — SPEC §4.7', () => {
  it('in a task date: General format shows the number, a date format shows #####', async () => {
    const wb = templateWith([{ ID: 1, Task: 'A', 'Actual Start': WORK_ORDER }, { ID: 2, Task: 'B', 'Actual Start': WORK_ORDER }]);
    taskCell(wb, 3, 'actualStart').numFmt = 'dd-mmm-yy';
    const r = read(await reload(wb));
    expect(r.issues.map((i) => i.message)).toEqual([
      `Task 1: "${WORK_ORDER}" in Actual Start is not a date`,
      'Task 2: "#####" in Actual Start is not a date',
      "Numbers too large for a date in Tasks!J3 (Excel shows #####); Gantt Planner can't keep them, so saving removes them. To keep a number, give its cell a number format in Excel and open the file again",
    ]);
    expect(r.plan.tasks.map((t) => t.actualStart)).toEqual([undefined, undefined]);
  });

  it('with a date format, in any sheet: the first Save asks, then empties the cell instead of writing NaN', async () => {
    const wb = templateWith([{ ID: 1, Task: 'A', 'Planned Duration': 1, 'Actual Start': WORK_ORDER }]);
    taskCell(wb, 2, 'actualStart').numFmt = 'dd-mmm-yy';
    const holiday = findSheet(wb, 'Holidays')!.getCell('A2');
    holiday.value = WORK_ORDER;
    holiday.numFmt = 'dd-mmm-yy';
    const other = wb.addWorksheet('Work orders').getCell('B2');
    other.value = { formula: '4500123456+0', result: WORK_ORDER };
    other.numFmt = 'd/m/yyyy';
    const file = await reload(wb);
    const r = read(file);
    const cells = "Tasks!J2, Holidays!A2, 'Work orders'!B2";
    expect(r.issues.find((i) => i.code === 'W_DATE_TOO_LARGE')?.message).toContain(`Numbers too large for a date in ${cells} (Excel shows #####)`);
    expect(r.converted).toEqual([`numbers too large for a date (${cells})`]);

    writePlan(file, r.plan, computePlan(r.plan), r.layout, NOW);
    const sheets = [...unzip(await workbookBytes(file))].filter(([name]) => name.startsWith('xl/worksheets/sheet'));
    expect(sheets.filter(([, xml]) => xml.includes('NaN')).map(([name]) => name)).toEqual([]); // Excel can't open <v>NaN</v>
    const saved = await reload(file);
    expect([taskCell(saved, 2, 'actualStart').value, findSheet(saved, 'Holidays')!.getCell('A2').value]).toEqual([null, null]);
    expect(findSheet(saved, 'Work orders')!.getCell('B2').value).toMatchObject({ formula: '4500123456+0' });
    expect(codes(read(saved))).not.toContain('W_DATE_TOO_LARGE');
  });

  it('in Holidays, in the Project sheet and in a calculated column', async () => {
    const wb = templateWith([{ ID: 1, Task: 'A', 'Planned Duration': 1, 'Forecast Finish': WORK_ORDER }]);
    findSheet(wb, 'Holidays')!.getCell('A2').value = WORK_ORDER;
    const status = findSheet(wb, 'Project')!.getCell('B5');
    status.value = WORK_ORDER;
    status.numFmt = 'General';
    const r = read(await reload(wb));
    expect(r.issues).toEqual([expect.objectContaining({ code: 'W_BAD_HOLIDAY', message: `Holidays row 2: "${WORK_ORDER}" is not a date` })]);
    expect(r.changes).toContainEqual(expect.objectContaining({ field: 'Status Date', from: String(WORK_ORDER), to: '2026-10-30', kind: 'corrected' }));
    const changes = calculatedChanges(r.plan.tasks, r.layout, computePlan(r.plan));
    expect(changes).toContainEqual(expect.objectContaining({ field: 'Forecast Finish', from: String(WORK_ORDER), kind: 'corrected' }));
  });
});

describe('task names with line breaks — SPEC §4.7, §4.8', () => {
  it('are shown on one line; Save keeps the cell until the name is changed in the app', async () => {
    const wb = templateWith([
      { ID: 1, Task: 'เปิดหน้าแปลน\nE-101', Assigned: 'ACME\nNDT' },
      { ID: 2, Task: ' Pump \n overhaul ' },
    ]);
    const r = read(wb);
    expect(r.plan.tasks.map((t) => t.name)).toEqual(['เปิดหน้าแปลน E-101', 'Pump overhaul']);
    expect(r.changes.filter((c) => c.field === 'Task').map((c) => c.taskId)).toEqual([2]); // only the untidy one
    expect(task(r, 1).assigned).toEqual(['ACME NDT']); // Assigned is split on , and ; only
    expect(r.changes).toContainEqual(expect.objectContaining({ taskId: 1, field: 'Assigned', reason: 'Line break read as a space; separate names with ","' }));

    let saved = await save(wb, r);
    expect([taskCell(saved, 2, 'name').value, taskCell(saved, 3, 'name').value]).toEqual(['เปิดหน้าแปลน\nE-101', 'Pump\noverhaul']);
    expect(read(saved).changes.filter((c) => c.field === 'Task')).toEqual([]);

    const renamed = read(saved);
    renamed.plan.tasks[0]!.name = 'Open flange E-101';
    saved = await save(saved, renamed);
    expect(taskCell(saved, 2, 'name').value).toBe('Open flange E-101');
  });

  it('untidy lines are tidied and the line breaks kept; a line break after a comma in Assigned is only a space', async () => {
    const wb = templateWith([
      { ID: 1, Task: 'เปิดหน้าแปลน \nE-101', Assigned: 'ACME,\nNDT' }, // a space typed before Alt+Enter
      { ID: 2, Task: 'A\n\nB' },
      { ID: 3, Task: 'A \nB' },
    ]);
    const r = read(wb);
    expect(r.plan.tasks.map((t) => t.name)).toEqual(['เปิดหน้าแปลน E-101', 'A B', 'A B']);
    expect(r.changes.filter((c) => c.field === 'Task').map((c) => [c.from, c.to, c.reason])).toEqual([
      ['เปิดหน้าแปลน \nE-101', 'เปิดหน้าแปลน\nE-101', 'Spaces tidied'],
      ['A\n\nB', 'A\nB', 'Spaces tidied'],
      ['A \nB', 'A\nB', 'Spaces tidied'],
    ]);
    expect(task(r, 1).assigned).toEqual(['ACME', 'NDT']);
    expect(r.changes).toContainEqual(expect.objectContaining({ taskId: 1, field: 'Assigned', to: 'ACME, NDT', reason: 'Names separated with ", "' }));

    const saved = await save(wb, r);
    expect([2, 3, 4].map((row) => taskCell(saved, row, 'name').value)).toEqual(['เปิดหน้าแปลน\nE-101', 'A\nB', 'A\nB']);
    expect(read(saved).changes.filter((c) => c.field === 'Task')).toEqual([]);
  });

  it('a single assignee with extra spaces is "Spaces tidied"', () => {
    const r = read(templateWith([{ ID: 1, Task: 'A', Assigned: '  ACME ' }]));
    expect(r.changes).toContainEqual(expect.objectContaining({ field: 'Assigned', from: '  ACME ', to: 'ACME', reason: 'Spaces tidied' }));
  });
});

describe('formulas in the Project sheet — SPEC §4.7', () => {
  it('=TODAY() as Status Date means today; any other formula keeps its last value; Save writes values', async () => {
    const wb = createTemplate();
    const project = findSheet(wb, 'Project')!;
    project.getCell('B2').value = { formula: '"Turnaround "&"2026"', result: 'Turnaround 2026' };
    project.getCell('B4').value = { formula: 'B5-7', result: utc(2026, 10, 13) };
    project.getCell('B5').value = { formula: 'TODAY()', result: utc(2026, 10, 20) }; // last recalculated on 20 Oct
    const r = read(wb);
    expect(r.plan.project).toMatchObject({ name: 'Turnaround 2026', projectStart: '2026-10-13', statusDate: '2026-10-30' });
    expect(r.changes.map((c) => [c.field, c.from, c.to, c.reason])).toEqual([
      ['Status Date', '=TODAY()', '2026-10-30', "Formula: today's date is used, and Save writes it as a date"],
      ['Project Name', '="Turnaround "&"2026"', 'Turnaround 2026', 'Formula: Save writes its value'],
      ['Project Start', '=B5-7', '2026-10-13', 'Formula: Save writes its value'],
    ]);

    const saved = findSheet(await save(wb, r), 'Project')!;
    expect([saved.getCell('B2').value, saved.getCell('B4').value, saved.getCell('B5').value]).toEqual([
      'Turnaround 2026',
      utc(2026, 10, 13),
      utc(2026, 10, 30),
    ]);
  });

  it('=NOW() also means today', () => {
    const wb = createTemplate();
    findSheet(wb, 'Project')!.getCell('B5').value = { formula: 'now( )', result: utc(2026, 10, 1, 9) };
    expect(read(wb).plan.project.statusDate).toBe('2026-10-30');
  });
});

describe('Holidays and Resources without their header — SPEC §4.4, §4.5', () => {
  it('Holidays: a renamed "Date" header or a title row above it is reported; the dates are not used', () => {
    const renamed = createTemplate([{ date: '2026-12-31', description: 'New Year' }]);
    findSheet(renamed, 'Holidays')!.getCell('A1').value = 'Holiday Date';
    let r = read(renamed);
    expect(r.plan.holidays).toEqual([]);
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'W_HOLIDAYS_NO_HEADER',
        severity: 'warning',
        message: 'Holidays sheet: no "Date" header in row 1; its dates (1) were not used, so they count as working days',
      }),
    ]);

    const titled = createTemplate();
    const ws = findSheet(titled, 'Holidays')!;
    ws.spliceRows(1, 1, ['Public holidays 2026'], ['Date', 'Description'], [utc(2026, 12, 5), 'Father’s Day'], [utc(2026, 12, 31), 'New Year']);
    r = read(titled);
    expect(r.issues.map((i) => i.message)).toEqual(['Holidays sheet: no "Date" header in row 1; its dates (2) were not used, so they count as working days']);
  });

  it('Holidays: no warning for an empty sheet, even without a header', () => {
    expect(read(createTemplate()).issues).toEqual([]);
    const wb = createTemplate();
    findSheet(wb, 'Holidays')!.getCell('A1').value = null;
    expect(read(wb).issues).toEqual([]); // only the template note in D2
  });

  it('Resources: a renamed "Name" header with rows is reported', () => {
    const wb = createTemplate();
    const ws = findSheet(wb, 'Resources')!;
    ws.getCell('A1').value = 'PIC';
    ws.addRow(['สมชาย', 'Team', '#FF0000']);
    const r = read(wb);
    expect(r.plan.resources).toEqual([]);
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'W_RESOURCES_NO_HEADER',
        message:
          'Resources sheet: no "Name" header in row 1, so its types and colors were not read and Save leaves the sheet as it is (new assignees are not added). Rename the column with the names to "Name" in Excel and open the file again',
      }),
    ]);
  });

  it('Resources: Save leaves a sheet with a renamed "Name" header as it is, so the warning comes back on reopen', async () => {
    const wb = templateWith([{ ID: 1, Task: 'A', Assigned: 'ACME, NDT' }]);
    const ws = findSheet(wb, 'Resources')!;
    ws.getCell('A1').value = 'PIC';
    ws.addRow(['ACME', 'Contractor', '#112233']);
    const rows = (sheet: Worksheet) => {
      const values: CellValue[][] = [];
      sheet.eachRow((row) => values.push((row.values as CellValue[]).slice(1)));
      return values;
    };
    const before = rows(ws);
    const saved = await save(wb);
    expect(rows(findSheet(saved, 'Resources')!)).toEqual(before); // no Name column, no rows mixed into the user's columns
    expect(codes(read(saved))).toContain('W_RESOURCES_NO_HEADER');
  });

  it('Resources: no warning for an empty sheet or one with only the other headers', () => {
    expect(read(createTemplate()).issues).toEqual([]);
    const wb = createTemplate();
    findSheet(wb, 'Resources')!.getCell('A1').value = null;
    expect(read(wb).issues).toEqual([]);
  });
});

describe('numbers shown with a date format — SPEC §4.7', () => {
  it('ID, Planned Duration and a Finish − Start formula are read as numbers, and stay numbers after Save', async () => {
    const wb = templateWith([
      { ID: 2, Task: 'A', 'Planned Start': '2026-11-02', 'Planned Duration': 5 },
      { ID: 1, Task: 'B', 'Planned Start': '2026-11-02', 'Planned Duration': { formula: 'G3-E3', result: 3 } },
    ]);
    for (const row of [2, 3]) {
      taskCell(wb, row, 'id').numFmt = 'd/m/yyyy';
      taskCell(wb, row, 'plannedDuration').numFmt = 'd-mmm-yy';
    }
    const file = await reload(wb);
    expect(taskCell(file, 2, 'plannedDuration').value).toEqual(utc(1900, 1, 4)); // what ExcelJS hands over
    const r = read(file);
    expect(r.plan.tasks.map((t) => [t.id, t.plannedDuration])).toEqual([[2, 5], [1, 3]]);
    expect(codes(r)).toEqual(['W_FORMULA']);
    expect(r.changes.filter((c) => c.taskId !== undefined)).toEqual([]);

    const saved = await save(file, r);
    for (const field of ['id', 'plannedDuration'] as const) {
      expect(isDateFormat(taskCell(saved, 2, field).numFmt)).toBe(false); // Excel shows 5, not 05-Jan-00
    }
    const again = read(saved);
    expect(again.plan.tasks.map((t) => [t.id, t.plannedDuration])).toEqual([[2, 5], [1, 3]]);
  });
});

describe('a time of day in an input date cell — SPEC §4.8', () => {
  it('stays while the day is unchanged; a new day is written as a date', async () => {
    const wb = await sampleWorkbook();
    const start = taskCell(wb, 3, 'actualStart'); // task 2: started 2026-09-28
    start.value = utc(2026, 9, 28, 19);
    start.numFmt = 'dd-mmm-yy hh:mm';
    const file = await reload(wb);
    const r = read(file);
    expect(task(r, 2).actualStart).toBe('2026-09-28');
    expect(r.changes).toEqual([]);

    let saved = await save(file, r);
    expect(taskCell(saved, 3, 'actualStart')).toMatchObject({ value: utc(2026, 9, 28, 19), numFmt: 'dd-mmm-yy hh:mm' });

    const moved = read(saved);
    task(moved, 2).actualStart = '2026-09-27';
    saved = await save(saved, moved);
    expect(taskCell(saved, 3, 'actualStart').value).toEqual(utc(2026, 9, 27));
  });
});

describe('1904 date system — SPEC §4.7', () => {
  it('a serial number in a 1904 workbook (old Mac files) counts from 1904', async () => {
    const wb = bareTasks(['ID', 'Task', 'Planned Start', 'Planned Duration'], [[1, 'A', 44834, 2]]);
    wb.properties.date1904 = true;
    const file = await reload(wb);
    expect(file.properties.date1904).toBe(true);
    expect(read(file).plan.tasks[0]).toMatchObject({ plannedStart: '2026-10-01', plannedDuration: 2 });
  });
});

describe('IDs — SPEC §4.7', () => {
  it('an ID of more than 12 digits gets the next free ID, so new IDs never repeat', () => {
    const r = read(bareTasks(['ID', 'Task'], [[1e20, 'A'], [null, 'B'], [null, 'C'], [4_500_123_456, 'D'], [MAX_ID + 1, 'E']]));
    expect(r.plan.tasks.map((t) => t.id)).toEqual([4_500_123_457, 4_500_123_458, 4_500_123_459, 4_500_123_456, 4_500_123_460]);
    const reason = 'Not a whole number from 1 to 999,999,999,999';
    expect(r.changes.filter((c) => c.field === 'ID').map((c) => [c.from, c.kind, c.reason])).toEqual([
      ['100000000000000000000', 'corrected', reason],
      [undefined, 'filled', 'Next free ID'],
      [undefined, 'filled', 'Next free ID'],
      ['1000000000000', 'corrected', reason],
    ]);
    expect(codes(r)).toEqual([]);
  });
});

describe('a formatted cell far to the right — SPEC §4.3', () => {
  it('is not a user column; Save stays fast and appends a missing column next to the real ones', async () => {
    const wb = templateWith(Array.from({ length: 150 }, (_, i) => ({ ID: i + 1, Task: `Task ${i + 1}`, 'Planned Duration': 1 })));
    const ws = tasksSheet(wb);
    ws.getCell(1, 18).value = 'Crit flag'; // "Critical" renamed: Save appends it again
    ws.getCell(2, 16384).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    const file = await reload(wb);
    expect(tasksSheet(file).columnCount).toBe(16384);
    expect(readTasksHeader(tasksSheet(file))).toMatchObject({ lastCol: 19, extras: [{ key: 'Crit flag', col: 18 }] });

    const started = performance.now();
    const saved = await save(file);
    expect(performance.now() - started).toBeLessThan(3000); // was about 6 s
    expect(tasksSheet(saved).getCell(1, 20).value).toBe('Critical');
  });

  it('a note in an empty, formatted cell right of the last column makes a user column, so the note moves with its task', async () => {
    const wb = templateWith([1, 2, 3].map((id) => ({ ID: id, Task: `T${id}`, 'Planned Duration': 1 })));
    const cell = tasksSheet(wb).getCell(4, 22); // V4: task 3's row, right of Remarks (S)
    cell.note = 'Check with the vendor';
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    const file = await reload(wb);
    expect(readTasksHeader(tasksSheet(file))).toMatchObject({ lastCol: 22 });

    const r = read(file);
    r.plan.tasks = r.plan.tasks.filter((t) => t.id !== 2); // delete task 2: task 3 moves up to row 3
    const saved = tasksSheet(await save(file, r));
    expect(saved.getCell(3, 3).value).toBe('T3'); // Task: column C
    expect(saved.getCell(3, 22).note).toBeDefined();
    expect(saved.getCell(3, 22).fill).toMatchObject({ pattern: 'solid' });
    expect(saved.getCell(4, 22).note).toBeUndefined();
    expect(saved.getCell(1, 22).value).toBeNull(); // no header added
  });

  it('a column without a header but with data is still a user column', () => {
    const wb = bareTasks(['ID', 'Task', '', ''], [[1, 'A', null, 'x']]);
    tasksSheet(wb).getCell(2, 30).numFmt = '0.00'; // formatting only
    expect(readTasksHeader(tasksSheet(wb)).extras).toEqual([
      { key: 'Column C', col: 3 },
      { key: 'Column D', col: 4 },
    ]);
  });
});

describe('a file whose tasks are not where the app looks — SPEC §4.1, §4.3', () => {
  it('no Tasks sheet: one warning naming the sheets', () => {
    const wb = newWorkbook();
    wb.addWorksheet('Schedule').addRow(['ID', 'Task']);
    wb.addWorksheet('Sheet1');
    const r = read(wb);
    expect(r.plan.tasks).toEqual([]);
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'W_NO_TASKS_SHEET',
        severity: 'warning',
        message: 'No sheet named "Tasks": this file has "Schedule", "Sheet1". Rename the sheet with your tasks to Tasks (headers in row 1) and open the file again',
      }),
    ]);
  });

  it('a title row above the headers: one error naming the header row instead of a warning per row; every value kept', () => {
    const wb = bareTasks(['Furnace turnaround 2026'], [['ID', 'Task', 'Planned Duration'], [1, 'Erect scaffold', 5], [2, 'Open manhole', 3]]);
    const r = read(wb);
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'E_NO_TASK_HEADER',
        severity: 'error',
        message: 'Tasks sheet: row 1 has no "Task" header; the headers seem to be in row 2. Delete the rows above them in Excel and open the file again',
      }),
    ]);
    expect(r.plan.tasks.map((t) => t.name)).toEqual(['(Untitled)', '(Untitled)', '(Untitled)']);
    expect(r.plan.tasks[1]?.extra).toEqual({ 'Furnace turnaround 2026': 1, 'Column B': 'Erect scaffold', 'Column C': 5 });
  });

  it('other header names: the error lists what row 1 has', () => {
    const r = read(bareTasks(['No', 'Activity', 'PIC'], [[10, 'Survey', 'ACME']]));
    expect(r.issues.map((i) => i.message)).toEqual([
      'Tasks sheet: row 1 has no "Task" header; it has "No", "Activity", "PIC". Rename the column with the task names to "Task" in Excel and open the file again',
    ]);
    expect(task(r, 10)).toMatchObject({ name: '(Untitled)', assigned: ['ACME'], extra: { Activity: 'Survey' } });
  });

  it('missing input columns next to user columns: one warning listing both', () => {
    const r = read(bareTasks(['ID', 'Task', 'Start Date', 'Progress %', 'Duration'], [[1, 'A', '2026-11-02', 50, 3]]));
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'W_COLUMNS_NOT_FOUND',
        severity: 'warning',
        message:
          'Tasks sheet: columns not found: "Assigned", "Predecessors", "Planned Start", "Progress (%)", "Actual Start" and 2 more. Kept as your own columns: "Start Date", "Progress %". If one of them is meant to be a planner column, rename its header in Excel and open the file again',
      }),
    ]);
  });

  it('the sample, the template and a sheet without user columns report none of these', async () => {
    expect(read(await sampleWorkbook()).issues).toEqual([]);
    expect(read(createTemplate()).issues).toEqual([]);
    expect(read(bareTasks(['ID', 'Task', 'Duration'], [[1, 'A', 2]])).issues).toEqual([]);
  });
});

describe('W_FORMULA says where the formulas are — SPEC §4.7', () => {
  it('each column with its header and cells, in column order', () => {
    const wb = templateWith([
      { ID: 1, Task: { formula: '"Pump"&" A"', result: 'Pump A' }, 'Planned Duration': { formula: '1+1', result: 2 } },
      { ID: 2, Task: 'B', 'Planned Start': { sharedFormula: 'E2', result: utc(2026, 11, 2) } },
    ]);
    const [issue] = read(wb).issues;
    expect(issue).toMatchObject({ code: 'W_FORMULA', severity: 'info', message: 'Formulas in Tasks will be saved as values: Task C2, Planned Start F3, Planned Duration G2' });
    expect(issue?.taskId).toBeUndefined();
  });

  it('points to the task when every formula is in its row (a "Total" row)', () => {
    const r = read(templateWith([
      { ID: 1, Task: 'A', 'Planned Duration': 2 },
      { ID: 2, Task: 'B', 'Planned Duration': 3 },
      { Task: 'Total', 'Planned Duration': { formula: 'SUM(F2:F3)', result: 5 } },
    ]));
    expect(r.issues).toEqual([expect.objectContaining({ code: 'W_FORMULA', taskId: 3, message: 'Formulas in Tasks will be saved as values: Planned Duration G4' })]);
  });

  it('ranges of rows, user columns by header, and at most 3 columns', () => {
    const f = (result: number) => ({ formula: '1+1', result });
    let r = read(templateWith([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ ID: i, Task: `T${i}`, 'Planned Duration': [1, 2, 3, 5, 7, 9].includes(i) ? f(i) : i }))));
    expect(r.issues[0]?.message).toBe('Formulas in Tasks will be saved as values: Planned Duration G2:G4, G6, G8, …');

    r = read(bareTasks(['ID', 'Task', 'Manhours'], [[1, 'A', f(6)]]));
    expect(r.issues.find((i) => i.code === 'W_FORMULA')?.message).toBe('Formulas in Tasks will be saved as values: Manhours C2');

    r = read(templateWith([{ ID: 1, Task: f(1), Assigned: f(2), Predecessors: f(3), 'Progress (%)': f(4), Remarks: f(5) }]));
    expect(r.issues.find((i) => i.code === 'W_FORMULA')?.message).toBe(
      'Formulas in Tasks will be saved as values: Task C2, Assigned D2, Predecessors E2, and 2 more columns',
    );
  });
});

describe('Planned Duration with a day unit — SPEC §4.7', () => {
  it('"5 days", "3d", "4 วัน" are read as numbers (corrected) and saved as numbers', async () => {
    const wb = templateWith([
      { ID: 1, Task: 'A', 'Planned Start': '2026-11-02', 'Planned Duration': '5 days' },
      { ID: 2, Task: 'B', Predecessors: '1', 'Planned Duration': '3d' },
      { ID: 3, Task: 'C', Predecessors: '2', 'Planned Duration': '4.4 วัน' },
    ]);
    const r = read(wb);
    expect(r.plan.tasks.map((t) => t.plannedDuration)).toEqual([5, 3, 4]);
    expect(codes(r)).toEqual([]);
    expect(r.changes.filter((c) => c.field === 'Planned Duration').map((c) => [c.from, c.to, c.reason])).toEqual([
      ['5 days', 5, 'Unit removed'],
      ['3d', 3, 'Unit removed'],
      ['4.4 วัน', 4, 'Unit removed, rounded to a whole number'],
    ]);
    expect(computePlan(r.plan).tasks.at(-1)?.plannedFinish).toBe('2026-11-13');
    const saved = await save(wb, r);
    expect([2, 3, 4].map((row) => taskCell(saved, row, 'plannedDuration').value)).toEqual([5, 3, 4]);
  });

  it('more than 3650 days is a warning, blank for calculation, and the cell is written back unchanged', async () => {
    const wb = templateWith([{ ID: 1, Task: 'A', 'Planned Duration': 46000 }]);
    const r = read(wb);
    expect(r.issues.map((i) => i.message)).toEqual(['Task 1: "46000" in Planned Duration is not a valid number']);
    expect(task(r, 1).plannedDuration).toBeUndefined();
    expect(taskCell(await save(wb, r), 2, 'plannedDuration').value).toBe(46000);
  });
});

describe('Buddhist-era years — SPEC §4.7', () => {
  it('in Tasks: converted with a Change, and saved as a Western date', async () => {
    const wb = templateWith([{ ID: 1, Task: 'A', 'Planned Start': '2/11/2569', 'Actual Start': '2 พ.ย. 69' }]);
    const r = read(wb);
    expect(task(r, 1)).toMatchObject({ plannedStart: '2026-11-02', actualStart: '2026-11-02' });
    expect(codes(r)).toEqual([]);
    expect(r.changes.filter((c) => c.taskId === 1).map((c) => [c.field, c.from, c.to, c.reason])).toEqual([
      ['Planned Start', '2/11/2569', '2026-11-02', 'Buddhist-era year converted'],
      ['Actual Start', '2 พ.ย. 69', '2026-11-02', 'Buddhist-era year converted'],
    ]);
    expect(taskCell(await save(wb, r), 2, 'plannedStart').value).toEqual(utc(2026, 11, 2));
  });

  it('in the Project sheet: converted with a Change; in Holidays: kept quietly (that sheet is never written)', () => {
    const wb = createTemplate();
    findSheet(wb, 'Project')!.getCell('B5').value = '15/10/2569';
    findSheet(wb, 'Holidays')!.addRow([utc(2569, 12, 5), 'วันพ่อ']).getCell(1).numFmt = 'dd-mmm-yy';
    findSheet(wb, 'Holidays')!.addRow(['13 เม.ย. 2569', 'สงกรานต์']);
    const r = read(wb);
    expect(r.plan.project.statusDate).toBe('2026-10-15');
    expect(r.changes).toContainEqual({ field: 'Status Date', from: '15/10/2569', to: '2026-10-15', kind: 'corrected', reason: 'Buddhist-era year converted' });
    expect(r.plan.holidays).toEqual([
      { date: '2026-12-05', description: 'วันพ่อ' },
      { date: '2026-04-13', description: 'สงกรานต์' },
    ]);
    expect(r.issues).toEqual([]);
    expect(r.changes.filter((c) => c.field.startsWith('Holidays'))).toEqual([]);
  });
});
