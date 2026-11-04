// Reading the Tasks sheet (SPEC §4.3, §4.7, §5.3 steps 1–2): rows with data become tasks, IDs are checked, and every
// value that differs from the file becomes a Change. Never throws on cell content.
import { MAX_ID } from '../config';
import { makeIssue } from '../engine/issues';
import { normalizeLevels, outlineOf } from '../engine/outline';
import type { Change, Issue, Task } from '../engine/types';
import { cellText, cleanName, isBlank, isFormula, isPercentFormat, parseDate, parseDuration, parseNumber, plainValue, tidyLines } from './cells';
import type { CellNote, CellValue, Row, Style, Worksheet } from './exceljs';
import { BUDDHIST_ERA, formulaIssue, predecessorsNotText, quotedList, taskHeaderHint } from './readMessages';
import { COLUMN_OF, TASK_COLUMNS, readTasksHeader, type TaskField, type TasksHeader } from './schema';

/** The Excel row a task was read from (kept in `task.source`). The writer uses it to keep the row's formatting and
 * unparsed text (§4.8); it travels with the task through moves, renumbering and undo. */
export interface SourceRow {
  values: CellValue[]; // by column number
  styles: Partial<Style>[]; // by column number
  notes: (CellNote | undefined)[]; // by column number
  height?: number;
  hidden: boolean;
  outlineLevel: number; // row grouping
}

export interface TasksLayout {
  /** Known field → column number at load. */
  columns: Map<TaskField, number>;
  /** First data row at load: styles for new rows. */
  firstRow?: SourceRow;
  /** Excel saved the sheet filtered: rows were hidden by the filter, which ExcelJS drops, so Save shows them. */
  filtered?: boolean;
}

/** Layout of a workbook without task rows (template, new plan). */
export function emptyLayout(): TasksLayout {
  return { columns: new Map() };
}

/** Input columns that make a row a task (§4.3); ID alone doesn't. */
const DATA_FIELDS = TASK_COLUMNS.filter((c) => !c.calc && c.field !== 'id' && c.field !== 'level').map((c) => c.field);
/** Columns a major task's row has calculated values in (§5.12): the reader neither reports nor keeps text there. */
const CALCULATED_ON_SUMMARY: readonly string[] = ['plannedStart', 'plannedDuration', 'plannedFinish', 'progress', 'actualStart', 'actualFinish'];

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

const BAD_ID = `Not a whole number from 1 to ${MAX_ID.toLocaleString('en-US')}`;

/** Name of a task read from a row without one (`W_UNTITLED`). */
export const UNTITLED = '(Untitled)';

