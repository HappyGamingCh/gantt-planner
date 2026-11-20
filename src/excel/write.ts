// Writing into the retained workbook (SPEC §4.8). Values only, never formulas; unknown columns travel with
// their task and unknown sheets are left alone. Mutates `wb`; the caller serializes it. The Tasks sheet is written
// in writeTasks.ts.
import { APP_VERSION, RESOURCE_PALETTE } from '../config';
import type { ComputeResult, Holiday, Plan, Project, Resource } from '../engine/types';
import { cellText, cleanName, excelDate, isBlank, isDateFormat, isFormula, isInvalidDate, parseDate } from './cells';
import { tablesOf, type CellValue, type Row, type Workbook, type Worksheet } from './exceljs';
import type { ResourceSource } from './readSheets';
import type { TasksLayout } from './readTasks';
import {
  DATE_FORMAT,
  DATE_TIME_FORMAT,
  HOLIDAY_HEADERS,
  PROJECT_FIELDS,
  RESOURCE_HEADERS,
  SHEETS,
  findSheet,
  headerColumns,
  headerKey,
  headerStyle,
  holidaysWithoutDate,
  resourcesWithoutName,
  type ProjectField,
} from './schema';
import { addHolidaysSheet, addProjectSheet, addResourcesSheet, addTasksSheet } from './template';
import { formatWorkingDays } from './workingDays';
import { writeTasks } from './writeTasks';

export { calculatedChanges, keepsUnparsedText } from './writtenValues';

export function writePlan(wb: Workbook, plan: Plan, result: ComputeResult, layout: TasksLayout, now: Date): void {
  tablesToRanges(wb);
  const project = findSheet(wb, SHEETS.project) ?? addProjectSheet(wb);
  const tasks = findSheet(wb, SHEETS.tasks) ?? addTasksSheet(wb);
  const resources = findSheet(wb, SHEETS.resources) ?? addResourcesSheet(wb);
  const holidays = findSheet(wb, SHEETS.holidays) ?? addHolidaysSheet(wb);
  writeProject(project, plan.project, now);
  writeTasks(tasks, plan.tasks, result, layout);
  writeResources(resources, plan);
  writeHolidays(holidays, plan.holidays, wb.properties.date1904 === true);
  clearInvalidDates(wb);
  wb.modified = now;
}

/**
 * A number too large for a date in a date-formatted cell loads as an Invalid Date, which ExcelJS writes as NaN: a file
 * Excel can't open. Its number was lost at load; the reader warned (W_DATE_TOO_LARGE) and the first Save asked (§3.5),
 * so the cell is emptied. A formula keeps its formula, without the cached result.
 */
function clearInvalidDates(wb: Workbook) {
  for (const ws of wb.worksheets) {
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        const v = cell.value;
        if (isInvalidDate(v)) cell.value = isFormula(v) ? { ...(v as Extract<CellValue, { formula: string }>), result: undefined } : null;
      }),
    );
  }
}

/**
 * Excel tables become normal ranges (§3.5): ExcelJS 4.4 writes tables Excel can't open (headerRowCount="0", and on a
 * sheet with notes its parts in the wrong order). Cells keep their values and styles; a table's filter buttons move
 * to its sheet when the sheet has no filter of its own.
 */
function tablesToRanges(wb: Workbook) {
  for (const ws of wb.worksheets) {
    for (const { name, table } of tablesOf(ws)) {
      ws.removeTable(name);
      if (!ws.autoFilter && table.autoFilterRef) ws.autoFilter = table.autoFilterRef;
    }
  }
}

