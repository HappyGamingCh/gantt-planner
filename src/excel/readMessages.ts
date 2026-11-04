// Wording of the reader's issues and Changes (SPEC §4.7, §5.11) where it is built from the sheet: header hints,
// formula locations, Predecessors cells Excel already converted.
import { makeIssue } from '../engine/issues';
import type { Issue } from '../engine/types';
import { cellText, plainValue } from './cells';
import type { CellValue, Worksheet } from './exceljs';
import { columnLetter, fieldOfHeader, type TasksHeader } from './schema';

/** Change reason for a Buddhist-era year read as its Western year (§4.7). */
export const BUDDHIST_ERA = 'Buddhist-era year converted';

/** `"A", "B", "C" and 2 more`. */
export const quotedList = (items: readonly string[], max = 5) =>
  items.slice(0, max).map((s) => `"${s}"`).join(', ') + (items.length > max ? ` and ${items.length - max} more` : '');

/** Where the Task header may be: a row just below row 1 that has one, else what row 1 holds. */
export function taskHeaderHint(ws: Worksheet, header: TasksHeader): string {
  for (let n = 2; n <= Math.min(10, ws.rowCount); n++) {
    let found = false;
    ws.findRow(n)?.eachCell((cell) => {
      if (fieldOfHeader(cellText(cell.value)) === 'name') found = true;
    });
    if (found) return `; the headers seem to be in row ${n}. Delete the rows above them in Excel and open the file again`;
  }
  const texts: string[] = [];
  for (let c = 1; c <= header.lastCol; c++) {
    const text = cellText(ws.getRow(1).findCell(c)?.value).replace(/\s+/g, ' ').trim();
    if (text !== '') texts.push(text);
  }
  return texts.length > 0
    ? `; it has ${quotedList(texts)}. Rename the column with the task names to "Task" in Excel and open the file again`
    : '. Put the column headers in row 1 and open the file again';
}

/** W_FORMULA naming each column's header and cells, e.g. `Planned Duration F2:F4, F151`; it points to the task when
 * every formula is in one task's row (§4.7). */
export function formulaIssue(ws: Worksheet, formulaRows: Map<number, number[]>, idByRow: Map<number, number>): Issue {
  const header = ws.getRow(1);
  const cols = [...formulaRows].sort(([a], [b]) => a - b);
  const parts = cols.slice(0, 3).map(([c, rows]) => {
    const name = cellText(header.findCell(c)?.value).replace(/\s+/g, ' ').trim() || `Column ${columnLetter(c)}`;
    return `${name} ${cellRanges(columnLetter(c), rows)}`;
  });
  if (cols.length > 3) parts.push(`and ${cols.length - 3} more columns`);
  const issue = makeIssue('W_FORMULA', { where: parts.join(', ') });
  const ids = new Set(cols.flatMap(([, rows]) => rows.map((n) => idByRow.get(n))));
  const [only] = ids;
  if (ids.size === 1 && only !== undefined) issue.taskId = only; // e.g. a "Total" row: the Problems list jumps to it
  return issue;
}

/** Ascending row numbers → Excel ranges: [2, 3, 4, 151] → `F2:F4, F151`; after 3 ranges, `…`. */
function cellRanges(letter: string, rows: readonly number[]): string {
  const runs: [number, number][] = [];
  for (const n of rows) {
    const last = runs.at(-1);
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  const text = runs.slice(0, 3).map(([a, b]) => (a === b ? `${letter}${a}` : `${letter}${a}:${letter}${b}`));
  return text.join(', ') + (runs.length > 3 ? ', …' : '');
}

/**
 * W_PRED_NOT_TEXT: in a General cell Excel turns `5,120` into the number 5120 (shown 5,120) and `3-1` into a date.
 * The cell is still written back as it is; only the user can say which links they meant.
 */
export function predecessorsNotText(id: number, value: CellValue, numFmt: string | undefined, issues: Issue[]) {
  const v = plainValue(value);
  if (v instanceof Date) issues.push(makeIssue('W_PRED_NOT_TEXT', { id, text: `the date ${cellText(v)}` }));
  else if (typeof v === 'number' && v >= 1000 && !!numFmt?.includes(',')) {
    issues.push(makeIssue('W_PRED_NOT_TEXT', { id, text: `the number ${v.toLocaleString('en-US')}` }));
  }
}