export function readTasks(
  ws: Worksheet | undefined,
  date1904: boolean,
  issues: Issue[],
  changes: Change[],
): { tasks: Task[]; layout: TasksLayout } {
  const layout = emptyLayout();
  if (!ws) return { tasks: [], layout };
  const header = readTasksHeader(ws);
  layout.columns = header.known;
  const valueOf = (row: Row, field: TaskField): CellValue => {
    const c = header.known.get(field);
    return c === undefined ? null : (row.findCell(c)?.value ?? null);
  };
  // The ID as captured: a heading merged from the ID cell across the Task cell has none (captureRow).
  const idOf = (source: SourceRow): CellValue => {
    const c = header.known.get('id');
    return c === undefined ? null : (source.values[c] ?? null);
  };

  // 1. Rows with data, and their IDs as written. Formula cells by column, blank rows included (W_FORMULA lists them).
  const rows: { n: number; source: SourceRow; id: number | 'bad' | undefined }[] = [];
  const formulaRows = new Map<number, number[]>();
  for (let n = 2; n <= ws.rowCount; n++) {
    const row = ws.findRow(n);
    if (!row) continue;
    row.eachCell((cell, c) => {
      if (!isFormula(cell.value)) return;
      const at = formulaRows.get(c);
      if (at) at.push(n);
      else formulaRows.set(c, [n]);
    });
    const blank =
      DATA_FIELDS.every((f) => isBlank(valueOf(row, f))) && header.extras.every((e) => isBlank(row.findCell(e.col)?.value ?? null));
    if (blank) continue;
    const source = captureRow(row, header.lastCol, header.known.get('name'));
    const id = parseNumber(idOf(source), false, date1904);
    // Capped, so the next free ID (max + 1) is always a new number (§4.7).
    const valid = id.value !== undefined && Number.isInteger(id.value) && id.value > 0 && id.value <= MAX_ID;
    rows.push({ n, source, id: valid ? id.value : id.bad || id.value !== undefined ? 'bad' : undefined });
  }

  // Headers not where the reader looks for them (§4.3): one issue for the sheet. The rows are still read, every value
  // kept, so Save loses nothing.
  const noName = !header.known.has('name') && rows.length > 0;
  if (noName) issues.push(makeIssue('E_NO_TASK_HEADER', { hint: taskHeaderHint(ws, header) }));
  // Level is optional: a file without it is all Level 1 (§4.3).
  const missing = TASK_COLUMNS.filter((c) => !c.calc && c.field !== 'level' && !header.known.has(c.field));
  if (rows.length > 0 && !noName && missing.length > 0 && header.extras.length > 0) {
    const extras = header.extras.map((e) => e.key);
    issues.push(makeIssue('W_COLUMNS_NOT_FOUND', { missing: quotedList(missing.map((c) => c.header)), extras: quotedList(extras) }));
  }

  // 2. IDs (§5.3 step 2): blank or invalid → next free ID; a repeated ID → the later row gets a new one.
  let maxId = rows.reduce((max, r) => (typeof r.id === 'number' ? Math.max(max, r.id) : max), 0);
  const seen = new Set<number>();
  const idByRow = new Map<number, number>();
  const tasks: Task[] = [];
  for (const { n, source, id: written } of rows) {
    let id: number;
    if (typeof written === 'number' && !seen.has(written)) {
      id = written;
    } else {
      id = ++maxId;
      const change = (from: unknown, kind: Change['kind'], reason: string) =>
        changes.push({ taskId: id, field: 'ID', from, to: id, kind, reason });
      if (typeof written === 'number') {
        const issue = makeIssue('E_DUP_ID', { id: written, n, new: id });
        issue.taskId = id;
        issues.push(issue);
        change(written, 'corrected', 'ID already used by an earlier row');
      } else if (written === 'bad') {
        change(cellText(idOf(source)).trim(), 'corrected', BAD_ID);
      } else {
        change(undefined, 'filled', 'Next free ID');
      }
    }
    seen.add(id);
    idByRow.set(n, id);
    tasks.push(readTask(id, n, source, header, issues, changes, { date1904, untitledWarning: !noName }));
  }
  layout.firstRow = rows[0]?.source;
  if (formulaRows.size > 0) issues.push(formulaIssue(ws, formulaRows, idByRow));
  return { tasks: withoutSummaryInputs(tasks, issues, changes), layout };
}

/**
 * A major task's date, duration, progress and actual cells hold the app's roll-up (§5.12), not input: what the reader
 * found there is not reported, changed or kept as unparsed text.
 */
function withoutSummaryInputs(tasks: Task[], issues: Issue[], changes: Change[]): Task[] {
  const { summaries } = outlineOf(tasks, normalizeLevels(tasks, []));
  if (summaries.size === 0) return tasks;
  const header = new Set(CALCULATED_ON_SUMMARY.map((f) => COLUMN_OF[f as TaskField].header));
  const calculated = (taskId: number | undefined, field: string | undefined) =>
    taskId !== undefined && summaries.has(taskId) && field !== undefined && (CALCULATED_ON_SUMMARY.includes(field) || header.has(field));
  for (let i = issues.length - 1; i >= 0; i--) if (calculated(issues[i]!.taskId, issues[i]!.field)) issues.splice(i, 1);
  for (let i = changes.length - 1; i >= 0; i--) if (calculated(changes[i]!.taskId, changes[i]!.field)) changes.splice(i, 1);
  return tasks.map((t) => {
    if (!summaries.has(t.id) || !t.unparsed) return t;
    const unparsed = t.unparsed.filter((f) => f === 'level');
    return { ...t, unparsed: unparsed.length > 0 ? unparsed : undefined };
  });
}

