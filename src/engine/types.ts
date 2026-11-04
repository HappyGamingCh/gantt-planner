// Core types (SPEC §11.1). ISO dates only; the engine never sees a Date object.

export type ISODate = string; // 'YYYY-MM-DD'
export type LinkType = 'FS' | 'SS';
export interface Link {
  predId: number;
  type: LinkType;
  lag: number;
}

export interface Task {
  id: number;
  name: string;
  assigned: string[];
  predecessorsText: string; // as typed; the single source of truth for links
  plannedStart?: ISODate;
  plannedDuration?: number;
  plannedFinish?: ISODate;
  progress: number; // 0–100
  actualStart?: ISODate;
  actualFinish?: ISODate;
  remarks: string;
  isNewThisSession?: boolean;
  extra: Record<string, unknown>; // unknown Excel columns (opaque to the engine)
  /** Fields whose cell text couldn't be read at load: Save writes that text back until the user sets the field (§4.8). */
  unparsed?: readonly ('plannedStart' | 'plannedDuration' | 'level')[];
  /** Outline depth 1–8 (§5.12); undefined = blank (a file without the Level column: every row is Level 1). */
  level?: number;
  /** The Excel row it was read from; opaque outside the Excel layer, whose writer keeps the row's formatting. */
  source?: unknown;
}

export interface Project {
  name: string;
  owner: string;
  projectStart: ISODate;
  statusDate: ISODate;
  mode: 'Plan' | 'Track';
}

export interface Resource {
  name: string;
  type?: 'Person' | 'Team' | 'Contractor';
  color?: string;
}

export interface Holiday {
  date: ISODate;
  description: string;
}

/** Everything a plan workbook holds (SPEC §4). */
export interface Plan {
  project: Project;
  tasks: Task[];
  resources: Resource[];
  holidays: Holiday[];
}

export type Status = 'Not Started' | 'In Progress' | 'Late' | 'Completed';

export interface TaskResult {
  id: number;
  plannedStart: ISODate;
  plannedDuration: number;
  plannedFinish: ISODate;
  progress: number; // value to write back (rounded, clamped, 100 when Actual Finish is set)
  /** Normalized outline depth (§4.7, §5.12). */
  level: number;
  /** Set on a major task (§5.12): its leaf-task count and rolled-up Actual Finish; its other values are roll-ups too. */
  summary?: { tasks: number; actualFinish?: ISODate };
  actualStart?: ISODate; // value to write back (milestone: filled from Actual Finish); never a "for calculation" substitute
  actualDuration?: number;
  forecastStart: ISODate;
  forecastFinish: ISODate;
  variance: number;
  status: Status;
  predecessorsText: string; // canonical notation, or the original text if any token has an issue
  links: Link[]; // links used for calculation (valid, not part of a cycle)
  successorsText: string;
  plannedPctAtSD: number;
  totalFloat?: number;
  critical?: boolean;
}

export type QuickFix =
  | { kind: 'setActualStart'; taskId: number; value: ISODate }
  | { kind: 'setActualFinish'; taskId: number; value: ISODate; actualStart?: ISODate } // actualStart: also fill a blank Actual Start
  | { kind: 'removeLink'; taskId: number; predId: number };

export type IssueCode =
  | 'E_DUP_ID'
  | 'E_CYCLE'
  | 'E_BAD_LINK'
  | 'E_UNSUPPORTED_LINK'
  | 'E_MISSING_PRED'
  | 'E_SELF_LINK'
  | 'W_DUP_LINK'
  | 'W_START_DRIVEN'
  | 'W_NONWORKDAY'
  | 'W_FINISH_RECALC'
  | 'W_NO_DURATION'
  | 'W_PROGRESS_NO_AS'
  | 'W_100_NO_AF'
  | 'W_MS_NO_AF'
  | 'W_AF_NO_AS'
  | 'W_AF_BEFORE_AS'
  | 'W_FUTURE_ACTUAL'
  | 'W_BAD_DATE'
  | 'W_BAD_NUMBER'
  | 'W_BAD_HOLIDAY'
  | 'W_UNSUPPORTED_CONTENT'
  | 'W_EXCEL_TABLES'
  | 'W_MERGED_CELLS'
  | 'W_EXCEL_FILTER'
  | 'W_PRED_NOT_TEXT'
  | 'W_PROGRESS_CLAMPED'
  | 'W_FORMULA'
  | 'W_UNTITLED'
  | 'W_NEW_RESOURCE'
  | 'W_NO_TASKS_SHEET'
  | 'E_NO_TASK_HEADER'
  | 'W_COLUMNS_NOT_FOUND'
  | 'W_HOLIDAYS_NO_HEADER'
  | 'W_RESOURCES_NO_HEADER'
  | 'W_DATE_TOO_LARGE'
  | 'E_SUMMARY_LINK'
  | 'W_SUMMARY_PREDS';

export interface Issue {
  code: IssueCode;
  severity: 'error' | 'warning' | 'info';
  taskId?: number;
  message: string;
  fix?: QuickFix;
  /** The Tasks field the reader couldn't parse (W_BAD_DATE, W_BAD_NUMBER), as the Excel layer names it. */
  field?: string;
}

export interface Change {
  taskId?: number;
  field: string;
  from: unknown;
  to: unknown;
  kind: 'filled' | 'corrected';
  reason: string;
}

export type ScheduleState = 'Ahead' | 'On track' | 'Slightly behind' | 'Behind';

export interface ProjectSummary {
  // §5.8
  plannedStart: ISODate;
  plannedFinish: ISODate;
  forecastFinish: ISODate;
  finishVariance: number; // working days, + = late
  durationDays: number;
  elapsedDays: number; // working days
  actualPct: number;
  plannedPct: number;
  variancePts: number;
  spi: number | null;
  state: ScheduleState;
  weekActualDelta: number;
  weekPlannedDelta: number;
  counts: { completed: number; inProgress: number; notStarted: number; late: number; total: number }; // milestones excluded
  milestones: { done: number; total: number };
}

export interface AssigneeSummary {
  name: string;
  type?: Resource['type'];
  tasks: number;
  completed: number;
  inProgress: number;
  late: number;
  plannedPct: number;
  actualPct: number;
  variancePts: number;
}

export interface SCurvePoint {
  date: ISODate;
  planned: number;
  actual: number | null;
  forecast: number | null;
}

export interface ComputeResult {
  tasks: TaskResult[];
  summary: ProjectSummary;
  byAssignee: AssigneeSummary[];
  sCurve: SCurvePoint[];
  issues: Issue[];
  changes: Change[];
}

/** Per-task values shared by the metric modules (internal to the engine). */
export interface TaskCalc {
  id: number;
  assigned: string[];
  isMilestone: boolean;
  plannedStart: ISODate;
  plannedDuration: number;
  plannedFinish: ISODate;
  progress: number;
  calcStart?: ISODate; // actual start used for calculation
  calcFinish?: ISODate; // actual finish used for calculation (set ⇔ completed)
  forecastStart: ISODate;
  forecastFinish: ISODate;
  status: Status;
}
