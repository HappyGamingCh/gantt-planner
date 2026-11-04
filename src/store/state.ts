// App state shape (SPEC §3.3) and the reset applied when a plan closes or another opens: types, NO_FILTERS and
// CLOSED. The store itself and the view actions are in store.ts.
import type { ColorBy, ColumnKey, Density, Paper, ReportOptions, Zoom } from '../config';
import type { Change, ComputeResult, Issue, Plan, Status } from '../engine/types';
import type { Workbook } from '../excel/exceljs';
import type { TasksLayout } from '../excel/read';
import type { GridWidth } from './prefs';

export interface FileSession {
  name: string;
  /** Where Save writes; absent for the sample, a new plan, fallback mode, or before the first Save as. */
  handle?: FileSystemFileHandle;
  /** Conflict baseline: lastModified at open or last save (§3.5). */
  lastModified?: number;
  /** Kept and written into on save, never rebuilt (§4.8). */
  workbook: Workbook;
  layout: TasksLayout;
  /** Content Save would remove; the first Save over this file asks first (§3.5). */
  unsupported: string[];
}

export type Dialog =
  | { kind: 'conflict' }
  | { kind: 'failed'; detail: string } // the write threw: usually the file is open in Excel
  | { kind: 'missing'; detail: string } // the file was moved, renamed or deleted
  | { kind: 'unreadable'; detail: string } // the conflict check couldn't read the file: nothing was written
  | { kind: 'buildFailed'; detail: string } // the workbook couldn't be made: nothing was written
  | { kind: 'denied' }
  | { kind: 'unsupported'; parts: string }
  | { kind: 'discard'; then: () => void }
  | { kind: 'planMode' }
  | { kind: 'newPlan' }
  | { kind: 'delete'; ids: number[]; dependents: number; group?: { name: string; tasks: number } } // group: one major task (§8)
  | { kind: 'renumber' }
  | { kind: 'projectSettings' }
  | { kind: 'shortcuts' }
  | { kind: 'about' }
  | { kind: 'error'; title: string; message: string; action?: { label: string; run: () => void } };

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

export interface Filters {
  text: string;
  assignees: string[];
  statuses: Status[];
}

export const NO_FILTERS: Filters = { text: '', assignees: [], statuses: [] };

/** A problem the reader found at open. */
export interface ReadIssue extends Issue {
  /**
   * The task it is about as read: its row (`Task.source`, which survives Renumber, moves and undo), its ID then and
   * its Predecessors text then (W_PRED_NOT_TEXT holds until the user retypes it).
   */
  at?: { row: unknown; id: number; predecessors: string };
}

export interface State {
  plan: Plan | null;
  result: ComputeResult | null;
  file: FileSession | null;
  /** Problems the reader found at open; problems() shows those that still apply. Engine issues are live in `result`. */
  readIssues: ReadIssue[];
  /** What the app filled or corrected compared with the file: at open, plus plan recalculations (§7.11). */
  changes: Change[];
  /**
   * The `changes` list the last Save wrote, by reference: recalculations merge into it and undo brings an earlier
   * list back, so its length says nothing. The file chip links to Changes only while the list is another one.
   */
  changesSaved: Change[];
  dirty: boolean;
  /** The plan as it is in the file (after an open with nothing to fill, or after Save); dirty = the plan differs. */
  cleanPlan: Plan | null;
  savedAt: Date | null;
  busy: 'opening' | 'saving' | null;
  /** Name of the file being opened, while busy is 'opening'. */
  opening: string | null;
  dialog: Dialog | null;
  recent: FileSystemFileHandle | null;
  /** Fallback mode (§3.5): no File System Access, or the browser refused a picker; Save downloads a copy. */
  fallback: boolean;
  /** Selected task IDs; the last one has the focus (drawer, reveal). */
  selection: number[];
  /** Collapsed major tasks (§7.7): the view's, not the file's; every one expands when a file opens. */
  collapsed: number[];
  /** Where a Shift+click range starts. */
  anchor: number | null;
  /** Bumped to bring the focused task into view (Issues panel, successors in the drawer, a new task). */
  reveal: number;
  /** Tasks shown despite the search and filters until those change: just added or jumped to (§7.6). */
  pinned: number[];
  drawerId: number | null;
  /** Task whose name the drawer should put the cursor in (just added). */
  nameFocus: number | null;
  /** The drawer should take the focus when it shows: it was opened from the keyboard. */
  drawerFocus: boolean;
  panel: 'issues' | null;
  issuesTab: 'problems' | 'changes';
  toast: Toast | null;
  /** Bumped when a plan is opened or created, so the views start over (scroll to the status date or start). */
  session: number;
  /** Track → Plan asks once per opened or created plan (§6). */
  planModeConfirmed: boolean;
  /** Main view, the report (§9.1) or Print Gantt (§9.4), mirrored in the URL hash `#report` / `#print`. */
  view: 'main' | 'report' | 'print';
  undo: Plan[];
  redo: Plan[];
  /** Highest task ID used this session: new IDs are never reused (§8). */
  maxIdEver: number;
  filters: Filters;
  // Preferences (§7.13), saved in localStorage.
  zoom: Zoom;
  density: Density;
  gridWidth: GridWidth;
  columns: Record<'Plan' | 'Track', ColumnKey[]>;
  report: ReportOptions;
  colorBy: ColorBy;
  critical: boolean;
  kpiCollapsed: boolean;
  printPaper: Paper;
}

/** State of a closed plan; also the reset applied before showing a newly opened one. */
export const CLOSED: Pick<
  State,
  | 'plan'
  | 'result'
  | 'file'
  | 'readIssues'
  | 'changes'
  | 'changesSaved'
  | 'dirty'
  | 'cleanPlan'
  | 'savedAt'
  | 'busy'
  | 'opening'
  | 'dialog'
  | 'selection'
  | 'anchor'
  | 'drawerId'
  | 'panel'
  | 'toast'
  | 'undo'
  | 'redo'
  | 'filters'
  | 'pinned'
  | 'planModeConfirmed'
  | 'collapsed'
> = {
  plan: null,
  result: null,
  file: null,
  readIssues: [],
  changes: [],
  changesSaved: [],
  dirty: false,
  cleanPlan: null,
  savedAt: null,
  busy: null,
  opening: null,
  dialog: null,
  selection: [],
  anchor: null,
  drawerId: null,
  panel: null,
  toast: null,
  undo: [],
  redo: [],
  filters: NO_FILTERS,
  pinned: [],
  planModeConfirmed: false,
  collapsed: [],
};
