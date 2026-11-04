// Test fixtures (SPEC §13), shared by scripts/make-sample.ts and the Excel tests.
import { loadWorkbook, workbookBytes, type CellValue, type Workbook } from '../src/excel/exceljs';
import { findSheet, readTasksHeader, type TaskField } from '../src/excel/schema';
import { buildSampleWorkbook } from '../src/sample/sampleWorkbook';

/** Fixed save time, so generated files carry the same Last Saved. */
export const FIXTURE_NOW = new Date(2026, 8, 30, 17, 0);

/** The sample as a user would receive it: built, saved and opened again. */
export async function sampleBytes(): Promise<Uint8Array> {
  return workbookBytes(buildSampleWorkbook(FIXTURE_NOW));
}

/**
 * The sample with the mistakes people make in Excel: blank IDs, a duplicate ID, invalid notation, an FF link,
 * a cycle, a formula, text dates, a %-formatted progress cell, a 100% task without Actual Finish, a bad date,
 * a bad number, a blank row, a row with only a remark, a bad holiday, plus an extra column and an extra sheet.
 */
export async function buildMessyWorkbook(): Promise<Workbook> {
  const wb = await loadWorkbook(toArrayBuffer(await sampleBytes()));
  const ws = findSheet(wb, 'Tasks')!;
  const { known, extras } = readTasksHeader(ws);
  const area = extras.find((e) => e.key === 'Area')!.col;
  // Sample task N sits in row N + 1.
  const set = (taskId: number, field: TaskField, value: CellValue) => {
    ws.getCell(taskId + 1, known.get(field)!).value = value;
  };

  set(8, 'id', null);
  set(9, 'id', null);
  set(12, 'id', 11);
  set(13, 'predecessors', '12, abc');
  set(22, 'predecessors', '20FF');
  set(21, 'predecessors', '20, 23');
  set(9, 'plannedDuration', { formula: '1+1', result: 2 });
  set(6, 'actualStart', '30/9/2026');
  set(6, 'actualFinish', '30-Sep-26');
  set(16, 'progress', 0.5);
  const progress = ws.getCell(17, known.get('progress')!);
  progress.style = { ...progress.style, numFmt: '0%' }; // a new style object: ExcelJS shares them between cells
  set(18, 'progress', 100);
  set(17, 'actualStart', 'next week');
  set(19, 'plannedDuration', 'two');
  // Row 27 stays blank; row 28 has only a remark and an Area.
  ws.getCell(28, known.get('remarks')!).value = 'Check scaffold permit';
  ws.getCell(28, area).value = 'Close out';

  const holidays = findSheet(wb, 'Holidays')!;
  holidays.getCell(4, 1).value = 'TBC';
  holidays.getCell(4, 2).value = 'Company day';

  const notes = wb.addWorksheet('Site notes');
  notes.getCell('A1').value = 'Permit';
  notes.getCell('B1').value = 'Owner';
  notes.getRow(1).font = { bold: true };
  notes.getCell('A2').value = 'Hot work';
  notes.getCell('B2').value = 'Safety';
  notes.getColumn(1).width = 24;
  return wb;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
