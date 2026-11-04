// Workbook schema (SPEC §4): sheet names, Tasks columns with aliases, Project fields, header styles.
// Hex colours are allowed here: they style the Excel file, not the app (CLAUDE.md).
import type { Style, Workbook, Worksheet } from './exceljs';
import { cellText, isBlank, isFormula } from './cells';

export const SHEETS = {
  project: 'Project',
  tasks: 'Tasks',
  resources: 'Resources',
  holidays: 'Holidays',
  readMe: 'Read Me',
} as const;

/** Sheet names match case-insensitively (§4.1). */
export function findSheet(wb: Workbook, name: string): Worksheet | undefined {
  const key = name.toLowerCase();
  return wb.worksheets.find((ws) => ws.name.toLowerCase() === key);
}

/** Headers match case- and whitespace-insensitively (§4.3). */
export function headerKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

export type TaskField =
  | 'id'
  | 'level'
  | 'name'
  | 'assigned'
  | 'predecessors'
  | 'plannedStart'
  | 'plannedDuration'
  | 'plannedFinish'
  | 'progress'
  | 'actualStart'
  | 'actualFinish'
  | 'actualDuration'
  | 'successors'
  | 'status'
  | 'forecastStart'
  | 'forecastFinish'
  | 'variance'
  | 'critical'
  | 'remarks';

export interface TaskColumn {
  field: TaskField;
  header: string;
  aliases: string[];
  /** Grey header: calculated by the app and overwritten on save. */
  calc: boolean;
  kind: 'id' | 'text' | 'date' | 'number';
  width: number;
}

const col = (field: TaskField, header: string, kind: TaskColumn['kind'], width: number, calc = false, aliases: string[] = []) =>
  ({ field, header, aliases, calc, kind, width }) satisfies TaskColumn;

/** §4.3, in template order. */
export const TASK_COLUMNS: readonly TaskColumn[] = [
  col('id', 'ID', 'id', 6, false, ['Step', 'Step No', 'Step Number', 'No', '#']),
  col('level', 'Level', 'number', 7, false, ['Outline Level']),
  col('name', 'Task', 'text', 40, false, ['Task Name', 'Name']),
  col('assigned', 'Assigned', 'text', 22, false, ['Assigned To', 'Resource', 'Resources', 'PIC']),
  col('predecessors', 'Predecessors', 'text', 14, false, ['Predecessor', 'Pred']),
  col('plannedStart', 'Planned Start', 'date', 12, false, ['Start', 'Plan Start']),
  col('plannedDuration', 'Planned Duration', 'number', 10, false, ['Duration', 'Plan Duration']),
  col('plannedFinish', 'Planned Finish', 'date', 12, true, ['Finish', 'Plan Finish']),
  col('progress', 'Progress (%)', 'number', 10, false, ['Progress', '% Complete', '%Complete']),
  col('actualStart', 'Actual Start', 'date', 12),
  col('actualFinish', 'Actual Finish', 'date', 12),
  col('actualDuration', 'Actual Duration', 'number', 10, true),
  col('successors', 'Successors', 'text', 14, true, ['Successor']),
  col('status', 'Status', 'text', 13, true),
  col('forecastStart', 'Forecast Start', 'date', 12, true),
  col('forecastFinish', 'Forecast Finish', 'date', 12, true),
  col('variance', 'Variance (d)', 'number', 10, true, ['Variance']),
  col('critical', 'Critical', 'text', 10, true),
  col('remarks', 'Remarks', 'text', 40, false, ['Remark', 'Notes', 'Comment', 'Comments']),
];

export const COLUMN_OF = Object.fromEntries(TASK_COLUMNS.map((c) => [c.field, c])) as Record<TaskField, TaskColumn>;

const FIELD_BY_HEADER = new Map<string, TaskField>(
  TASK_COLUMNS.flatMap((c) => [c.header, ...c.aliases].map((h) => [headerKey(h), c.field] as const)),
);

/** The Tasks field a header names (header or alias), if any. */
export function fieldOfHeader(text: string): TaskField | undefined {
  return FIELD_BY_HEADER.get(headerKey(text));
}

export interface TasksHeader {
  /** Known field → column number. The leftmost match wins; a repeated header becomes a user column. */
  known: Map<TaskField, number>;
  /** User columns, keyed as in `task.extra`. */
  extras: { key: string; col: number }[];
  lastCol: number;
}

