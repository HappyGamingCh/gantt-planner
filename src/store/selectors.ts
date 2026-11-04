// Derived data for the views. Pure functions of the plan and the compute result.
import { RESOURCE_PALETTE } from '../config';
import { outlineOf } from '../engine/outline';
import type { ComputeResult, Issue, IssueCode, Plan, Resource, Task, TaskResult } from '../engine/types';
import { UNTITLED, type TasksLayout } from '../excel/read';
import { keepsUnparsedText } from '../excel/write';
import type { Filters, ReadIssue, State } from './store';

export interface Row {
  task: Task;
  r: TaskResult;
}

/** Tasks in row order with their computed values. */
export function rowsOf(plan: Plan, result: ComputeResult): Row[] {
  const byId = new Map(result.tasks.map((r) => [r.id, r]));
  return plan.tasks.flatMap((task) => {
    const r = byId.get(task.id);
    return r ? [{ task, r }] : [];
  });
}

/** How assignee names are matched and filtered: trimmed, any case. */
export const assigneeKey = (name: string) => name.trim().toLowerCase();
const key = assigneeKey;

/** Resources, then assignees missing from them, by first appearance (the order Save appends them in). */
function allAssignees(plan: Plan): Resource[] {
  const list = [...plan.resources];
  const seen = new Set(list.map((r) => key(r.name)));
  for (const task of plan.tasks) {
    for (const name of task.assigned) {
      if (key(name) !== '' && !seen.has(key(name))) {
        seen.add(key(name));
        list.push({ name: name.trim() });
      }
    }
  }
  return list;
}

export interface AssigneeInfo {
  type?: Resource['type'];
  color: string;
}

/** Type and colour per assignee (lower-case name): the resource's own colour, else the palette by position (§7.2). */
export function assigneeInfo(plan: Plan): Map<string, AssigneeInfo> {
  return new Map(
    allAssignees(plan).map((r, i) => [key(r.name), { type: r.type, color: r.color ?? RESOURCE_PALETTE[i % RESOURCE_PALETTE.length]! }]),
  );
}

/** Distinct assignees named on tasks (Plan-mode KPI). */
export function assigneeCount(plan: Plan): number {
  return new Set(plan.tasks.flatMap((t) => t.assigned.map(key)).filter(Boolean)).size;
}

const SEVERITY = { error: 0, warning: 1, info: 2 } as const;

/** Search and filter (§7.6): text in the name, an assignee or the ID (`12` or `#12`); any chosen assignee; any chosen status. */
export function matches(row: Row, filters: Filters): boolean {
  return matchesFilters(row, filters) && (filters.text.trim() === '' || matchesText(row, filters));
}

/** The Filter's status and assignee choices. */
function matchesFilters({ task, r }: Row, filters: Filters): boolean {
  if (filters.statuses.length > 0 && !filters.statuses.includes(r.status)) return false;
  return filters.assignees.length === 0 || task.assigned.some((a) => filters.assignees.includes(key(a)));
}

