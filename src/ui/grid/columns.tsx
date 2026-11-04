// Grid columns (SPEC §6, §7.6, §7.7): ID and Task always, then the columns chosen per mode (Columns popover),
// in this order. `field` + `editor` make a column editable, subject to the mode rules of edit.ts.
import { Flag, GripVertical, Link2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { GRID_WIDTH, type ColumnKey } from '../../config';
import type { Project } from '../../engine/types';
import type { EditField } from '../../store/edit';
import type { AssigneeInfo, Row } from '../../store/selectors';
import { formatDate, formatDays, formatVariance, plural } from '../common/format';
import { AssigneeChips, ProgressCell, StatusChip } from './cells';
import { OutlineSlot } from './outlineCells';

/** `multiline`: a text that keeps its line breaks (Remarks; Alt+Enter adds one, as in Excel). */
export type Editor = 'text' | 'multiline' | 'number' | 'date' | 'assigned' | 'predecessors' | 'progress';

export interface Column {
  key: 'id' | 'task' | ColumnKey;
  /** Header and Columns-popover label; some differ by mode. */
  header: (mode: Project['mode']) => string;
  /** px; for Task the minimum, as it takes any spare grid width. */
  width: number;
  align?: 'right';
  /** Extra class on the column's header and body cells (Grid.css). */
  className?: string;
  field?: EditField;
  editor?: Editor;
  /** What the editor starts with. */
  editValue?: (row: Row) => string;
  /** Calculated here: grey text, tooltip "Calculated", never editable. */
  calc?: (row: Row) => boolean;
  render: (row: Row, info: Map<string, AssigneeInfo>) => ReactNode;
}

const label = (text: string) => () => text;
const always = () => true;
const date = (d: string | undefined) => (d ? formatDate(d) : '');

const ASSIGNED_W = 116;
/** The Assigned cell's padding, left + right (Grid.css `.cell-chips`: 6 px a side, so two tags such as ACME + NDT fit). */
const CHIPS_PADDING = 12;

// Widths fit each column's values; long headers wrap onto two lines (Grid.css), so the default columns of each
// mode fit a 1280–1440 px window (SPEC §6, §7.3).
const CATALOG: Column[] = [
  {
    key: 'id',
    header: label('ID'),
    width: 40,
    align: 'right',
    // The grip shows on hover: dragging it moves the row at once (a hold anywhere on the row does too, §7.7).
    render: ({ task }) => (
      <>
        <span className="row-grip" data-grip="" aria-hidden="true" title="Drag to move the row">
          <GripVertical size={12} />
        </span>
        {task.id}
      </>
    ),
  },
  {
    key: 'task',
    header: label('Task'),
    width: 200,
    field: 'name',
    editor: 'text',
    editValue: ({ task }) => task.name,
    // Separate flex items, so only the name ends with "…" and the New tag stays visible. The outline slot indents the
    // row by its Level and holds a major task's chevron (§7.7).
    render: (row) => (
      <>
        <OutlineSlot row={row} />
        {row.r.status === 'Late' && <span className="late-dot" aria-label="Late" />}
        <span className={row.r.summary ? 'task-name task-summary' : 'task-name'} title={row.task.name}>
          {row.task.name}
        </span>
        {row.r.summary && (
          <span className="task-count" title={plural(row.r.summary.tasks, 'task')}>
            {row.r.summary.tasks}
          </span>
        )}
        {row.task.isNewThisSession && (
          <span className="new-tag" title="Added in Track mode this session: planned dates, duration and predecessors stay editable">
            New
          </span>
        )}
      </>
    ),
  },
  {
    key: 'assigned',
    header: label('Assigned'),
    width: ASSIGNED_W,
    className: 'cell-chips',
    field: 'assigned',
    editor: 'assigned',
    render: ({ task }, info) => <AssigneeChips names={task.assigned} info={info} budget={ASSIGNED_W - CHIPS_PADDING} />,
  },
  {
    key: 'duration',
    header: label('Duration'),
    width: 68,
    align: 'right',
    field: 'plannedDuration',
    editor: 'number',
    editValue: ({ r }) => String(r.plannedDuration),
    render: ({ r }) => formatDays(r.plannedDuration),
  },
  {
    key: 'start',
    header: (mode) => (mode === 'Plan' ? 'Start' : 'Planned Start'),
    width: 96,
    field: 'plannedStart',
    editor: 'date',
    editValue: ({ r }) => r.plannedStart,
    calc: ({ r }) => r.links.length > 0,
    // The cell's tooltip says why it can't be edited in this mode (Grid.tsx, readOnlyReason).
    render: ({ r }) =>
      r.links.length > 0 ? (
        <span className="linked">
          <Link2 size={12} aria-hidden="true" />
          {formatDate(r.plannedStart)}
        </span>
      ) : (
        formatDate(r.plannedStart)
      ),
  },
  {
    key: 'finish',
    header: (mode) => (mode === 'Plan' ? 'Finish' : 'Planned Finish'),
    width: 84,
    field: 'plannedFinish',
    editor: 'date',
    editValue: ({ r }) => r.plannedFinish,
    render: ({ r }) => formatDate(r.plannedFinish),
  },
  {
    key: 'predecessors',
    header: label('Predecessors'),
    width: 96,
    field: 'predecessorsText',
    editor: 'predecessors',
    editValue: ({ r }) => r.predecessorsText,
    render: ({ r }) => r.predecessorsText,
  },
  { key: 'successors', header: label('Successors'), width: 96, calc: always, render: ({ r }) => r.successorsText },
  { key: 'progress', header: label('Progress'), width: 88, field: 'progress', editor: 'progress', render: ({ r }) => <ProgressCell progress={r.progress} status={r.status} /> },
  {
    key: 'actualStart',
    header: label('Actual Start'),
    width: 84,
    field: 'actualStart',
    editor: 'date',
    editValue: ({ r }) => r.actualStart ?? '',
    render: ({ r }) => date(r.actualStart),
  },
  {
    key: 'actualFinish',
    header: label('Actual Finish'),
    width: 84,
    field: 'actualFinish',
    editor: 'date',
    editValue: ({ task }) => task.actualFinish ?? '',
    render: ({ task }) => date(task.actualFinish),
  },
  {
    key: 'actualDuration',
    header: label('Actual Duration'),
    width: 72,
    align: 'right',
    calc: always,
    render: ({ r }) => (r.actualDuration === undefined ? '' : formatDays(r.actualDuration)),
  },
  { key: 'forecastStart', header: label('Forecast Start'), width: 84, calc: always, render: ({ r }) => formatDate(r.forecastStart) },
  {
    key: 'forecastFinish',
    header: label('Forecast Finish'),
    width: 84,
    calc: always,
    render: ({ r }) => <span className={r.variance > 0 ? 'text-late' : undefined}>{formatDate(r.forecastFinish)}</span>,
  },
  {
    key: 'variance',
    header: label('Variance'),
    width: 68,
    align: 'right',
    calc: always,
    render: ({ r }) => <span className={r.variance > 0 ? 'text-late' : r.variance < 0 ? 'text-early' : 'text-muted'}>{formatVariance(r.variance)}</span>,
  },
  { key: 'status', header: label('Status'), width: 100, calc: always, render: ({ r }) => <StatusChip status={r.status} /> },
  {
    key: 'critical',
    header: label('Critical'),
    width: 72,
    calc: always,
    render: ({ r }) =>
      r.critical && (
        <span className="flagged text-late">
          <Flag size={12} aria-hidden="true" />
          Yes
        </span>
      ),
  },
  {
    key: 'remarks',
    header: label('Remarks'),
    width: 200,
    field: 'remarks',
    editor: 'multiline',
    editValue: ({ task }) => task.remarks,
    render: ({ task }) => (
      <span className="task-name" title={task.remarks}>
        {task.remarks}
      </span>
    ),
  },
];

/** A major task's cells other than ID, Task and Remarks are calculated from its tasks (§5.12). */
const SUMMARY_OWN: readonly Column['key'][] = ['id', 'task', 'remarks'];
export const isCalcCell = (row: Row, c: Column): boolean => (row.r.summary !== undefined && !SUMMARY_OWN.includes(c.key)) || (c.calc?.(row) ?? false);

/** Optional columns, for the Columns popover. */
export const OPTIONAL = CATALOG.filter((c) => c.key !== 'id' && c.key !== 'task');

/** ID, Task and the chosen columns, in catalog order. */
export function visibleColumns(shown: readonly ColumnKey[]): Column[] {
  return CATALOG.filter((c) => c.key === 'id' || c.key === 'task' || shown.includes(c.key));
}

/** ID and Task stay in view when the grid scrolls sideways. */
export const STICKY_COLUMNS = 2;

/** Grid tracks: fixed widths, except Task, which takes any spare width (no empty strip in a wide grid). */
export function gridTemplate(columns: readonly Column[]): string {
  return columns.map((c) => (c.key === 'task' ? `minmax(${c.width}px, 1fr)` : `${c.width}px`)).join(' ');
}

export function columnsWidth(columns: readonly Column[]): number {
  return columns.reduce((sum, c) => sum + c.width, 0);
}

/** §7.3 "fit the columns": the grid width that shows every visible column, up to 60 % of the workspace (320–900 px). */
export function autoGridWidth(columns: number, workspace: number): number {
  return Math.min(GRID_WIDTH.max, Math.max(GRID_WIDTH.min, Math.min(columns + 1, Math.round(workspace * GRID_WIDTH.share))));
}
