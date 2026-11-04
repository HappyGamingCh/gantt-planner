// Reading a plan workbook (SPEC §4.7, §5.3 steps 1–2). Never throws on cell content: problems become
// issues, and every value that differs from the file becomes a Change. Tasks are read in readTasks.ts, the other
// sheets in readSheets.ts.
import { makeIssue } from '../engine/issues';
import type { Change, ISODate, Issue, Plan } from '../engine/types';
import { isInvalidDate } from './cells';
import { mergesOf, tablesOf, type Workbook, type Worksheet } from './exceljs';
import { quotedList } from './readMessages';
import { readHolidays, readProject, readResources } from './readSheets';
import { readTasks, type TasksLayout } from './readTasks';
import { SHEETS, findSheet } from './schema';

export { UNTITLED, emptyLayout, type SourceRow, type TasksLayout } from './readTasks';

export interface ReadResult {
  plan: Plan;
  layout: TasksLayout;
  issues: Issue[];
  changes: Change[];
  /** What Save converts rather than keeps (Excel tables, merged cells in Tasks): asked about before the first Save (§3.5). */
  converted: string[];
}

/**
 * `today` (local date) fills a blank Status Date and, failing anything better, Project Start. `filteredSheets`: sheets
 * Excel saved with a filter applied (scanFile).
 */
export function readPlan(wb: Workbook, today: ISODate, filteredSheets: readonly string[] = []): ReadResult {
  const issues: Issue[] = [];
  const changes: Change[] = [];
  const date1904 = wb.properties.date1904 === true; // old Mac workbooks count serial numbers from 1904
  const tasksSheet = findSheet(wb, SHEETS.tasks);
  if (!tasksSheet) {
    const sheets = wb.worksheets.map((ws) => `"${ws.name}"`);
    issues.push(makeIssue('W_NO_TASKS_SHEET', { sheets: sheets.length > 0 ? sheets.join(', ') : 'no sheets' }));
  }
  const { tasks, layout } = readTasks(tasksSheet, date1904, issues, changes);
  const project = readProject(findSheet(wb, SHEETS.project), tasks, today, date1904, changes);
  const resources = readResources(findSheet(wb, SHEETS.resources), issues);
  const holidays = readHolidays(findSheet(wb, SHEETS.holidays), date1904, issues);
  const converted = convertedOnSave(wb, tasksSheet, filteredSheets, layout, issues);
  return { plan: { project, tasks, resources, holidays }, layout, issues, changes, converted };
}

/**
 * Sheet features Save can't keep as they are (§3.5, §4.8): Excel tables become normal ranges, merged cells in Tasks
 * are split, rows an Excel filter hid on Tasks are shown, and numbers too large for a date are emptied. Returns the
 * labels for the confirm before the first Save.
 */
function convertedOnSave(
  wb: Workbook,
  tasksSheet: Worksheet | undefined,
  filteredSheets: readonly string[],
  layout: TasksLayout,
  issues: Issue[],
): string[] {
  const converted: string[] = [];
  const tables = wb.worksheets.flatMap((ws) => tablesOf(ws).map((t) => t.name));
  if (tables.length > 0) {
    issues.push(makeIssue('W_EXCEL_TABLES', { names: quotedList(tables, 3) }));
    converted.push('Excel tables (their cells stay, as normal ranges)');
  }
  const merges = tasksSheet ? mergesOf(tasksSheet).filter((m) => m.bottom >= 2) : [];
  if (merges.length > 0) {
    const ranges = merges.slice(0, 3).map((m) => m.range);
    issues.push(makeIssue('W_MERGED_CELLS', { ranges: ranges.join(', ') + (merges.length > 3 ? ', …' : '') }));
    converted.push('merged cells in Tasks (each task keeps its value)');
  }
  if (tasksSheet && filteredSheets.some((name) => name.toLowerCase() === tasksSheet.name.toLowerCase())) {
    layout.filtered = true;
    issues.push(makeIssue('W_EXCEL_FILTER'));
  }
  const tooLarge = invalidDateCells(wb);
  if (tooLarge.length > 0) {
    const cells = tooLarge.slice(0, 3).join(', ') + (tooLarge.length > 3 ? ', …' : '');
    issues.push(makeIssue('W_DATE_TOO_LARGE', { cells }));
    converted.push(`numbers too large for a date (${cells})`);
  }
  return converted;
}

/**
 * Cells in any sheet that ExcelJS loaded as an Invalid Date (a 10-digit number with a date format), as `Tasks!I2`.
 * The number is lost already, and written back it would make a file Excel can't open: Save empties the cell (§4.8).
 */
function invalidDateCells(wb: Workbook): string[] {
  const cells: string[] = [];
  for (const ws of wb.worksheets) {
    const sheet = /^[\p{L}\p{M}\p{N}_.]+$/u.test(ws.name) ? ws.name : `'${ws.name.replace(/'/g, "''")}'`;
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        if (isInvalidDate(cell.value)) cells.push(`${sheet}!${cell.address}`);
      }),
    );
  }
  return cells;
}
