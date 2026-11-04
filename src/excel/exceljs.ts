// The only module that imports ExcelJS (CLAUDE.md). Node (Vitest, scripts) loads the package's Node build;
// the browser build resolves the same import to the prebuilt dist/exceljs.min.js via the package's "browser" field.
import ExcelJS from 'exceljs';
import type { Cell, DataValidation, Workbook, Worksheet } from 'exceljs';

export type { Cell, CellValue, DataValidation, Row, Style, Workbook, Worksheet } from 'exceljs';

/** A cell note: plain text or formatted (`cell.note` is undefined when the cell has none). */
export type CellNote = Cell['note'];

export function newWorkbook(): Workbook {
  return new ExcelJS.Workbook();
}

export async function loadWorkbook(data: ArrayBuffer): Promise<Workbook> {
  const wb = newWorkbook();
  await wb.xlsx.load(data);
  return wb;
}

export async function workbookBytes(wb: Workbook): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Worksheet data validations, keyed by cell address or range (present at runtime, missing from ExcelJS's typings). */
export function validationsOf(ws: Worksheet): {
  model: Record<string, DataValidation | undefined>;
  add(address: string, validation: DataValidation): void;
} {
  return (ws as unknown as { dataValidations: ReturnType<typeof validationsOf> }).dataValidations;
}

/** Conditional formats of a sheet; `ref` holds space-separated ranges (present at runtime, missing from the typings). */
export function conditionalFormatsOf(ws: Worksheet): { ref: string }[] {
  return (ws as unknown as { conditionalFormattings?: { ref: string }[] }).conditionalFormattings ?? [];
}

/** Merged ranges of a sheet, from the private index ExcelJS keeps by master cell. */
export function mergesOf(ws: Worksheet): { range: string; top: number; left: number; bottom: number; right: number }[] {
  return Object.values((ws as unknown as { _merges?: Record<string, ReturnType<typeof mergesOf>[number]> })._merges ?? {});
}

/** Excel tables (Format as Table) of a sheet. The typings declare getTables() as pairs; it returns tables. */
export function tablesOf(ws: Worksheet): { name: string; table: { autoFilterRef?: string } }[] {
  return ws.getTables() as unknown as ReturnType<typeof tablesOf>;
}

/** Removes a cell's note. Assigning `cell.note = undefined` would write an empty note box instead. */
export function clearNote(cell: Cell): void {
  (cell as unknown as { _comment?: unknown })._comment = undefined;
}