/** The search text, which must not be blank. */
function matchesText({ task }: Row, filters: Filters): boolean {
  const q = filters.text.trim().toLowerCase();
  const id = q.replace(/^#\s*/, '');
  return q !== '' && (String(task.id) === id || task.name.toLowerCase().includes(q) || task.assigned.some((a) => a.toLowerCase().includes(q)));
}

export const isFiltering = (f: Filters) => f.text.trim() !== '' || f.assignees.length > 0 || f.statuses.length > 0;

/**
 * Rows the grid and Gantt show (§7.6, §7.7): those that match the search and filters, and the pinned ones. With major
 * tasks (§5.12) a shown task brings its major tasks along, a major task whose name matches the search counts for all
 * its tasks, and the rows of a collapsed major task are hidden.
 */
export function shownRows(rows: readonly Row[], filters: Filters, pinned: readonly number[], collapsed: readonly number[] = []): Row[] {
  if (!rows.some((row) => row.r.level > 1)) return rows.filter((row) => pinned.includes(row.task.id) || matches(row, filters));
  const { parentOf } = outlineOf(
    rows.map((row) => row.task),
    rows.map((row) => row.r.level),
  );
  const byId = new Map(rows.map((row) => [row.task.id, row]));
  const above = (id: number) => {
    const out: number[] = [];
    for (let p = parentOf.get(id); p !== undefined; p = parentOf.get(p)) out.push(p);
    return out;
  };
  const shown = new Set<number>();
  for (const row of rows) {
    if (row.r.summary) continue;
    const id = row.task.id;
    const viaGroup = above(id).some((a) => matchesText(byId.get(a)!, filters)) && matchesFilters(row, filters);
    if (!pinned.includes(id) && !matches(row, filters) && !viaGroup) continue;
    shown.add(id);
    for (const a of above(id)) shown.add(a);
  }
  return rows.filter((row) => shown.has(row.task.id) && !above(row.task.id).some((a) => collapsed.includes(a)));
}

/** The selected tasks that are shown, in selection order: Delete, Link, Unlink, Move and Add act on these only. */
export function shownSelection(s: Pick<State, 'plan' | 'result' | 'filters' | 'pinned' | 'selection'>): number[] {
  if (!s.plan || !s.result || !isFiltering(s.filters) || s.selection.length === 0) return s.selection;
  const shown = new Set(shownRows(rowsOf(s.plan, s.result), s.filters, s.pinned).map((row) => row.task.id));
  return s.selection.filter((id) => shown.has(id));
}

/**
 * Whether Changes lists something the last Save didn't write (load fills, plan recalculations): the list isn't the
 * one Save wrote. Undo back to the saved plan brings that very list back.
 */
export const changesUnsaved = (s: Pick<State, 'changes' | 'changesSaved'>) => s.changes.length > 0 && s.changes !== s.changesSaved;

/** Names to suggest when assigning: resources first, then other assignees. */
export function assigneeNames(plan: Plan): string[] {
  return allAssignees(plan).map((r) => r.name);
}

/** What the header badge and the Issues panel show (§7.4, §7.11). */
export interface Problems {
  /** Errors, then warnings: the Problems tab and the header badge both count these. */
  list: Issue[];
  /** Information items (most repeat a row of Changes), listed apart as Notes. */
  notes: Issue[];
}

/**
 * Problems tab (§7.11): what the reader found at open, while it still applies, plus the live engine issues, errors
 * first. The badge and the panel both use it, so their counts agree.
 */
export function problems(s: Pick<State, 'readIssues' | 'plan' | 'result' | 'file' | 'savedAt'>): Problems {
  if (!s.plan || !s.result) return { list: [], notes: [] };
  const byRow = new Map(s.plan.tasks.flatMap((t) => (t.source === undefined ? [] : [[t.source, t] as const])));
  const read = s.readIssues.flatMap((issue) => {
    const now = readIssueNow(issue, byRow, s.file?.layout, s.savedAt !== null);
    return now ? [now] : [];
  });
  const all = [...read, ...s.result.issues].sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
  return { list: all.filter((i) => i.severity !== 'info'), notes: all.filter((i) => i.severity === 'info') };
}

/** Reader problems a Save settles: it writes unique IDs, "(Untitled)", values for formulas, and drops or converts
 * what ExcelJS can't keep (§3.5, §4.8). */
const DONE_BY_SAVE: ReadonlySet<IssueCode> = new Set<IssueCode>([
  'E_DUP_ID',
  'W_UNTITLED',
  'W_FORMULA',
  'W_UNSUPPORTED_CONTENT',
  'W_EXCEL_TABLES',
  'W_MERGED_CELLS',
  'W_EXCEL_FILTER',
]);

/** Input fields the reader can find unparseable (W_BAD_DATE, W_BAD_NUMBER). */
const UNPARSED_FIELDS = ['plannedStart', 'plannedDuration', 'plannedFinish', 'progress', 'actualStart', 'actualFinish'] as const;

/**
 * A reader problem as it stands now, or null once it no longer applies: its task was deleted, the user fixed it in
 * the app, or Save wrote the fix (§17). It follows its task through Renumber; undo brings it back with the plan.
 */
function readIssueNow({ at, ...issue }: ReadIssue, byRow: Map<unknown, Task>, layout: TasksLayout | undefined, saved: boolean): Issue | null {
  if (saved && DONE_BY_SAVE.has(issue.code)) return null;
  if (!at) return issue; // e.g. Holidays: the app doesn't write them
  const task = byRow.get(at.row);
  if (!task) return null;
  if (issue.code === 'E_DUP_ID' && task.id !== at.id) return null; // Renumber gave every task a new ID
  if (issue.code === 'W_UNTITLED' && task.name !== UNTITLED) return null;
  // Save writes the cell back as it is only while its text is the one read; retyped, it is written as text (§4.8).
  if (issue.code === 'W_PRED_NOT_TEXT' && task.predecessorsText !== at.predecessors) return null;
  const field = UNPARSED_FIELDS.find((f) => f === issue.field);
  // The text stays in the file while Save writes it back, and until the first Save while the field has no value.
  if (field && !((layout && keepsUnparsedText(task, field, layout)) || (!saved && task[field] === undefined))) return null;
  if (task.id === at.id) return issue;
  return { ...issue, taskId: task.id, message: issue.message.replace(new RegExp(`^Task ${at.id}(?!\\d)`), `Task ${task.id}`) };
}
