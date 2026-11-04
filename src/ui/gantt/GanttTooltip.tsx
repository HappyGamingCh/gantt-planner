// Tooltip card for a task on the Gantt (SPEC §7.8): name, assignees, planned and forecast/actual dates, progress, variance.
// The card and the drag tooltip follow the pointer by themselves, so moving the pointer re-renders only the card.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Row } from '../../store/selectors';
import { formatDateLong, formatDays, formatVariance, plural } from '../common/format';
import { StatusChip } from '../grid/cells';
import type { Point } from './arrows';

const range = (a: string, b: string) => (a === b ? formatDateLong(a) : `${formatDateLong(a)} → ${formatDateLong(b)}`);

const MARGIN = 8; // from the window's edges

/** Where a w × h card goes for the pointer at `at` in a vw × vh window: below right of the pointer, above it when
 * there's no room below, always inside the window. */
export function placeTip(at: Point, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  const left = Math.max(MARGIN, Math.min(at.x + 14, vw - w - MARGIN));
  const top = at.y + 16 + h <= vh - MARGIN ? at.y + 16 : Math.max(MARGIN, at.y - h - 12);
  return { left, top };
}

/** A card that starts at `at` and then follows the pointer, placed by its measured size (a long Thai name wraps). */
export function FloatingTip({ at, className, role, children }: { at: Point; className: string; role: 'tooltip' | 'status'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, []);
  // Measured before the browser paints, so the hidden first render is never seen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && (el.offsetWidth !== size?.w || el.offsetHeight !== size?.h)) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  });
  // Moved by a transform from the window's top left, so its width never depends on where it sits (no re-measuring).
  const { left, top } = size ? placeTip(pos, size.w, size.h, window.innerWidth, window.innerHeight) : { left: 0, top: 0 };
  const style: CSSProperties = { left: 0, top: 0, transform: `translate(${left}px, ${top}px)`, visibility: size ? undefined : 'hidden' };
  return (
    <div ref={ref} className={className} style={style} role={role}>
      {children}
    </div>
  );
}

export function GanttTooltip({ row, at }: { row: Row; at: Point }) {
  const { task, r } = row;
  return (
    <FloatingTip at={at} className="gantt-tip" role="tooltip">
      <div className="tip-title">
        <span className="tip-id">#{task.id}</span> {task.name}
      </div>
      {r.summary ? (
        <div className="tip-sub">Major task · {plural(r.summary.tasks, 'task')}</div>
      ) : (
        task.assigned.length > 0 && <div className="tip-sub">{task.assigned.join(', ')}</div>
      )}
      <dl className="tip-facts">
        <dt>Planned</dt>
        <dd>
          {range(r.plannedStart, r.plannedFinish)} · {formatDays(r.plannedDuration)}
        </dd>
        <dt>{r.status === 'Completed' ? 'Actual' : 'Forecast'}</dt>
        <dd>{range(r.forecastStart, r.forecastFinish)}</dd>
        <dt>Progress</dt>
        <dd>
          {r.progress}% <StatusChip status={r.status} />
        </dd>
        <dt>Variance</dt>
        <dd className={r.variance > 0 ? 'text-late' : r.variance < 0 ? 'text-early' : undefined}>{formatVariance(r.variance)}</dd>
      </dl>
    </FloatingTip>
  );
}
