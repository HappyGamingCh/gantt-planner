// Gantt chart (SPEC §7.8): custom SVG, one lane per grid row. Plan mode: planned bars and arrows, bars drag to
// move or resize. Track mode: baseline, forecast/actual bars with progress, status-date line, the focused task's
// arrows. Click selects, double-click opens the drawer. Color by and the critical path are set in the header corner.
// Only the hovered bar's ID and the drag's day count are state here, and the layers are memoised, so moving the
// pointer re-renders the tooltip, not the 200 rows.
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { ColorBy } from '../../config';
import type { Calendar } from '../../engine/calendar';
import type { Holiday, ISODate, Project } from '../../engine/types';
import type { AssigneeInfo, Row } from '../../store/selectors';
import { openDrawer, select } from '../../store/store';
import type { Point } from './arrows';
import { barPaint, LABEL_DX, Links, MarkLabel, PlanMark, SummaryMark, TrackMark, type MarkProps } from './bars';
import { DragGhost, DragTip, useBarDrag } from './drag';
import { CORNER_RESERVE, GanttCorner } from './GanttCorner';
import { GanttTooltip } from './GanttTooltip';
import { fillScale, gridColumns, showsHolidays, showsWeekends, weekendDays, type GanttScale } from './scale';
import { Timeline } from './Timeline';
import './Gantt.css';

/** Room right of the range for labels after the last bars. */
export const LABEL_ROOM = 160;

/** Every date a row draws, for the visible range. */
export function rowDates(rows: Row[]): ISODate[] {
  return rows.flatMap(({ task, r }) => [r.plannedStart, r.plannedFinish, r.forecastStart, r.forecastFinish, ...(r.actualStart ? [r.actualStart] : []), ...(task.actualFinish ? [task.actualFinish] : [])]);
}

/** The task whose arrows are highlighted: the hovered bar's while its row is still shown, else the last selected. */
export function linkFocus(hoverId: number | null, rows: Row[], selection: number[]): number | null {
  return hoverId !== null && rows.some((row) => row.task.id === hoverId) ? hoverId : (selection.at(-1) ?? null);
}

/** Task ID of the lane or mark (`selector`) an event happened in: they carry it in data-row. */
function rowAt(target: EventTarget, selector = '[data-row]'): number | null {
  const el = target instanceof Element ? target.closest(selector) : null;
  return el ? Number(el.getAttribute('data-row')) : null;
}

interface Props {
  rows: Row[];
  mode: Project['mode'];
  scale: GanttScale;
  calendar: Calendar;
  rowHeight: number;
  statusDate: ISODate;
  today: ISODate;
  holidays: Holiday[];
  selection: number[];
  info: Map<string, AssigneeInfo>;
  colorBy: ColorBy;
  /** Critical path shown. */
  critical: boolean;
  /** Width of the Gantt pane: a narrower chart is drawn on to its right edge. */
  paneWidth: number;
}

