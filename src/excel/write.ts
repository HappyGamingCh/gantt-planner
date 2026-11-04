// Writing into the retained workbook (SPEC §4.8). Values only, never formulas; unknown columns travel with
// their task and unknown sheets are left alone. Mutates `wb`; the caller serializes it. The Tasks sheet is written
// in writeTasks.ts.
import { APP_VERSION, RESOURCE_PALETTE } from '../config';
import type { ComputeResult, Plan, Project, Resource } from '../engine/types';
import { cellText, cleanName, excelDate, isDateFormat, isFormula, isInvalidDate } from './cells';
import { tablesOf, type CellValue, type Workbook, type Worksheet } from './exceljs';
import type { TasksLayout } from './readTasks';
import {
  DATE_FORMAT,
  DATE_TIME_FORMAT,
  PROJECT_FIELDS,
  RESOURCE_HEADERS,
  SHEETS,
  findSheet,
  headerColumns,
  headerKey,
  headerStyle,
  resourcesWithoutName,
  type ProjectField,
} from './schema';
import { addHolidaysSheet, addProjectSheet, addResourcesSheet, addTasksSheet } from './template';
import { writeTasks } from './writeTasks';

export { calculatedChanges, keepsUnparsedText } from './writtenValues';

export function writePlan(wb: Workbook, plan: Plan, result: ComputeResult, layout: TasksLayout, now: Date): void {
  tablesToRanges(wb);
  const project = findSheet(wb, SHEETS.project) ?? addProjectSheet(wb);
  const tasks = findSheet(wb, SHEETS.tasks) ?? addTasksSheet(wb);
  const resources = findSheet(wb, SHEETS.resources) ?? addResourcesSheet(wb);
  if (!findSheet(wb, SHEETS.holidays)) addHolidaysSheet(wb);
  writeProject(project, plan.project, now);
  writeTasks(tasks, plan.tasks, result, layout);
  writeResources(resources, plan);
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

/** Appends assignees and app resources that the sheet doesn't list yet (§4.4). */
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
  const listed = new Set<string>();
  let last = 1;
  ws.eachRow((row, n) => {
    last = n;
    // The reader's key (cleanName): a name typed with a double or non-breaking space is already listed.
    const name = cleanName(cellText(row.findCell(cols.get('Name')!)?.value)).toLowerCase();
    if (n > 1 && name !== '') listed.add(name);
  });
  for (const resource of allResources(plan)) {
    const key = resource.name.toLowerCase();
    if (listed.has(key)) continue;
    const n = ++last;
    ws.getCell(n, cols.get('Name')!).value = resource.name;
    ws.getCell(n, cols.get('Type')!).value = resource.type ?? null;
    ws.getCell(n, cols.get('Color')!).value = resource.color ?? RESOURCE_PALETTE[listed.size % RESOURCE_PALETTE.length];
    listed.add(key);
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
