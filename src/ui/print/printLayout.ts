// Print Gantt layout (SPEC §9.4): the paper, rows per page, the table's columns at print widths with the text the grid
// shows, and the assignees in the legend. Pure functions, so pagination and columns are tested without a browser.
import { TIMELINE_HEIGHT, type ColumnKey, type Paper } from '../../config';
import type { Project } from '../../engine/types';
import { assigneeKey, type AssigneeInfo, type Row } from '../../store/selectors';
import { formatDate, formatDays, formatVariance } from '../common/format';
import { STATUS_LABEL, STATUS_SLUG } from '../common/status';
import { visibleColumns, type Column } from '../grid/columns';

/** CSS px for a length in mm (96 px per inch, as the browser prints). */
const mm = (n: number) => (n * 96) / 25.4;

/** The printable area of a landscape sheet inside its 10 mm margins, in CSS px rounded down, and its @page size. */
export const PAPER: Record<Paper, { width: number; height: number; size: string }> = {
  A4: { width: Math.floor(mm(297 - 20)), height: Math.floor(mm(210 - 20)), size: 'A4 landscape' },
  A3: { width: Math.floor(mm(420 - 20)), height: Math.floor(mm(297 - 20)), size: 'A3 landscape' },
};

/** Row height, px: a Track bar over its baseline (22 px) with a critical ring fits, as in the report's appendix. */
export const PRINT_ROW = 26;
/** The column headers and the timeline header, each with the rule under it. */
export const HEAD_HEIGHT = TIMELINE_HEIGHT + 1;
/** The chart keeps at least this width beside the table (Track mode's default columns fit beside it on A4). */
export const MIN_CHART = 380;
/** Indent of the Task text per Level below 1. */
export const LEVEL_INDENT = 12;

/** Rows that fit a page under the headers and above a legend `legendHeight` px tall. */
export function rowsPerPage(paper: Paper, legendHeight: number): number {
  return Math.max(1, Math.floor((PAPER[paper].height - HEAD_HEIGHT - legendHeight) / PRINT_ROW));
}

/** The rows in pages of `perPage`. */
export function paginate<T>(rows: readonly T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage));
  return pages;
}

export interface PrintColumn {
  key: Column['key'];
  header: string;
  width: number;
  align?: 'right';
}

/**
 * Print widths: the widest value or header word at 11 px (measured in IBM Plex Sans: a `dd MMM yy` date 51 px,
 * "In progress" 57 px, "Duration" / "Progress" / "Variance" 45 px semibold, "Predecessors" 69 px) plus the cell's 8 px.
 */
const WIDTH: Record<ColumnKey, number> = {
  assigned: 96,
  duration: 54,
  start: 60,
  finish: 60,
  predecessors: 78,
  successors: 66,
  progress: 54,
  actualStart: 60,
  actualFinish: 60,
  actualDuration: 54,
  forecastStart: 60,
  forecastFinish: 60,
  variance: 54,
  status: 66,
  critical: 46,
  remarks: 160,
};
const RIGHT: readonly Column['key'][] = ['id', 'duration', 'progress', 'actualDuration', 'variance'];

/**
 * ID, Task and the grid's visible columns for the mode, in the grid's order, at print widths. Columns that would leave
 * the chart less than MIN_CHART px are left out from the right; `left` names them. `width` includes the table's rule.
 */
export function printColumns(shown: readonly ColumnKey[], mode: Project['mode'], paper: Paper): { columns: PrintColumn[]; left: string[]; width: number } {
  const all = visibleColumns(shown).map(
    (c): PrintColumn => ({
      key: c.key,
      header: c.header(mode),
      width: c.key === 'id' ? 32 : c.key === 'task' ? (paper === 'A3' ? 260 : 180) : WIDTH[c.key],
      ...(RIGHT.includes(c.key) ? { align: 'right' as const } : {}),
    }),
  );
  const columns = [...all];
  const width = () => columns.reduce((sum, c) => sum + c.width, 0) + 1;
  while (columns.length > 2 && width() > PAPER[paper].width - MIN_CHART) columns.pop();
  return { columns, left: all.slice(columns.length).map((c) => c.header), width: width() };
}

/** A cell's text as the grid shows it, on one line. */
export function cellText(key: ColumnKey, { task, r }: Row): string {
  const date = (d: string | undefined) => (d ? formatDate(d) : '');
  switch (key) {
    case 'assigned':
      return task.assigned.join(', ');
    case 'duration':
      return formatDays(r.plannedDuration);
    case 'start':
      return formatDate(r.plannedStart);
    case 'finish':
      return formatDate(r.plannedFinish);
    case 'predecessors':
      return r.predecessorsText;
    case 'successors':
      return r.successorsText;
    case 'progress':
      return `${r.progress}%`;
    case 'actualStart':
      return date(r.actualStart);
    case 'actualFinish':
      return date(task.actualFinish);
    case 'actualDuration':
      return r.actualDuration === undefined ? '' : formatDays(r.actualDuration);
    case 'forecastStart':
      return formatDate(r.forecastStart);
    case 'forecastFinish':
      return formatDate(r.forecastFinish);
    case 'variance':
      return formatVariance(r.variance);
    case 'status':
      return STATUS_LABEL[r.status];
    case 'critical':
      return r.critical ? 'Yes' : '';
    case 'remarks':
      return task.remarks.replace(/\s*\n\s*/g, ' ');
  }
}

/** A cell's colour, as in the grid: a later forecast and variance in red, earlier in green, Status in its colour. */
export function cellTone(key: ColumnKey, { r }: Row): string | undefined {
  switch (key) {
    case 'forecastFinish':
      return r.variance > 0 ? 'text-late' : undefined;
    case 'variance':
      return r.variance > 0 ? 'text-late' : r.variance < 0 ? 'text-early' : 'text-muted';
    case 'status':
      return `print-status st-${STATUS_SLUG[r.status]}`;
    case 'critical':
      return r.critical ? 'text-late' : undefined;
    default:
      return undefined;
  }
}

export interface LegendAssignees {
  names: { name: string; color: string }[];
  /** A printed bar has no assignee (drawn in --idle). */
  unassigned: boolean;
}

/**
 * The colours the printed bars take when coloured by assignee (§7.8: the first assignee's), in the Resources order,
 * each named as written on its first task. Major tasks and milestones keep their own colours, so they don't count.
 */
export function legendAssignees(rows: readonly Row[], info: Map<string, AssigneeInfo>): LegendAssignees {
  const seen = new Map<string, string>();
  let unassigned = false;
  for (const { task, r } of rows) {
    if (r.summary || r.plannedDuration === 0) continue;
    const name = task.assigned[0]?.trim() ?? '';
    if (name === '') unassigned = true;
    else if (!seen.has(assigneeKey(name))) seen.set(assigneeKey(name), name);
  }
  const order = [...info.keys()];
  const names = [...seen]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([key, name]) => ({ name, color: info.get(key)?.color ?? 'var(--idle)' }));
  return { names, unassigned };
}
