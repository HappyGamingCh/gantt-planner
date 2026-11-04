// Gantt marks (SPEC §7.8): Plan bars, Track bars with baseline and progress, milestones, major-task bars, dependency arrows.
// Critical tasks get a red ring when the critical path is shown; Color by Assignee paints bars in the first
// assignee's colour.
import { memo, type PointerEvent } from 'react';
import type { ColorBy } from '../../config';
import type { Task, TaskResult } from '../../engine/types';
import { assigneeKey, type AssigneeInfo, type Row } from '../../store/selectors';
import { formatDayMonth, formatVariance } from '../common/format';
import { STATUS_SLUG } from '../common/status';
import { arrowHead, LINK_GAP, linkPath } from './arrows';
import { movable, type DragKind } from './drag';
import type { GanttScale } from './scale';

const HALF = 6; // milestone diamond: 12 px across
/** Critical ring around a diamond: 4.5 px further out along each axis (≈ 3.2 px square to its edges), so the 2 px ring
 * stands about 2 px clear of the diamond, like the bars' ring. */
const RING_HALF = HALF + 4.5;
/** Corner radius of the Track bar (its outer edge) and the Plan bar. */
const BAR_RX = 4;

/** Labels on a chart with arrows start past the FS elbow (LINK_GAP), so the arrows' vertical never crosses their first letter. */
export const LABEL_DX = LINK_GAP + 6;

/**
 * The resize handle at a bar's right end: 8 px centred on the end, or 6 px just past it when the bar is under 16 px
 * wide (Month zoom, a small Fit), so a press on the bar itself still moves it.
 */
export function handleSpan(x1: number, width: number): { x: number; width: number } {
  return width < 16 ? { x: x1, width: 6 } : { x: x1 - 4, width: 8 };
}

/** Where a task's mark starts and ends on the chart, in the given mode. */
export function span(r: TaskResult, mode: 'Plan' | 'Track', scale: GanttScale): { x0: number; x1: number; milestone: boolean } {
  const [start, finish] = mode === 'Plan' ? [r.plannedStart, r.plannedFinish] : [r.forecastStart, r.forecastFinish];
  if (r.plannedDuration === 0 && !r.summary) {
    const cx = scale.x(finish) + scale.px / 2;
    return { x0: cx - HALF, x1: cx + HALF, milestone: true };
  }
  return { x0: scale.x(start), x1: scale.x(finish) + scale.px, milestone: false };
}

function Diamond({ cx, cy, half = HALF, className, onPointerDown }: { cx: number; cy: number; half?: number; className: string; onPointerDown?: (e: PointerEvent<SVGElement>) => void }) {
  return <path className={className} d={`M${cx},${cy - half} L${cx + half},${cy} L${cx},${cy + half} L${cx - half},${cy} Z`} onPointerDown={onPointerDown} />;
}

/**
 * 2 px red ring 2 px clear of a bar (SPEC §7.8: critical path): its centre line 3 px out. The band of lane colour
 * between them keeps the ring apart from a warm assignee colour (the palette's orange vs red is only 1.36:1 touching).
 */
function Ring({ x, y, width, height, rx }: { x: number; y: number; width: number; height: number; rx: number }) {
  return <rect className="crit-ring" x={x - 3} y={y - 3} width={width + 6} height={height + 6} rx={rx + 3} />;
}

/** A bar's colour when colouring by assignee: its first assignee's, `--idle` when it has none; undefined by status. */
export function barPaint(task: Task, colorBy: ColorBy, info: Map<string, AssigneeInfo>): string | undefined {
  return colorBy === 'assignee' ? (info.get(assigneeKey(task.assigned[0] ?? ''))?.color ?? 'var(--idle)') : undefined;
}

export interface MarkProps {
  row: Row;
  top: number;
  rowHeight: number;
  scale: GanttScale;
  /** Bar colour when colouring by assignee; status colours (Plan: the accent) otherwise. */
  paint?: string;
  /** Ring the mark: a critical task while the critical path is shown. */
  critical: boolean;
  /** Plan mode: a press on the bar (move) or on its right edge (resize) may start a drag. */
  onDragStart?: (e: PointerEvent<SVGElement>, row: Row, kind: DragKind) => void;
}

