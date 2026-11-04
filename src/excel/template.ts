// Blank plan workbook (SPEC §4): five sheets with header styles, widths, freeze panes, autofilter, validation, Read Me.
// The writer reuses the sheet builders when a file is missing a sheet or a known column.
import { MAX_LEVEL } from '../engine/outline';
import type { Holiday } from '../engine/types';
import { excelDate } from './cells';
import { newWorkbook, validationsOf, type DataValidation, type Workbook, type Worksheet } from './exceljs';
import { HOLIDAYS_NOTE, README_LINES, README_TITLE } from './readme';
import {
  CALC_NOTE,
  DATE_FORMAT,
  DATE_TIME_FORMAT,
  HOLIDAY_HEADERS,
  PROJECT_FIELDS,
  RESOURCE_HEADERS,
  SHEETS,
  TASK_COLUMNS,
  columnLetter,
  headerStyle,
  type TaskColumn,
  type TaskField,
} from './schema';

/** Rows 2…VALIDATED_ROWS of the Tasks sheet carry data validation (plans have ≤ 200 tasks). */
export const VALIDATED_ROWS = 1000;

const error = (title: string, message: string) => ({ showErrorMessage: true, errorTitle: title, error: message });
const dateRule: DataValidation = {
  type: 'date',
  operator: 'between',
  allowBlank: true,
  formulae: [excelDate('1950-01-01'), excelDate('2199-12-31')],
  ...error('Date', 'Enter a date, for example 1-Oct-26.'),
};
const VALIDATION: Partial<Record<TaskField, DataValidation>> = {
  plannedStart: dateRule,
  plannedFinish: dateRule,
  actualStart: dateRule,
  actualFinish: dateRule,
  plannedDuration: {
    type: 'whole',
    operator: 'greaterThanOrEqual',
    allowBlank: true,
    formulae: [0],
    ...error('Planned Duration', 'Enter a whole number of working days (0 = milestone).'),
  },
  level: {
    type: 'whole',
    operator: 'between',
    allowBlank: true,
    formulae: [1, MAX_LEVEL],
    ...error('Level', `Enter a whole number from 1 to ${MAX_LEVEL}: 1 = top level; a row followed by deeper rows is a major task.`),
  },
  // Decimal, not whole: typing 50% stores 0.5, which the reader turns back into 50 (§4.7).
  progress: {
    type: 'decimal',
    operator: 'between',
    allowBlank: true,
    formulae: [0, 100],
    ...error('Progress (%)', 'Enter a number from 0 to 100, for example 50 or 50%.'),
  },
};

export function createTemplate(holidays: readonly Holiday[] = []): Workbook {
  const wb = newWorkbook();
  wb.creator = 'Gantt Planner';
  addProjectSheet(wb);
  addTasksSheet(wb);
  addResourcesSheet(wb);
  addHolidaysSheet(wb, holidays);
  addReadMeSheet(wb);
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: 'visible' }];
  return wb;
}

function addHeaderRow(ws: Worksheet, headers: readonly string[], widths: readonly number[]) {
  headers.forEach((header, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value = header;
    cell.style = headerStyle(false);
    ws.getColumn(i + 1).width = widths[i];
  });
}

export function addProjectSheet(wb: Workbook): Worksheet {
  const ws = wb.addWorksheet(SHEETS.project);
  addHeaderRow(ws, ['Field', 'Value'], [16, 32]);
  PROJECT_FIELDS.forEach((field, i) => {
    ws.getCell(i + 2, 1).value = field;
    if (field === 'Project Start' || field === 'Status Date') ws.getCell(i + 2, 2).numFmt = DATE_FORMAT;
    if (field === 'Last Saved') ws.getCell(i + 2, 2).numFmt = DATE_TIME_FORMAT;
    if (field === 'Mode') ws.getCell(i + 2, 2).value = 'Plan';
  });
  return ws;
}

export function addTasksSheet(wb: Workbook): Worksheet {
  const ws = wb.addWorksheet(SHEETS.tasks, { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
  TASK_COLUMNS.forEach((column, i) => addTaskColumn(ws, i + 1, column));
  ws.getRow(1).height = 30;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: TASK_COLUMNS.length } };
  return ws;
}

/** Header cell, width and validation of a known Tasks column (§4.3). */
export function addTaskColumn(ws: Worksheet, c: number, column: TaskColumn): void {
  const cell = ws.getCell(1, c);
  cell.value = column.header;
  cell.style = headerStyle(column.calc);
  if (column.calc) cell.note = CALC_NOTE;
  ws.getColumn(c).width = column.width;
  // Text, so Excel keeps "5,120" and "3-1" as typed instead of making a number or a date of them.
  if (column.field === 'predecessors') ws.getColumn(c).style = { ...ws.getColumn(c).style, numFmt: '@' };
  const rule = VALIDATION[column.field];
  if (rule) validationsOf(ws).add(`${columnLetter(c)}2:${columnLetter(c)}${VALIDATED_ROWS}`, rule);
}

export function addResourcesSheet(wb: Workbook): Worksheet {
  const ws = wb.addWorksheet(SHEETS.resources);
  addHeaderRow(ws, RESOURCE_HEADERS, [24, 14, 12]);
  return ws;
}

export function addHolidaysSheet(wb: Workbook, holidays: readonly Holiday[] = []): Worksheet {
  const ws = wb.addWorksheet(SHEETS.holidays);
  addHeaderRow(ws, HOLIDAY_HEADERS, [14, 40]);
  holidays.forEach((h, i) => {
    const date = ws.getCell(i + 2, 1);
    date.value = excelDate(h.date);
    date.numFmt = DATE_FORMAT;
    ws.getCell(i + 2, 2).value = h.description || null;
  });
  const note = ws.getCell(2, 4);
  note.value = HOLIDAYS_NOTE;
  note.font = { italic: true, color: { argb: 'FF64748B' } };
  return ws;
}

function addReadMeSheet(wb: Workbook): Worksheet {
  const ws = wb.addWorksheet(SHEETS.readMe);
  ws.getColumn(1).width = 110;
  const title = ws.getCell(1, 1);
  title.value = README_TITLE;
  title.font = { bold: true, size: 14 };
  README_LINES.forEach((line, i) => {
    const cell = ws.getCell(i + 3, 1);
    cell.value = line;
    cell.alignment = { wrapText: true, vertical: 'top' };
  });
  return ws;
}
