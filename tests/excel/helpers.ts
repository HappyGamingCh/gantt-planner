import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_NOW, sampleBytes, toArrayBuffer } from '../../scripts/fixtures';
import { computePlan } from '../../src/engine/compute';
import type { Plan, Task } from '../../src/engine/types';
import { loadWorkbook, newWorkbook, workbookBytes, type CellValue, type Workbook, type Worksheet } from '../../src/excel/exceljs';
import { readPlan, type ReadResult } from '../../src/excel/read';
import { findSheet, readTasksHeader, type TaskField } from '../../src/excel/schema';
import { createTemplate } from '../../src/excel/template';
import { writePlan } from '../../src/excel/write';

// Fixed "today" for defaults, and the save time written to Last Saved.
export const TODAY = '2026-10-30';
export const NOW = FIXTURE_NOW;

export const read = (wb: Workbook): ReadResult => readPlan(wb, TODAY);

/** Serialize and load again, as a file would be. */
export async function reload(wb: Workbook): Promise<Workbook> {
  return loadWorkbook(toArrayBuffer(await workbookBytes(wb)));
}

export async function sampleWorkbook(): Promise<Workbook> {
  return loadWorkbook(toArrayBuffer(await sampleBytes()));
}

export async function fixture(name: string): Promise<Workbook> {
  return loadWorkbook(toArrayBuffer(readFileSync(join(import.meta.dirname, '../fixtures', name))));
}

/** Save as the app does — write `r` (default: the plan as read) into `wb` — then open the result. */
export async function save(wb: Workbook, r: ReadResult = read(wb)): Promise<Workbook> {
  writePlan(wb, r.plan, computePlan(r.plan), r.layout, NOW);
  return reload(wb);
}

export const tasksSheet = (wb: Workbook): Worksheet => findSheet(wb, 'Tasks')!;

/** Cell of a Tasks column (found by header) in a sheet row. */
export function taskCell(wb: Workbook, row: number, field: TaskField) {
  const ws = tasksSheet(wb);
  return ws.getCell(row, readTasksHeader(ws).known.get(field)!);
}

/** The template with `rows` in its Tasks sheet; keys are header names. */
export function templateWith(rows: Record<string, CellValue>[]): Workbook {
  const wb = createTemplate();
  fill(tasksSheet(wb), rows);
  return wb;
}

/** A workbook with only a Tasks sheet: `headers` in row 1, then `rows`. */
export function bareTasks(headers: string[], rows: CellValue[][]): Workbook {
  const wb = newWorkbook();
  const ws = wb.addWorksheet('Tasks');
  ws.addRow(headers);
  for (const row of rows) ws.addRow(row);
  return wb;
}

function fill(ws: Worksheet, rows: Record<string, CellValue>[]) {
  const header = ws.getRow(1);
  const colOf = (name: string) => {
    for (let c = 1; c <= header.cellCount; c++) if (header.getCell(c).value === name) return c;
    throw new Error(`No column ${name}`);
  };
  rows.forEach((row, i) => {
    for (const [name, value] of Object.entries(row)) ws.getCell(i + 2, colOf(name)).value = value;
  });
}

/** Tasks without their Excel source rows, for comparing plan data. */
export const bare = (tasks: readonly Task[]) => tasks.map(({ source, ...task }) => task);
export const barePlan = (plan: Plan) => ({ ...plan, tasks: bare(plan.tasks) });
