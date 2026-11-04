// Writing the Tasks sheet (SPEC §4.8): one row per task in plan order, values only; unknown columns, styles, notes
// and row grouping travel with their task, and ranges that covered the task rows follow them.
import type { ComputeResult, ISODate, Task, TaskResult } from '../engine/types';
import { cellText, excelDate, isBlank, isDateFormat, isFormula, isPercentFormat, keepsTime, nameLines } from './cells';
import { clearNote, conditionalFormatsOf, mergesOf, validationsOf, type Cell, type CellValue, type Row, type Style, type Worksheet } from './exceljs';
import type { SourceRow, TasksLayout } from './readTasks';
import { COLUMN_OF, DATE_FORMAT, TASK_COLUMNS, columnLetter, defaultCellStyle, readTasksHeader, statusFill, type TaskColumn, type TaskField } from './schema';
import { addTaskColumn } from './template';
import { keepsUnparsed, writtenValue } from './writtenValues';

export function writeTasks(ws: Worksheet, tasks: readonly Task[], result: ComputeResult, layout: TasksLayout) {
  let oldLast = 1; // last row of the task block as it is now: ranges that covered the block follow it (fitTaskBlock)
  ws.eachRow((_, n) => {
    oldLast = n;
  });
  // A write into a merged cell lands in the merge's first cell, so tasks would overwrite each other: split the
  // merges below the header first (§4.8). Each row then gets its own value back.
  for (const m of mergesOf(ws)) if (m.bottom >= 2) ws.unMergeCells(m.top, m.left, m.bottom, m.right);
  const header = readTasksHeader(ws);
  // The plan has major tasks (§5.12): the Level column is needed, and Save shows the outline in Excel (§4.8).
  const outline = result.tasks.some((r) => r.level > 1);
  let last = header.lastCol;
  for (const column of TASK_COLUMNS) {
    if (header.known.has(column.field) || (column.field === 'level' && !outline)) continue;
    addTaskColumn(ws, ++last, column);
    header.known.set(column.field, last);
  }
  const extras = new Map(header.extras.map((e) => [e.key, e.col]));
  for (const key of new Set(tasks.flatMap((t) => Object.keys(t.extra)))) {
    if (extras.has(key)) continue;
    const cell = ws.getCell(1, ++last);
    cell.value = key;
    cell.font = { bold: true };
    ws.getColumn(last).width = 16;
    extras.set(key, last);
  }

  // Predecessors typed in Excel stay text: in a General cell Excel turns "5,120" into 5120 and "3-1" into a date.
  const predecessors = ws.getColumn(header.known.get('predecessors')!);
  if (!predecessors.style.numFmt) predecessors.style = { ...predecessors.style, numFmt: '@' };

  const results = new Map(result.tasks.map((r) => [r.id, r]));
  let level = 0; // a new task joins the row group of the task above it
  tasks.forEach((task, i) => {
    const r = results.get(task.id);
    if (!r) return;
    const row = ws.getRow(i + 2);
    writeTaskRow(row, task, r, header.known, extras, layout, outline);
    // With major tasks the row grouping is the outline, so Excel's +/− collapses each one (Excel goes 7 deep).
    level = outline ? Math.min(r.level - 1, 7) : ((task.source as SourceRow | undefined)?.outlineLevel ?? level);
    row.outlineLevel = level;
  });
  if (outline) ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

  // Clear rows left over from deleted tasks. (ExcelJS's spliceRows() can't remove the last rows of a sheet.)
  ws.eachRow((row, n) => {
    if (n <= tasks.length + 1) return;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.value = null;
      cell.style = {};
      clearNote(cell);
    });
    (row as { height?: number }).height = undefined;
    row.hidden = false;
    row.outlineLevel = 0;
  });
  fitTaskBlock(ws, oldLast, tasks.length + 1);
}

/**
 * Ranges that covered the whole block of task rows cover it again after a save, as Excel grows or shrinks a range
 * when rows are inserted or deleted inside it (§4.8): conditional formats, the print area, and (growing only) data
 * validation. The header autofilter widens to columns added on the right; one the user removed isn't added back.
 */