function writeProject(ws: Worksheet, project: Project, now: Date) {
  const rowOf = new Map<ProjectField, number>();
  let last = 0;
  ws.eachRow((row, n) => {
    last = n;
    const key = headerKey(cellText(row.findCell(1)?.value));
    const field = PROJECT_FIELDS.find((f) => headerKey(f) === key);
    if (field && !rowOf.has(field)) rowOf.set(field, n);
  });
  const values: Record<ProjectField, CellValue> = {
    'Project Name': project.name,
    Owner: project.owner || null,
    'Project Start': excelDate(project.projectStart),
    'Status Date': excelDate(project.statusDate),
    Mode: project.mode,
    // As read until the user sets the working days in the app (§4.8)
    'Working Days': project.workingDaysText ?? formatWorkingDays(project.workingDays),
    // Excel has no time zones: write the local wall-clock time.
    'Last Saved': new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds())),
    'App Version': APP_VERSION,
  };
  for (const field of PROJECT_FIELDS) {
    let n = rowOf.get(field);
    if (n === undefined) {
      n = ++last;
      ws.getCell(n, 1).value = field;
    }
    const cell = ws.getCell(n, 2);
    const style = structuredClone(cell.style ?? {});
    if (values[field] instanceof Date && !isDateFormat(style.numFmt)) style.numFmt = field === 'Last Saved' ? DATE_TIME_FORMAT : DATE_FORMAT;
    cell.value = values[field];
    cell.style = style;
  }
}

const TYPES = ['Person', 'Team', 'Contractor'] as const;
const typeOf = (value: CellValue | undefined) => TYPES.find((t) => t.toLowerCase() === cellText(value ?? null).trim().toLowerCase());
const colorOf = (value: CellValue | undefined) => {
  const text = cellText(value ?? null).trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(text) ? text : undefined;
};

/**
 * Resources (§4.4, §4.8): rows stay where they are. Each app resource keeps the row it was read from (renamed or
 * not) and only its changed cells are written; a row whose name the app no longer has (removed, or renamed) loses its
 * Name, Type and Color; resources and assignees the sheet doesn't list yet go below the last row.
 */
function writeResources(ws: Worksheet, plan: Plan) {
  if (resourcesWithoutName(ws)) return; // a renamed Name header: the reader warned, and the sheet is left as it is
  const cols = headerColumns(ws, RESOURCE_HEADERS);
  let lastCol = ws.getRow(1).cellCount;
  for (const header of RESOURCE_HEADERS) {
    if (cols.has(header)) continue;
    const cell = ws.getCell(1, ++lastCol);
    cell.value = header;
    cell.style = headerStyle(false);
    cols.set(header, lastCol);
  }
  const [nameCol, typeCol, colorCol] = RESOURCE_HEADERS.map((h) => cols.get(h)!) as [number, number, number];
  const app = allResources(plan);
  const appKeys = new Set(app.map((r) => r.name.toLowerCase()));

  // Rows with a name, by the reader's key (cleanName): a name typed with a double or non-breaking space is listed.
  const named = new Map<number, string>();
  let last = 1;
  ws.eachRow((row, n) => {
    last = n;
    const key = cleanName(cellText(row.findCell(nameCol)?.value ?? null)).toLowerCase();
    if (n > 1 && key !== '') named.set(n, key);
  });

  const rowOf = new Map<Resource, number>();
  const taken = new Set<number>();
  const keep = (r: Resource, n: number) => {
    rowOf.set(r, n);
    taken.add(n);
  };
  // A resource read from this sheet keeps its row: rows never move, so the row holds it under a name it had (as read,
  // or as renamed by an earlier save), or nothing (removed by an earlier save, then the removal undone). Only a row
  // that now holds another resource's name is not its own any more.
  for (const r of app) {
    const source = r.source as ResourceSource | undefined;
    if (!source || taken.has(source.row)) continue;
    const key = named.get(source.row);
    if (key === undefined || key === source.key || key === r.name.toLowerCase() || !appKeys.has(key)) keep(r, source.row);
  }
  // Any other resource: the first row not taken that has its name.
  for (const r of app) {
    if (rowOf.has(r)) continue;
    const found = [...named].find(([n, key]) => key === r.name.toLowerCase() && !taken.has(n));
    if (found) keep(r, found[0]);
  }

  for (const [n, key] of named) {
    if (taken.has(n) || appKeys.has(key)) continue; // written below, or a row repeating a listed name
    const row = ws.getRow(n);
    for (const c of [nameCol, typeCol, colorCol]) row.getCell(c).value = null;
    named.delete(n);
  }
  for (const [r, n] of rowOf) {
    const row = ws.getRow(n);
    if (cleanName(cellText(row.findCell(nameCol)?.value ?? null)) !== r.name) row.getCell(nameCol).value = r.name;
    if (typeOf(row.findCell(typeCol)?.value) !== r.type) row.getCell(typeCol).value = r.type ?? null;
    if (colorOf(row.findCell(colorCol)?.value) !== r.color?.toUpperCase()) row.getCell(colorCol).value = r.color ?? null;
  }

  let listed = new Set(named.values()).size;
  for (const r of app) {
    if (rowOf.has(r)) continue;
    const n = ++last;
    ws.getCell(n, nameCol).value = r.name;
    ws.getCell(n, typeCol).value = r.type ?? null;
    ws.getCell(n, colorCol).value = r.color ?? RESOURCE_PALETTE[listed % RESOURCE_PALETTE.length];
    listed++;
  }
}