/** Reads row 1 of the Tasks sheet. Reader and writer both use it, so `extra` keys map back to the same columns. */
export function readTasksHeader(ws: Worksheet): TasksHeader {
  const known = new Map<TaskField, number>();
  const extras: TasksHeader['extras'] = [];
  const used = new Set<string>();
  const row = ws.getRow(1);
  const lastCol = lastUsedColumn(ws);
  for (let c = 1; c <= lastCol; c++) {
    const text = cellText(row.findCell(c)?.value).replace(/\s+/g, ' ').trim();
    const field = FIELD_BY_HEADER.get(headerKey(text));
    if (field && !known.has(field)) {
      known.set(field, c);
      continue;
    }
    let key = text === '' ? `Column ${columnLetter(c)}` : text;
    if (used.has(key.toLowerCase()) || FIELD_BY_HEADER.has(headerKey(key))) key = `${key} (${columnLetter(c)})`;
    used.add(key.toLowerCase());
    extras.push({ key, col: c });
  }
  return { known, extras, lastCol };
}

/**
 * The rightmost column with a header, a value, a formula or a note in some row (a note travels with its task). A cell
 * with only formatting doesn't count: one styled cell in column XFD would otherwise make every empty column a user
 * column, and each Save write them all. Searches each row from its right end, without creating cells.
 */
function lastUsedColumn(ws: Worksheet): number {
  let last = 0;
  for (let n = 1; n <= ws.rowCount; n++) {
    const row = ws.findRow(n);
    for (let c = row?.cellCount ?? 0; c > last; c--) {
      const cell = row?.findCell(c);
      if (cell && (!isBlank(cell.value) || isFormula(cell.value) || cell.note !== undefined)) last = c;
    }
  }
  return last;
}

export function columnLetter(n: number): string {
  let s = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

/** Column number of each header (case/space-insensitive) in row 1 of a small sheet. */
export function headerColumns(ws: Worksheet, headers: readonly string[]): Map<string, number> {
  const result = new Map<string, number>();
  const row = ws.getRow(1);
  for (let c = 1; c <= row.cellCount; c++) {
    const key = headerKey(cellText(row.findCell(c)?.value));
    const header = headers.find((h) => headerKey(h) === key);
    if (header && !result.has(header)) result.set(header, c);
  }
  return result;
}

export const PROJECT_FIELDS = ['Project Name', 'Owner', 'Project Start', 'Status Date', 'Mode', 'Last Saved', 'App Version'] as const;
export type ProjectField = (typeof PROJECT_FIELDS)[number];
export const RESOURCE_HEADERS = ['Name', 'Type', 'Color'] as const;
export const HOLIDAY_HEADERS = ['Date', 'Description'] as const;

/**
 * A Resources sheet with content but no `Name` header in row 1 (a renamed header): the reader warns
 * (W_RESOURCES_NO_HEADER) and Save leaves the sheet as it is, so new rows never mix into the user's columns (§4.4).
 */
export function resourcesWithoutName(ws: Worksheet): boolean {
  if (headerColumns(ws, RESOURCE_HEADERS).has('Name')) return false;
  let data = false;
  ws.eachRow((row, n) =>
    row.eachCell((cell) => {
      const text = cellText(cell.value).trim();
      if (text !== '' && (n > 1 || !RESOURCE_HEADERS.some((h) => headerKey(h) === headerKey(text)))) data = true;
    }),
  );
  return data;
}

export const DATE_FORMAT = 'dd-mmm-yy';
export const DATE_TIME_FORMAT = 'dd-mmm-yy hh:mm';
export const CALC_NOTE = 'Calculated by Gantt Planner — edits here are overwritten';

const argb = (hex: string) => ({ argb: `FF${hex}` });
const solid = (hex: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: argb(hex) });

/** §4.3 header styling: dark for input columns, grey italic for calculated ones. */
export function headerStyle(calc: boolean): Partial<Style> {
  return {
    font: calc ? { italic: true, color: argb('475569') } : { bold: true, color: argb('FFFFFF') },
    fill: solid(calc ? 'E2E8F0' : '1E293B'),
    alignment: { vertical: 'middle', wrapText: true },
  };
}

/** Style of a data cell in a new row when the sheet has no data row to copy from. */
export function defaultCellStyle(column: TaskColumn | undefined): Partial<Style> {
  const style: Partial<Style> = {};
  if (column?.calc) style.font = { color: argb('64748B') };
  if (column?.kind === 'date') style.numFmt = DATE_FORMAT;
  return style;
}

/** §4.8 Status cell fill; Not Started has none. */
export function statusFill(status: string): Style['fill'] {
  switch (status) {
    case 'Completed':
      return solid('DCFCE7');
    case 'In Progress':
      return solid('DBEAFE');
    case 'Late':
      return solid('FEE2E2');
    default:
      return { type: 'pattern', pattern: 'none' };
  }
}
