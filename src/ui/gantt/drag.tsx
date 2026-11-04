// Drag on the Gantt (SPEC §7.8, Plan mode only): move a root task's bar to change Planned Start, drag the right
// edge of a bar to change Planned Duration. Dates snap to working days; a ghost bar and a date tooltip follow the
// pointer, the chart scrolls by itself near the pane's edges; releasing makes one edit (one undo step), Esc cancels.
import { useCallback, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Calendar } from '../../engine/calendar';
import { addDays } from '../../engine/dates';
import { finishFrom } from '../../engine/schedule';
import type { ISODate, TaskResult } from '../../engine/types';
import { editTask } from '../../store/edit';
import type { Row } from '../../store/selectors';
import { formatDateLong, formatDays } from '../common/format';
import type { Point } from './arrows';
import { FloatingTip } from './GanttTooltip';
import type { GanttScale } from './scale';

export type DragKind = 'move' | 'resize';

export interface Drag {
  row: Row;
  kind: DragKind;
  /** Whole days the pointer has moved over the chart (scrolling the chart while dragging counts). */
  days: number;
  /** Where the pointer was when the press became a drag: the tooltip starts there, then follows the pointer itself. */
  at: Point;
}

/** Pixels the pointer must travel before a press becomes a drag (a shorter one stays a click). */
const THRESHOLD = 4;
/** Auto-scroll while dragging: the zone at the pane's left and right edges, and the most it scrolls per frame (px). */
const EDGE = 24;
const MAX_STEP = 16;

/**
 * Pixels per frame to scroll a pane spanning [left, right] while dragging at x (pressed at x0): faster the deeper the
 * pointer is in the edge zone or past it, and only towards the side it has moved to.
 */
export function edgeStep(x: number, x0: number, left: number, right: number): number {
  if (x < left + EDGE && x < x0) return -Math.min(MAX_STEP, Math.ceil((left + EDGE - x) / 2));
  if (x > right - EDGE && x > x0) return Math.min(MAX_STEP, Math.ceil((x - right + EDGE) / 2));
  return 0;
}

/**
 * Whole days a drag has moved: the pointer's travel from x0 plus the pane's scroll from left0, so scrolling the chart
 * while dragging counts. Null while a press (`started` false) is still short of a drag.
 */
export function dragDays(x: number, x0: number, scrollLeft: number, left0: number, px: number, started: boolean): number | null {
  const dx = x - x0 + scrollLeft - left0;
  if (!started && Math.abs(dx) < THRESHOLD) return null;
  return Math.round(dx / px);
}

/** Planned dates after dragging `days` days, snapped to working days. A resized bar keeps at least 1 day. */
export function dragDates(r: TaskResult, kind: DragKind, days: number, cal: Calendar): { start: ISODate; duration: number; finish: ISODate } {
  if (kind === 'move') {
    const start = cal.snapForward(addDays(r.plannedStart, days));
    return { start, duration: r.plannedDuration, finish: finishFrom(start, r.plannedDuration, cal) };
  }
  const duration = Math.max(1, cal.countWorkdays(r.plannedStart, addDays(r.plannedFinish, days)));
  return { start: r.plannedStart, duration, finish: finishFrom(r.plannedStart, duration, cal) };
}

/** A task with predecessors gets its start from them: its bar doesn't move (releasing explains why). */
export const movable = (r: TaskResult) => r.links.length === 0 && !r.summary; // a major task follows its tasks (§5.12)