type HolidayHeader = (typeof HOLIDAY_HEADERS)[number];

/**
 * Holidays (§4.5, §4.8): rows stay where they are. A row keeps its date while the app has it, and its Description is
 * written only when it changed; a date the app no longer has is emptied; new dates fill rows whose Date and
 * Description are blank, in date order, then go below the last row. Rows with an unreadable date are left alone.
 */
function writeHolidays(ws: Worksheet, holidays: readonly Holiday[], date1904: boolean) {
  if (holidaysWithoutDate(ws)) return; // the reader couldn't use this sheet (W_HOLIDAYS_NO_HEADER): left as it is
  const cols = headerColumns(ws, HOLIDAY_HEADERS);
  const column = (header: HolidayHeader) => {
    let c = cols.get(header);
    if (c === undefined) {
      c = Math.max(ws.getRow(1).cellCount, ...cols.values()) + 1;
      const cell = ws.getCell(1, c);
      cell.value = header;
      cell.style = headerStyle(false);
      cols.set(header, c);
    }
    return c;
  };
  const valueAt = (row: Row | undefined, header: HolidayHeader): CellValue => {
    const c = cols.get(header);
    return (c === undefined ? undefined : row?.findCell(c)?.value) ?? null;
  };

  let last = 1;
  ws.eachRow((_, n) => {
    last = n;
  });
  const wanted = [...holidays];
  const free: number[] = [];
  for (let n = 2; n <= last; n++) {
    const row = ws.findRow(n);
    const dateValue = valueAt(row, 'Date');
    const date = parseDate(dateValue, date1904).value;
    if (date === undefined) {
      if (isBlank(dateValue) && isBlank(valueAt(row, 'Description'))) free.push(n);
      continue;
    }
    const i = wanted.findIndex((h) => h.date === date);
    if (i < 0) {
      // A date the app no longer has: its own cells are emptied; the row's other cells stay.
      for (const c of cols.values()) ws.getCell(n, c).value = null;
      free.push(n);
      continue;
    }
    const holiday = wanted.splice(i, 1)[0]!;
    if (cellText(valueAt(row, 'Description')).trim() !== holiday.description) {
      ws.getCell(n, column('Description')).value = holiday.description || null;
    }
  }

  for (const holiday of wanted.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const n = free.shift() ?? ++last;
    const cell = ws.getCell(n, column('Date'));
    cell.value = excelDate(holiday.date);
    if (!isDateFormat(cell.numFmt)) cell.numFmt = DATE_FORMAT;
    if (holiday.description !== '') ws.getCell(n, column('Description')).value = holiday.description;
  }
}

/** App resources, then assignees not among them, by first appearance. */
function allResources(plan: Plan): Resource[] {
  const list = plan.resources.map((r) => ({ ...r, name: cleanName(r.name) }));
  const seen = new Set(list.map((r) => r.name.toLowerCase()));
  for (const task of plan.tasks) {
    for (const name of task.assigned) {
      const key = cleanName(name).toLowerCase();
      if (key !== '' && !seen.has(key)) {
        seen.add(key);
        list.push({ name: cleanName(name) });
      }
    }
  }
  return list;
}