export function PlanMark({ row, top, rowHeight, scale, paint, critical, onDragStart }: MarkProps) {
  const { r } = row;
  const mid = top + rowHeight / 2;
  const { x0, x1, milestone } = span(r, 'Plan', scale);
  const grab = movable(r) ? ' movable' : '';
  const press = (kind: DragKind) => onDragStart && ((e: PointerEvent<SVGElement>) => onDragStart(e, row, kind));
  if (milestone) {
    const cx = (x0 + x1) / 2;
    return (
      <>
        {critical && <Diamond cx={cx} cy={mid} half={RING_HALF} className="crit-ring" />}
        <Diamond cx={cx} cy={mid} className={`ms-plan${grab}`} onPointerDown={press('move')} />
      </>
    );
  }
  const width = Math.max(2, x1 - x0);
  const handle = handleSpan(x1, width);
  return (
    <>
      {critical && <Ring x={x0} y={mid - 8} width={width} height={16} rx={BAR_RX} />}
      <rect className={`bar-plan${grab}`} x={x0} y={mid - 8} width={width} height={16} rx={BAR_RX} style={paint ? { fill: paint } : undefined} onPointerDown={press('move')} />
      {onDragStart && <rect className="bar-handle" x={handle.x} y={mid - 10} width={handle.width} height={20} onPointerDown={press('resize')} />}
    </>
  );
}

/** Track bars: a 14 px forecast/actual bar over a 4 px baseline, centred as a 22 px stack in the row. */
export function TrackMark({ row, top, rowHeight, scale, paint, critical }: MarkProps) {
  const { r } = row;
  const slug = STATUS_SLUG[r.status];
  const y = top + (rowHeight - 22) / 2;
  const { x0, x1, milestone } = span(r, 'Track', scale);
  if (milestone) {
    const cx = (x0 + x1) / 2;
    return (
      <>
        {critical && <Diamond cx={cx} cy={top + rowHeight / 2} half={RING_HALF} className="crit-ring" />}
        <Diamond cx={cx} cy={top + rowHeight / 2} className={`ms-track st-${slug}`} />
      </>
    );
  }
  const planned = span(r, 'Plan', scale);
  const width = Math.max(2, x1 - x0);
  const done = r.status === 'Completed' ? width : (width * r.progress) / 100;
  // The outlined part is inset half its 1 px stroke, so its outer edge has the same 4 px corners as the done part.
  return (
    <>
      <rect className="bar-baseline" x={planned.x0} y={y + 18} width={Math.max(2, planned.x1 - planned.x0)} height={4} rx={2} />
      {critical && <Ring x={x0} y={y} width={width} height={14} rx={BAR_RX} />}
      <rect className={`bar-rest st-${slug}`} x={x0 + 0.5} y={y + 0.5} width={width - 1} height={13} rx={BAR_RX - 0.5} style={paint ? { fill: paint, fillOpacity: 0.2, stroke: paint } : undefined} />
      {done > 0 && <rect className={`bar-done st-${slug}`} x={x0} y={y} width={done} height={14} rx={BAR_RX} style={paint ? { fill: paint } : undefined} />}
    </>
  );
}

/**
 * A major task (§7.8): an 8 px bar across its tasks with 4 px end caps pointing down, in --summary. Track mode fills
 * the done part and outlines the rest, over the planned baseline. Never dragged, never ringed.
 */
export function SummaryMark({ row, top, rowHeight, scale, mode }: Pick<MarkProps, 'row' | 'top' | 'rowHeight' | 'scale'> & { mode: 'Plan' | 'Track' }) {
  const { r } = row;
  const { x0, x1 } = span(r, mode, scale);
  const width = Math.max(2, x1 - x0);
  const stack = top + (rowHeight - 22) / 2; // Track: the 22 px stack of bar and baseline, as TrackMark
  const y = mode === 'Track' ? stack + 3 : top + rowHeight / 2 - 4;
  const caps = `M${x0},${y + 8}h6l-6,4Z M${x0 + width},${y + 8}h-6l6,4Z`;
  if (mode === 'Plan') {
    return (
      <>
        <rect className="bar-summary" x={x0} y={y} width={width} height={8} />
        <path className="bar-summary" d={caps} />
      </>
    );
  }
  const planned = span(r, 'Plan', scale);
  const done = r.status === 'Completed' ? width : (width * r.progress) / 100;
  return (
    <>
      <rect className="bar-baseline" x={planned.x0} y={stack + 18} width={Math.max(2, planned.x1 - planned.x0)} height={4} rx={2} />
      <rect className="bar-summary-rest" x={x0 + 0.5} y={y + 0.5} width={width - 1} height={7} />
      {done > 0 && <rect className="bar-summary" x={x0} y={y} width={done} height={8} />}
      <path className="bar-summary" d={caps} />
    </>
  );
}

