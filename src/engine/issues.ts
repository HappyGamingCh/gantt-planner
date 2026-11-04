// Issue catalog (SPEC §5.11).
import type { Issue, IssueCode, QuickFix } from './types';

const CATALOG: Record<IssueCode, { severity: Issue['severity']; message: string }> = {
  E_DUP_ID: { severity: 'error', message: 'ID {id} is used more than once; row {n} got ID {new}' },
  E_CYCLE: { severity: 'error', message: 'Circular dependency: {ids}' },
  E_BAD_LINK: { severity: 'error', message: 'Task {id}: "{token}" is not valid predecessor notation' },
  E_UNSUPPORTED_LINK: { severity: 'error', message: 'Task {id}: FF/SF links are not supported yet' },
  E_MISSING_PRED: { severity: 'error', message: 'Task {id}: predecessor {pid} does not exist' },
  E_SELF_LINK: { severity: 'error', message: 'Task {id} cannot depend on itself' },
  W_DUP_LINK: { severity: 'warning', message: 'Task {id}: predecessor {pid} is listed more than once' },
  W_START_DRIVEN: { severity: 'info', message: 'Task {id}: start set by predecessors' },
  W_NONWORKDAY: { severity: 'info', message: 'Task {id}: start moved to next working day' },
  W_FINISH_RECALC: { severity: 'info', message: 'Task {id}: finish recalculated from duration' },
  W_NO_DURATION: { severity: 'warning', message: 'Task {id}: no duration, set to 1 day' },
  W_PROGRESS_NO_AS: { severity: 'warning', message: 'Task {id}: has progress but no actual start' },
  W_100_NO_AF: { severity: 'warning', message: 'Task {id}: 100% but no actual finish' },
  W_MS_NO_AF: { severity: 'warning', message: 'Task {id}: milestone has an actual start but no actual finish' },
  W_AF_NO_AS: { severity: 'warning', message: 'Task {id}: actual finish without actual start' },
  W_AF_BEFORE_AS: { severity: 'warning', message: 'Task {id}: actual finish is before actual start' },
  W_FUTURE_ACTUAL: { severity: 'warning', message: 'Task {id}: actual date is after the status date' },
  W_BAD_DATE: { severity: 'warning', message: 'Task {id}: "{text}" in {field} is not a date' },
  W_BAD_NUMBER: { severity: 'warning', message: 'Task {id}: "{text}" in {field} is not a valid number' },
  W_BAD_HOLIDAY: { severity: 'warning', message: 'Holidays row {n}: "{text}" is not a date' },
  W_UNSUPPORTED_CONTENT: {
    severity: 'warning',
    message: "This file contains {parts}; Gantt Planner can't keep them, so saving will remove them",
  },
  W_EXCEL_TABLES: {
    severity: 'warning',
    message: "This file has Excel tables ({names}); Gantt Planner can't keep them, so saving turns them into normal ranges. Formulas that use a table's name will show #REF!",
  },
  W_MERGED_CELLS: { severity: 'warning', message: 'Merged cells in Tasks ({ranges}) will be split when you save; each task keeps its own value' },
  W_EXCEL_FILTER: { severity: 'info', message: "The Tasks sheet is filtered in Excel; Gantt Planner can't keep Excel filters, so saving shows every task row" },
  W_PRED_NOT_TEXT: {
    severity: 'warning',
    message: 'Task {id}: Excel changed the Predecessors you typed into {text}. Retype them with a space after each comma (5, 120), or write a lead as 3FS-1',
  },
  W_PROGRESS_CLAMPED: { severity: 'warning', message: 'Task {id}: progress {v} adjusted to {c}' },
  W_FORMULA: { severity: 'info', message: 'Formulas in Tasks will be saved as values: {where}' },
  W_UNTITLED: { severity: 'warning', message: 'Row {n} has data but no task name' },
  W_NEW_RESOURCE: { severity: 'info', message: 'Added "{name}" to Resources' },
  W_NO_TASKS_SHEET: {
    severity: 'warning',
    message: 'No sheet named "Tasks": this file has {sheets}. Rename the sheet with your tasks to Tasks (headers in row 1) and open the file again',
  },
  E_NO_TASK_HEADER: { severity: 'error', message: 'Tasks sheet: row 1 has no "Task" header{hint}' },
  W_COLUMNS_NOT_FOUND: {
    severity: 'warning',
    message:
      'Tasks sheet: columns not found: {missing}. Kept as your own columns: {extras}. If one of them is meant to be a planner column, rename its header in Excel and open the file again',
  },
  W_HOLIDAYS_NO_HEADER: {
    severity: 'warning',
    message: 'Holidays sheet: no "Date" header in row 1; its dates ({n}) were not used, so they count as working days',
  },
  W_RESOURCES_NO_HEADER: {
    severity: 'warning',
    message:
      'Resources sheet: no "Name" header in row 1, so its types and colors were not read and Save leaves the sheet as it is (new assignees are not added). Rename the column with the names to "Name" in Excel and open the file again',
  },
  E_SUMMARY_LINK: { severity: 'error', message: 'Task {id}: {pid} is a major task; link to a task inside it' },
  W_SUMMARY_PREDS: { severity: 'warning', message: 'Major task {id}: its predecessors are not used; link the tasks inside it' },
  W_DATE_TOO_LARGE: {
    severity: 'warning',
    message:
      "Numbers too large for a date in {cells} (Excel shows #####); Gantt Planner can't keep them, so saving removes them. To keep a number, give its cell a number format in Excel and open the file again",
  },
};

/** Builds an issue from the catalog. `params` fill the `{name}` placeholders; `id` also becomes `taskId`. */
export function makeIssue(code: IssueCode, params: Record<string, string | number> = {}, fix?: QuickFix): Issue {
  const { severity, message } = CATALOG[code];
  const issue: Issue = {
    code,
    severity,
    message: message.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`)),
  };
  if (typeof params.id === 'number') issue.taskId = params.id;
  if (fix) issue.fix = fix;
  return issue;
}