/** The drag in progress, and the handler that starts one from a press on a bar or its right edge. */
export function useBarDrag(scale: GanttScale, cal: Calendar) {
  const [drag, setDrag] = useState<Drag | null>(null);

  // Stable between renders, so the memoised marks that call it aren't re-drawn.
  const start = useCallback(
    (e: ReactPointerEvent<SVGElement>, row: Row, kind: DragKind) => {
      if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
      // Measured over the chart, not the screen: scrolling the pane during the drag keeps the ghost under the pointer.
      const pane = e.currentTarget.closest<HTMLElement>('.pane-gantt');
      const x0 = e.clientX;
      const left0 = pane?.scrollLeft ?? 0;
      let last: Point = { x: e.clientX, y: e.clientY };
      let current: Drag | null = null;
      let frame = 0;
      const update = () => {
        const days = dragDays(last.x, x0, pane?.scrollLeft ?? 0, left0, scale.px, current !== null);
        if (days === null || current?.days === days) return; // the chart re-renders only when the date changes
        current = { row, kind, days, at: current?.at ?? last };
        setDrag(current);
      };
      // Near the pane's edges the chart scrolls by itself, a step per frame, until the pointer leaves the zone.
      const tick = () => {
        frame = 0;
        if (!pane || !current) return;
        const box = pane.getBoundingClientRect();
        const step = edgeStep(last.x, x0, box.left, box.left + pane.clientWidth);
        const before = pane.scrollLeft;
        if (step !== 0) pane.scrollLeft = before + step;
        if (pane.scrollLeft === before) return; // out of the zone, or at the end of the chart
        update();
        frame = requestAnimationFrame(tick);
      };
      const move = (ev: PointerEvent) => {
        last = { x: ev.clientX, y: ev.clientY };
        update();
        if (current && !frame) frame = requestAnimationFrame(tick);
      };
      const end = (apply: boolean) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', key, true);
        pane?.removeEventListener('scroll', update);
        cancelAnimationFrame(frame);
        setDrag(null);
        if (!apply || !current || current.days === 0) return;
        const dates = dragDates(row.r, kind, current.days, cal);
        if (kind === 'resize') editTask(row.task.id, 'plannedDuration', dates.duration);
        else editTask(row.task.id, 'plannedStart', dates.start); // a task with predecessors: the edit rule's toast says why
      };
      const up = () => end(true);
      const cancel = () => end(false);
      const key = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        ev.stopPropagation(); // Esc ends the drag only, it doesn't also close the drawer
        end(false);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key, true);
      pane?.addEventListener('scroll', update);
    },
    [scale, cal],
  );

  return { drag, start };
}

/** Where the bar would go, drawn over the chart. */
export function DragGhost({ drag, top, rowHeight, scale, cal }: { drag: Drag; top: number; rowHeight: number; scale: GanttScale; cal: Calendar }) {
  const { r } = drag.row;
  if (drag.kind === 'move' && !movable(r)) return null;
  const { start, finish } = dragDates(r, drag.kind, drag.days, cal);
  const mid = top + rowHeight / 2;
  if (r.plannedDuration === 0) {
    const cx = scale.x(start) + scale.px / 2;
    return <path className="drag-ghost" d={`M${cx},${mid - 7} L${cx + 7},${mid} L${cx},${mid + 7} L${cx - 7},${mid} Z`} />;
  }
  const x0 = scale.x(start);
  return <rect className="drag-ghost" x={x0} y={mid - 8} width={Math.max(2, scale.x(finish) + scale.px - x0)} height={16} rx={4} />;
}

/** Dates under the pointer while dragging. */
export function DragTip({ drag, cal }: { drag: Drag; cal: Calendar }) {
  const { r } = drag.row;
  const locked = drag.kind === 'move' && !movable(r);
  const { start, finish, duration } = dragDates(r, drag.kind, drag.days, cal);
  return (
    <FloatingTip at={drag.at} className="gantt-tip drag-tip" role="status">
      {locked ? (
        'Set by predecessors — add lag to delay'
      ) : (
        <>
          <strong>{start === finish ? formatDateLong(start) : `${formatDateLong(start)} → ${formatDateLong(finish)}`}</strong>
          <span className="tip-sub">{duration === 0 ? 'Milestone' : formatDays(duration)}</span>
        </>
      )}
    </FloatingTip>
  );
}