/**
 * The label right of a mark: Plan = assignees (milestone: its date); Track = progress (milestone: its date), with
 * the variance when late. Drawn in a layer of its own, above the status-date and today lines.
 */
export function MarkLabel({
  row,
  mode,
  top,
  rowHeight,
  scale,
  dx = 6,
}: {
  row: Row;
  mode: 'Plan' | 'Track';
  top: number;
  rowHeight: number;
  scale: GanttScale;
  /** Gap from the mark's end; a chart that draws arrows passes LABEL_DX. */
  dx?: number;
}) {
  const { r, task } = row;
  const { x1, milestone } = span(r, mode, scale);
  const mid = top + rowHeight / 2;
  if (r.summary && mode === 'Plan') return null; // a major task's bar speaks for itself in Plan mode (§7.8)
  if (mode === 'Plan') {
    const text = milestone ? formatDayMonth(r.plannedFinish) : task.assigned.join(', ');
    return text ? (
      <text className="bar-label" x={x1 + dx} y={mid}>
        {text}
      </text>
    ) : null;
  }
  // Track bars: level with the 14 px bar at the top of the 22 px stack.
  return (
    <text className="bar-label" x={x1 + dx} y={milestone ? mid : top + (rowHeight - 22) / 2 + 7}>
      {milestone ? formatDayMonth(r.forecastFinish) : `${r.progress}%`}
      {r.status === 'Late' && <tspan className="label-late"> · {formatVariance(r.variance)}</tspan>}
    </text>
  );
}

/**
 * Dependency arrows. Plan mode draws them all: the hovered or selected task's arrows are highlighted and the rest
 * dimmed. Track mode draws only that task's arrows (to its predecessors and successors), between the forecast/actual
 * bars, so nothing covers the progress bars until a task is hovered or selected. With the critical path shown,
 * arrows between two critical tasks are red. Memoised: it re-draws only when the plan, the scale or the focus change.
 */
export const Links = memo(function Links({
  rows,
  mode,
  rowHeight,
  scale,
  focus,
  critical,
  rowRange,
}: {
  rows: Row[];
  mode: 'Plan' | 'Track';
  rowHeight: number;
  scale: GanttScale;
  focus: number | null;
  critical: boolean;
  /** Only the arrows that reach rows first…last (a printed page, §9.4); the rest are left out. */
  rowRange?: { first: number; last: number };
}) {
  if (mode === 'Track' && focus === null) return null;
  const index = new Map(rows.map((row, i) => [row.task.id, i]));
  // Middle of a mark: a Track bar sits 4 px above the middle of its row (the baseline is under it), a diamond on it.
  const mid = (r: TaskResult, i: number) => (i + 0.5) * rowHeight - (mode === 'Track' && r.plannedDuration !== 0 ? 4 : 0);
  const links = rows.flatMap((row, i) =>
    row.r.links.flatMap((link) => {
      const j = index.get(link.predId);
      if (j === undefined || (rowRange && (Math.max(i, j) < rowRange.first || Math.min(i, j) > rowRange.last))) return [];
      const on = focus === row.task.id || focus === link.predId;
      if (mode === 'Track' && !on) return [];
      const predR = rows[j]!.r;
      const pred = span(predR, mode, scale);
      const from = { x: link.type === 'SS' ? pred.x0 : pred.x1, y: mid(predR, j) };
      const to = { x: span(row.r, mode, scale).x0, y: mid(row.r, i) };
      const state = focus === null ? '' : on ? ' link-on' : ' link-dim';
      const red = critical && row.r.critical && predR.critical ? ' link-critical' : '';
      return [
        <g key={`${link.predId}-${row.task.id}`} className={`link${state}${red}`}>
          <path d={linkPath(link.type, from, to, rowHeight)} />
          <path className="link-head" d={arrowHead(to)} />
        </g>,
      ];
    }),
  );
  return <g className="links">{links}</g>;
});
