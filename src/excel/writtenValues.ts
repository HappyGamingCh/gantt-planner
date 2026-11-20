// What Save writes in each known Tasks column (SPEC §4.8), and which text it keeps as the file has it. Shared by the
// writer, the load report (calculated Changes) and the Problems list.
import { withHalf } from '../engine/schedule';
import type { Change, ComputeResult, Task, TaskResult } from '../engine/types';
import { cellText, isFormula, isNoon, parseDate, parseDuration, parseNumber } from './cells';
import type { CellValue } from './exceljs';
import type { SourceRow, TasksLayout } from './readTasks';
import { COLUMN_OF, type TaskColumn, type TaskField } from './schema';

/**
 * The value the app writes for a known column; ISO strings for date columns (with ` afternoon` / ` midday` for a half
 * day, written as 12:00, §4.8), undefined for blank.
 */
export function writtenValue(task: Task, r: TaskResult, field: TaskField): string | number | undefined {
  switch (field) {
    case 'id':
      return task.id;
    case 'level':
      return r.level;
    case 'name':
      return task.name;
    case 'assigned':
      return task.assigned.join(', ');
    case 'actualFinish':
      return r.summary ? r.summary.actualFinish : task.actualFinish;
    case 'remarks':
      return task.remarks;
    default:
      return resultValue(r, field);
  }
}

function resultValue(r: TaskResult, field: Exclude<TaskField, 'id' | 'level' | 'name' | 'assigned' | 'actualFinish' | 'remarks'>) {
  switch (field) {
    case 'predecessors':
      return r.predecessorsText;
    case 'plannedStart':
      return withHalf(r.plannedStart, r.plannedStartPM, 'afternoon');
    case 'plannedDuration':
      return r.plannedDuration;
    case 'plannedFinish':
      return withHalf(r.plannedFinish, r.plannedFinishMidday, 'midday');
    case 'progress':
      return r.progress;
    case 'actualStart':
      return r.actualStart;
    case 'actualDuration':
      return r.actualDuration;
    case 'successors':
      return r.successorsText;
    case 'status':
      return r.status;
    case 'forecastStart':
      return withHalf(r.forecastStart, r.forecastStartPM, 'afternoon');
    case 'forecastFinish':
      return withHalf(r.forecastFinish, r.forecastFinishMidday, 'midday');
    case 'variance':
      return r.variance;
    case 'critical':
      return r.critical ? 'Yes' : undefined;
  }
}

/** Input columns that a major task's row has calculated values in (§5.12). */
const CALCULATED_ON_SUMMARY: readonly TaskField[] = ['plannedStart', 'plannedDuration', 'progress', 'actualStart', 'actualFinish'];

/** Calculated-only columns; the engine records Changes for the other calculated values (§5.3). */
const CALCULATED_ONLY = ['actualDuration', 'successors', 'status', 'forecastStart', 'forecastFinish', 'variance', 'critical'] as const;

/** Changes for calculated-only columns: what the file says now vs what Save will write. */
export function calculatedChanges(tasks: readonly Task[], layout: TasksLayout, result: ComputeResult): Change[] {
  const changes: Change[] = [];
  const sources = new Map(tasks.map((t) => [t.id, t.source as SourceRow | undefined]));
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  for (const r of result.tasks) {
    const source = sources.get(r.id);
    const task = tasksById.get(r.id);
    // A major task's row also gets its roll-up in Planned Start/Duration, Progress and the actual dates (§5.12).
    const fields: readonly TaskField[] = r.summary ? [...CALCULATED_ONLY, ...CALCULATED_ON_SUMMARY] : CALCULATED_ONLY;
    for (const field of fields) {
      const column = COLUMN_OF[field];
      const c = layout.columns.get(field);
      const from = comparable(c === undefined ? null : (source?.values[c] ?? null), column);
      const value = task ? writtenValue(task, r, field) : undefined;
      const to = value === '' ? undefined : value;
      if (from !== to) {
        changes.push({ taskId: r.id, field: column.header, from, to, kind: from === undefined ? 'filled' : 'corrected', reason: 'Calculated' });
      }
    }
  }
  return changes;
}

/** The word a 12:00 time means in a date column (§4.7): a start in the afternoon, a finish at midday. */
const HALF_WORD: Partial<Record<TaskField, 'afternoon' | 'midday'>> = {
  plannedStart: 'afternoon',
  forecastStart: 'afternoon',
  plannedFinish: 'midday',
  forecastFinish: 'midday',
};

function comparable(value: CellValue, column: TaskColumn): string | number | undefined {
  const text = cellText(value).trim();
  if (text === '') return undefined;
  if (column.kind === 'date') {
    const date = parseDate(value).value;
    const word = HALF_WORD[column.field];
    return date === undefined ? text : word ? withHalf(date, isNoon(value), word) : date;
  }
  if (column.kind === 'number') return parseNumber(value).value ?? text;
  return text;
}

/**
 * Unparseable text in an input column, kept until the user gives the field a value (§4.8). Planned Start and
 * Duration count as unset while `task.unparsed` lists them: the values the app derives after each edit don't count.
 * On a major task (`summary`) those cells are calculated (§5.12), so they never keep text.
 */
export function keepsUnparsed(column: TaskColumn, task: Task, original: CellValue, summary = false): boolean {
  if (summary && CALCULATED_ON_SUMMARY.includes(column.field)) return false;
  switch (column.field) {
    case 'level':
      return (task.level === undefined || !!task.unparsed?.includes('level')) && parseNumber(original).bad;
    case 'plannedStart':
      return (task.plannedStart === undefined || !!task.unparsed?.includes('plannedStart')) && parseDate(original).bad;
    case 'actualStart':
    case 'actualFinish':
      return task[column.field] === undefined && parseDate(original).bad;
    case 'plannedDuration':
      return (task.plannedDuration === undefined || !!task.unparsed?.includes('plannedDuration')) && parseDuration(original).bad;
    case 'progress':
      return task.progress === 0 && parseNumber(original, true).bad;
    default:
      return false;
  }
}

/** Whether Save writes back the unparsed text this task's row has in `field`; the Problems list asks the same (§7.11). */
export function keepsUnparsedText(task: Task, field: TaskField, layout: TasksLayout): boolean {
  const c = layout.columns.get(field);
  const original = c === undefined ? null : ((task.source as SourceRow | undefined)?.values[c] ?? null);
  return !isFormula(original) && keepsUnparsed(COLUMN_OF[field], task, original);
}