function fitTaskBlock(ws: Worksheet, oldLast: number, newLast: number) {
  const resize = (ref: string) => {
    const m = /^\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref);
    if (!m || Number(m[2]) > 2 || Number(m[4]) !== oldLast || oldLast < 2 || newLast < 2) return ref;
    return `${m[1]}${m[2]}:${m[3]}${newLast}`;
  };
  for (const cf of conditionalFormatsOf(ws)) cf.ref = cf.ref.split(/\s+/).map(resize).join(' ');
  if (ws.pageSetup.printArea) ws.pageSetup.printArea = ws.pageSetup.printArea.split('&&').map(resize).join('&&');

  const rules = validationsOf(ws).model;
  for (let c = 1; newLast > oldLast && c <= ws.columnCount; c++) {
    const rule = rules[`${columnLetter(c)}${oldLast}`];
    if (!rule || rule !== rules[`${columnLetter(c)}2`]) continue;
    for (let n = oldLast + 1; n <= newLast; n++) rules[`${columnLetter(c)}${n}`] ??= rule;
  }

  let right = 0;
  ws.getRow(1).eachCell((cell, c) => {
    if (!isBlank(cell.value)) right = c;
  });
  const filter = filterRange(ws.autoFilter);
  if (filter && filter.top === 1 && filter.right < right) {
    ws.autoFilter = `${columnLetter(filter.left)}${filter.top}:${columnLetter(right)}${filter.bottom}`;
  }
}

/** The autofilter's range, written as 'A1:R1' (a loaded file) or with from/to (the template). */
function filterRange(filter: Worksheet['autoFilter']): { top: number; left: number; bottom: number; right: number } | undefined {
  const point = (p: string | { row: number; column: number }) => {
    if (typeof p !== 'string') return p;
    const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(p);
    return m ? { row: Number(m[2]), column: columnNumber(m[1]) } : undefined;
  };
  const [from, to] = typeof filter === 'string' ? filter.split(':').map(point) : filter ? [point(filter.from), point(filter.to)] : [];
  return from && to ? { top: from.row, left: from.column, bottom: to.row, right: to.column } : undefined;
}

const columnNumber = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

function writeTaskRow(
  row: Row,
  task: Task,
  r: TaskResult,
  known: Map<TaskField, number>,
  extras: Map<string, number>,
  layout: TasksLayout,
  outline: boolean,
) {
  const source = task.source as SourceRow | undefined;
  // A task read from the file keeps its own cells' styles (a blank cell it had has none); only a new task copies the
  // first data row (§4.8).
  const styleAt = (c: number, column?: TaskColumn): Partial<Style> =>
    structuredClone((source ? source.styles[c] : layout.firstRow?.styles[c]) ?? defaultCellStyle(column));
  // Notes travel with their task; a note left at this address by another task goes.
  const noteAt = (cell: Cell, c: number) => {
    const note = source?.notes?.[c];
    if (note === undefined) clearNote(cell);
    else cell.note = structuredClone(note);
  };

  for (const [field, c] of known) {
    const column = COLUMN_OF[field];
    const original = source?.values[c] ?? null;
    const style = styleAt(c, column);
    const value = writtenValue(task, r, field);
    let out: CellValue;
    if (field === 'status') style.fill = statusFill(String(value));
    // §4.8 Outline in Excel: major tasks in bold, every name indented by its Level.
    if (field === 'name' && outline) {
      style.font = { ...style.font, bold: r.summary !== undefined };
      style.alignment = { ...style.alignment, indent: r.level - 1 };
    }
    if (field === 'predecessors' && (!style.numFmt || style.numFmt === 'General')) style.numFmt = '@'; // stays text in Excel
    // A Task cell with line breaks (Alt+Enter) keeps them while the name is unchanged: as it is if tidy, else tidied.
    const lines = field === 'name' ? nameLines(cellText(original), task.name) : undefined;
    const sameText = cellText(original) === value || (lines !== undefined && lines === cellText(original));
    if (!isFormula(original) && (keepsUnparsed(column, task, original, r.summary !== undefined) || (column.kind === 'text' && !column.calc && sameText))) {
      out = original;
    } else if (lines !== undefined) {
      out = lines;
    } else if (value === undefined || value === '') {
      out = null;
    } else if (column.kind === 'date') {
      // An input date with a time of day (a 19:00 night-shift start) stays while its day is unchanged.
      out = !column.calc && keepsTime(original, value as ISODate) ? original : excelDate(value as ISODate);
      if (!isDateFormat(style.numFmt)) style.numFmt = DATE_FORMAT;
    } else if (field === 'progress' && isPercentFormat(style.numFmt)) {
      out = (value as number) / 100;
    } else {
      out = value;
      // A number in a date-formatted cell would show as a date (a duration of 5 as 05-Jan-00): General shows it (§4.8).
      if (typeof out === 'number' && isDateFormat(style.numFmt)) style.numFmt = 'General';
    }
    const cell = row.getCell(c);
    cell.value = out;
    cell.style = style;
    noteAt(cell, c);
  }

  for (const [key, c] of extras) {
    const cell = row.getCell(c);
    cell.value = (task.extra[key] as CellValue | undefined) ?? null;
    cell.style = styleAt(c);
    noteAt(cell, c);
  }
  (row as { height?: number }).height = source?.height; // ExcelJS types height as required; undefined = default
  row.hidden = !layout.filtered && (source?.hidden ?? false); // rows an Excel filter hid come back with the filter gone
}