function readTask(
  id: number,
  n: number,
  source: SourceRow,
  header: TasksHeader,
  issues: Issue[],
  changes: Change[],
  options: { date1904: boolean; untitledWarning: boolean },
): Task {
  const { date1904 } = options;
  const valueOf = (field: TaskField): CellValue => {
    const c = header.known.get(field);
    return c === undefined ? null : (source.values[c] ?? null);
  };
  const change = (field: TaskField, from: unknown, to: unknown, kind: Change['kind'], reason: string) =>
    changes.push({ taskId: id, field: COLUMN_OF[field].header, from, to, kind, reason });
  const text = (field: TaskField) => cellText(valueOf(field));
  const bad = (code: 'W_BAD_DATE' | 'W_BAD_NUMBER', field: TaskField) =>
    issues.push({ ...makeIssue(code, { id, text: text(field).trim(), field: COLUMN_OF[field].header }), field });
  const date = (field: TaskField) => {
    const p = parseDate(valueOf(field), date1904);
    if (p.bad) bad('W_BAD_DATE', field);
    if (p.buddhist) change(field, text(field).trim(), p.value, 'corrected', BUDDHIST_ERA);
    return p.value;
  };
  /** Trimmed text; a Change records any tidying. */
  const tidy = (field: TaskField, clean: (s: string) => string) => {
    const raw = text(field);
    const value = clean(raw);
    if (value !== raw && value !== '') change(field, raw, value, 'corrected', 'Spaces tidied');
    return value;
  };

  // Level (§4.7): the engine normalizes it; text that isn't a number stays in the cell (§4.8).
  const levelValue = parseNumber(valueOf('level'), false, date1904);
  if (levelValue.bad) bad('W_BAD_NUMBER', 'level');

  // The app shows a name on one line; line breaks (Alt+Enter) stay in the file (§4.8), so the Change, if any, is the
  // tidying of each line: Save writes the tidied lines.
  const nameText = text('name');
  let name = cleanName(nameText);
  const saved = tidyLines(nameText);
  if (name !== '' && saved !== nameText) change('name', nameText, saved, 'corrected', 'Spaces tidied');
  if (name === '') {
    name = UNTITLED;
    if (options.untitledWarning) {
      const issue = makeIssue('W_UNTITLED', { n });
      issue.taskId = id;
      issues.push(issue);
    }
    change('name', undefined, name, 'filled', 'No task name');
  }

  const assignedText = text('assigned');
  const assigned = assignedText.split(/[,;]/).map(cleanName).filter(Boolean);
  if (assigned.join(', ') !== assignedText && assigned.length > 0) {
    // A line break inside a name joined two names; one next to a comma ("ACME,⏎NDT") was only a space.
    const joined = assignedText.split(/[,;]/).some((part) => /[\r\n]/.test(part.trim()));
    const reason = joined
      ? 'Line break read as a space; separate names with ","'
      : /[,;]/.test(assignedText)
        ? 'Names separated with ", "'
        : 'Spaces tidied';
    change('assigned', assignedText, assigned.join(', '), 'corrected', reason);
  }

  predecessorsNotText(id, valueOf('predecessors'), source.styles[header.known.get('predecessors') ?? 0]?.numFmt, issues);

  // Dates and numbers in column order, so issues read left to right.
  const plannedStart = date('plannedStart');
  const duration = parseDuration(valueOf('plannedDuration'), date1904);
  let plannedDuration: number | undefined;
  if (duration.bad) bad('W_BAD_NUMBER', 'plannedDuration');
  else if (duration.value !== undefined) {
    plannedDuration = Math.round(duration.value);
    const rounded = plannedDuration !== duration.value;
    if (duration.unitRemoved) {
      const reason = rounded ? 'Unit removed, rounded to a whole number' : 'Unit removed';
      change('plannedDuration', text('plannedDuration').trim(), plannedDuration, 'corrected', reason);
    } else if (rounded) change('plannedDuration', duration.value, plannedDuration, 'corrected', 'Rounded to a whole number');
  }

  const plannedFinish = date('plannedFinish');

  // Progress: a %-formatted fraction means percent (0.5 → 50); blank → 0. Rounding and clamping are the engine's (§5.5).
  const progressValue = valueOf('progress');
  const p = parseNumber(progressValue, true, date1904);
  let progress = 0;
  if (p.bad) bad('W_BAD_NUMBER', 'progress');
  else if (p.value !== undefined) {
    const progressCol = header.known.get('progress');
    const numFmt = progressCol === undefined ? undefined : source.styles[progressCol]?.numFmt;
    const percentCell = typeof plainValue(progressValue) === 'number' && isPercentFormat(numFmt);
    progress = percentCell && p.value <= 1 ? round6(p.value * 100) : p.value;
  }

  const actualStart = date('actualStart');
  const actualFinish = date('actualFinish');

  const extra: Record<string, unknown> = {};
  for (const { key, col } of header.extras) {
    const value = source.values[col] ?? null;
    if (!isBlank(value)) extra[key] = isFormula(value) ? plainValue(value) : value;
  }

  // Planned text Save keeps until the user sets the field, even after the app fills in derived values (§4.8).
  const unparsed = (['plannedStart', 'plannedDuration', 'level'] as const).filter((f) =>
    f === 'plannedStart' ? parseDate(valueOf(f), date1904).bad : f === 'plannedDuration' ? duration.bad : levelValue.bad,
  );

  return {
    id,
    name,
    assigned,
    predecessorsText: text('predecessors').trim(),
    plannedStart,
    plannedDuration,
    plannedFinish,
    progress,
    actualStart,
    actualFinish,
    remarks: tidy('remarks', (s) => s.trim()),
    extra,
    source,
    ...(levelValue.value !== undefined ? { level: levelValue.value } : {}),
    ...(unparsed.length > 0 ? { unparsed } : {}),
  };
}