export function Gantt({ rows, mode, scale, calendar, rowHeight, statusDate, today, holidays, selection, info, colorBy, critical, paneWidth }: Props) {
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [tipHidden, setTipHidden] = useState(false); // Esc hid the card until the pointer leaves the bar
  const pointer = useRef<Point>({ x: 0, y: 0 });
  const { drag, start } = useBarDrag(scale, calendar);
  // A range narrower than the pane: the lanes, grid lines and calendar go on to its right edge; the bars don't move.
  const width = Math.max(scale.width + LABEL_ROOM, paneWidth);
  const drawn = useMemo(() => fillScale(scale, width), [scale, width]);
  const height = rows.length * rowHeight;
  const visibleHolidays = useMemo(() => holidays.filter((h) => h.date >= drawn.start && drawn.x(h.date) < drawn.width), [holidays, drawn]);
  // Track mode already marks the status date; the today line only adds a second line when the dates differ. The line
  // runs through the middle of the day, so it must fall inside the chart (the drawn scale can run a day past it).
  const showToday = today >= drawn.start && scale.x(today) + scale.px / 2 < width && (mode === 'Plan' || today !== statusDate);
  const sdX = scale.x(statusDate) + scale.px;
  const hovered = hoverId === null ? undefined : rows.find((row) => row.task.id === hoverId);
  const dragIndex = drag ? rows.findIndex((row) => row.task.id === drag.row.task.id) : -1;
  const header = useMemo(
    () => (
      <Timeline scale={drawn} width={width} holidays={visibleHolidays} statusDate={mode === 'Track' ? statusDate : undefined} today={showToday ? today : undefined} rightInset={CORNER_RESERVE}>
        <GanttCorner />
      </Timeline>
    ),
    [drawn, width, visibleHolidays, mode, statusDate, showToday, today],
  );

  // Esc hides the hover card (WCAG 1.4.13) until the pointer leaves the bar; the same press still closes the drawer.
  useEffect(() => {
    if (hoverId === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTipHidden(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [hoverId]);

  // A drag follows the pointer outside the chart too; when it ends, the bar under the pointer (if any) takes the hover,
  // so the dragged task's card doesn't come back over another row.
  const dragging = drag !== null;
  const dragged = useRef(false);
  useEffect(() => {
    if (dragging) {
      dragged.current = true;
      const follow = (e: globalThis.PointerEvent) => {
        pointer.current = { x: e.clientX, y: e.clientY };
      };
      window.addEventListener('pointermove', follow);
      return () => window.removeEventListener('pointermove', follow);
    }
    if (!dragged.current) return;
    dragged.current = false;
    const el = document.elementFromPoint(pointer.current.x, pointer.current.y);
    setHoverId(el ? rowAt(el, '.gantt-chart .mark') : null);
    setTipHidden(false);
  }, [dragging]);

  // One handler each for the whole chart; lanes and marks carry their task ID.
  const onClick = (e: MouseEvent) => {
    const id = rowAt(e.target);
    if (id !== null) select(id, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'only', rows.map((row) => row.task.id));
  };
  const onDoubleClick = (e: MouseEvent) => {
    const id = rowAt(e.target);
    if (id !== null) openDrawer(id);
  };
  const onPointerMove = (e: PointerEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY };
    if (e.buttons !== 0) return; // a drag keeps the arrows it started with
    const id = rowAt(e.target, '.mark');
    if (id === hoverId) return;
    setHoverId(id);
    setTipHidden(false);
  };
  const onPointerLeave = () => {
    if (drag) return; // a drag that crosses into the grid keeps its arrows; where it ends sets the hover again
    setHoverId(null);
    setTipHidden(false);
  };

  return (
    <div className={drag ? `gantt dragging-${drag.kind}` : 'gantt'} style={{ width }}>
      {header}
      <svg
        className={`gantt-chart gantt-${mode.toLowerCase()}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Gantt chart, ${mode} mode`}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <Lanes rows={rows} rowHeight={rowHeight} width={width} drawn={drawn} holidays={visibleHolidays} selection={selection} />
        <Links rows={rows} mode={mode} rowHeight={rowHeight} scale={scale} focus={linkFocus(hoverId, rows, selection)} critical={critical} />
        <Marks rows={rows} mode={mode} rowHeight={rowHeight} scale={scale} colorBy={colorBy} info={info} critical={critical} selection={selection} dragIndex={dragIndex} onDragStart={mode === 'Plan' ? start : undefined} />
        {drag && dragIndex >= 0 && <DragGhost drag={drag} top={dragIndex * rowHeight} rowHeight={rowHeight} scale={scale} cal={calendar} />}
        {showToday && <line className="today-line" x1={scale.x(today) + scale.px / 2} x2={scale.x(today) + scale.px / 2} y1={0} y2={height} />}
        {/* The white halo under the dashes keeps the status-date line visible where it crosses a solid bar (§7.8). */}
        {mode === 'Track' && (
          <>
            <line className="sd-halo" x1={sdX} x2={sdX} y1={0} y2={height} />
            <line className="sd-line" x1={sdX} x2={sdX} y1={0} y2={height} />
          </>
        )}
        <Labels rows={rows} mode={mode} rowHeight={rowHeight} scale={scale} selection={selection} dragIndex={dragIndex} />
      </svg>
      {drag ? <DragTip drag={drag} cal={calendar} /> : hovered && !tipHidden && <GanttTooltip key={hovered.task.id} row={hovered} at={pointer.current} />}
    </div>
  );
}

/** Row lanes, holiday columns and grid lines, drawn over the whole width (`drawn`). */
const Lanes = memo(function Lanes({ rows, rowHeight, width, drawn, holidays, selection }: { rows: Row[]; rowHeight: number; width: number; drawn: GanttScale; holidays: Holiday[]; selection: number[] }) {
  const height = rows.length * rowHeight;
  const { weeks, days } = gridColumns(drawn);
  const vline = (i: number) => `M${i * drawn.px + 0.5},0V${height}`;
  return (
    <>
      <g className="lanes">
        {rows.map((row, i) => (
          <rect key={row.task.id} data-row={row.task.id} className={selection.includes(row.task.id) ? 'lane lane-selected' : row.r.summary ? 'lane lane-summary' : 'lane'} x={0} y={i * rowHeight} width={width} height={rowHeight} />
        ))}
      </g>
      {showsWeekends(drawn) && (
        <g className="weekends">
          {weekendDays(drawn).map((d) => (
            <rect key={d} x={d * drawn.px} y={0} width={drawn.px} height={height} />
          ))}
        </g>
      )}
      {showsHolidays(drawn) && (
        <g className="nonwork">
          {holidays.map((h) => (
            <rect key={h.date} x={drawn.x(h.date)} y={0} width={drawn.px} height={height} />
          ))}
        </g>
      )}
      <path className="grid-lines" d={[...days.map(vline), ...rows.map((_, i) => `M0,${(i + 1) * rowHeight - 0.5}H${width}`)].join('')} />
      <path className={drawn.detail === 'day' ? 'grid-lines grid-weeks' : 'grid-lines'} d={weeks.map(vline).join('')} />
    </>
  );
});

/** One bar or diamond per row; the dragged row's is faded, a selected row's has a white unfinished part (CSS). */
const Marks = memo(function Marks({
  rows,
  mode,
  rowHeight,
  scale,
  colorBy,
  info,
  critical,
  selection,
  dragIndex,
  onDragStart,
}: {
  rows: Row[];
  mode: Project['mode'];
  rowHeight: number;
  scale: GanttScale;
  colorBy: ColorBy;
  info: Map<string, AssigneeInfo>;
  critical: boolean;
  selection: number[];
  dragIndex: number;
  onDragStart: MarkProps['onDragStart'];
}) {
  const Mark = mode === 'Plan' ? PlanMark : TrackMark;
  return (
    <>
      {rows.map((row, i) => (
        <g key={row.task.id} data-row={row.task.id} className={['mark', i === dragIndex && 'mark-dragged', selection.includes(row.task.id) && 'mark-selected'].filter(Boolean).join(' ')}>
          {row.r.summary ? (
            <SummaryMark row={row} top={i * rowHeight} rowHeight={rowHeight} scale={scale} mode={mode} />
          ) : (
            <Mark row={row} top={i * rowHeight} rowHeight={rowHeight} scale={scale} paint={barPaint(row.task, colorBy, info)} critical={critical && row.r.critical === true} onDragStart={onDragStart} />
          )}
        </g>
      ))}
    </>
  );
});

/**
 * The labels right of the marks, above the status-date and today lines, clear of the arrows' elbows. Each carries its
 * task ID, so the row hover (RowHover) gives its halo the hovered lane's colour; the labels take no pointer events.
 */
const Labels = memo(function Labels({ rows, mode, rowHeight, scale, selection, dragIndex }: { rows: Row[]; mode: Project['mode']; rowHeight: number; scale: GanttScale; selection: number[]; dragIndex: number }) {
  return (
    <g className="labels">
      {rows.map((row, i) => (
        <g key={row.task.id} data-row={row.task.id} className={[selection.includes(row.task.id) && 'label-selected', i === dragIndex && 'mark-dragged'].filter(Boolean).join(' ') || undefined}>
          <MarkLabel row={row} mode={mode} top={i * rowHeight} rowHeight={rowHeight} scale={scale} dx={LABEL_DX} />
        </g>
      ))}
    </g>
  );
});