/**
 * A merged cell other than the merge's first cell reads that cell's value only within its column: a value merged down
 * (an Assigned cell shared by several steps) belongs to every row, a heading merged across a row stays in its own cell.
 * A merge that starts left of the Task cell and covers it (Merge & Center over the whole row, typed in ID) is a heading
 * too: its value is read as the Task and its first cell as blank, so the heading becomes a task with the next free ID.
 */
function captureRow(row: Row, lastCol: number, nameCol: number | undefined): SourceRow {
  const values: CellValue[] = [];
  const styles: Partial<Style>[] = [];
  const notes: (CellNote | undefined)[] = [];
  const nameCell = nameCol === undefined ? undefined : row.findCell(nameCol);
  const heading = nameCell?.isMerged && nameCell.master.col < nameCell.col ? nameCell.master : undefined;
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.findCell(c);
    if (!cell) continue;
    values[c] =
      heading && (cell === heading || cell.master === heading)
        ? c === nameCol
          ? cell.value
          : null
        : cell.isMerged && cell.master !== cell && cell.master.col !== cell.col
          ? null
          : cell.value;
    styles[c] = cell.style;
    const note = cell.note as CellNote | undefined; // undefined when the cell has none
    if (note !== undefined) notes[c] = structuredClone(note);
  }
  return { values, styles, notes, height: row.height, hidden: row.hidden, outlineLevel: row.outlineLevel ?? 0 };
}
