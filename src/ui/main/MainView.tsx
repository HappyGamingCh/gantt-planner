// Main view (SPEC §7.3): header, KPI strip, toolbar, then the grid and the Gantt side by side, sharing the vertical
// scroll. A splitter sets the grid width. The drawer and the Issues panel slide over the Gantt side.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { GRID_WIDTH, ROW_HEIGHTS, TIMELINE_HEIGHT } from '../../config';
import { createCalendar } from '../../engine/calendar';
import type { ComputeResult, Plan } from '../../engine/types';
import { assigneeInfo, assigneeNames, rowsOf, shownRows } from '../../store/selectors';
import { setGridWidth, todayISO, useStore } from '../../store/store';
import { TaskDrawer } from '../drawer/TaskDrawer';
import { Gantt, LABEL_ROOM, rowDates } from '../gantt/Gantt';
import { ganttRange, makeScale, type GanttScale } from '../gantt/scale';
import { Grid } from '../grid/Grid';
import { autoGridWidth, columnsWidth, visibleColumns } from '../grid/columns';
import { GRID_ID } from '../common/focus';
import { Header } from '../header/Header';
import { IssuesPanel } from '../issues/IssuesPanel';
import { KpiStrip } from '../kpi/KpiStrip';
import { Toolbar } from '../toolbar/Toolbar';
import { EmptyPlan } from './EmptyPlan';
import { RowHover } from './RowHover';
import { keepCentre, quarterIn, revealLeft } from './scroll';
import './MainView.css';

/** `hidden` while the report shows: it stays mounted, so its scroll and active cell are there on Back (§9.1). */
export function MainView({ hidden = false }: { hidden?: boolean }) {
  const plan = useStore((s) => s.plan);
  const result = useStore((s) => s.result);
  const density = useStore((s) => s.density);
  const main = useRef<HTMLDivElement>(null);
  useFocusOnReturn(main, hidden);
  if (!plan || !result) return null;
  return (
    // mode-plan re-points --head-bg (tokens.css): the grid header row and the timeline band turn violet (§7.1, §7.3).
    <div ref={main} className={`main mode-${plan.project.mode.toLowerCase()}`} hidden={hidden} style={{ '--row-h': `${ROW_HEIGHTS[density]}px`, '--timeline-h': `${TIMELINE_HEIGHT}px` } as CSSProperties}>
      {/* First Tab stop (§10): skips the header and toolbar, about 20 stops, straight to the task grid. */}
      <a
        className="skip-link"
        href={`#${GRID_ID}`}
        onClick={(e) => {
          e.preventDefault(); // no hash change, no jump of the panes
          document.getElementById(GRID_ID)?.focus();
        }}
      >
        Skip to task grid
      </a>
      <Header />
      <KpiStrip plan={plan} result={result} />
      <Toolbar plan={plan} />
      <Workspace plan={plan} result={result} />
    </div>
  );
}

function Workspace({ plan, result }: { plan: Plan; result: ComputeResult }) {
  const selection = useStore((s) => s.selection);
  const zoom = useStore((s) => s.zoom);
  const panel = useStore((s) => s.panel);
  const drawerId = useStore((s) => s.drawerId);
  const session = useStore((s) => s.session);
  const reveal = useStore((s) => s.reveal);
  const filters = useStore((s) => s.filters);
  const pinned = useStore((s) => s.pinned);
  const gridWidth = useStore((s) => s.gridWidth);
  const columns = useStore((s) => s.columns);
  const colorBy = useStore((s) => s.colorBy);
  const critical = useStore((s) => s.critical);
  const rowHeight = ROW_HEIGHTS[useStore((s) => s.density)];
  const workspace = useRef<HTMLElement>(null);
  const gridPane = useRef<HTMLDivElement>(null);
  const ganttPane = useRef<HTMLDivElement>(null);
  const ganttWidth = useWidth(ganttPane);
  const workspaceWidth = useWidth(workspace);

  const { project } = plan;
  // §7.3: the grid fits its visible columns (up to 60 % of the window) until the splitter sets a width for this mode.
  const paneWidth = gridWidth[project.mode] ?? autoGridWidth(columnsWidth(visibleColumns(columns[project.mode])), workspaceWidth);
  const all = useMemo(() => rowsOf(plan, result), [plan, result]);
  const collapsed = useStore((s) => s.collapsed);
  const rows = useMemo(() => shownRows(all, filters, pinned, collapsed), [all, filters, pinned, collapsed]);
  const info = useMemo(() => assigneeInfo(plan), [plan]);
  const suggestions = useMemo(() => assigneeNames(plan), [plan]);
  const calendar = useMemo(() => createCalendar(plan.holidays.map((h) => h.date)), [plan.holidays]);
  const range = useMemo(() => ganttRange(rowDates(all), project.statusDate, calendar), [all, project.statusDate, calendar]);
  const scale = useMemo(() => makeScale(range.start, range.end, zoom, Math.max(200, ganttWidth - LABEL_ROOM)), [range, zoom, ganttWidth]);

  // Another file or a new plan (session + 1) starts at the first row and column: the panes stay mounted, so they'd
  // keep the last file's scroll. The Grid is keyed by session, so its active cell and editor go too. The Gantt's
  // horizontal position is the next effect's.
  useLayoutEffect(() => {
    gridPane.current?.scrollTo({ top: 0, left: 0 });
    ganttPane.current?.scrollTo({ top: 0 });
  }, [session]);

  // On open and mode change, show the status date (Track) or the project start (Plan). A zoom change keeps the date
  // at the centre of the pane in view; from a view with nothing to scroll (Fit) it goes to SD / project start too.
  // Not on every recompute, so the user's own scrolling isn't undone.
  const target = project.mode === 'Track' ? project.statusDate : result.summary.plannedStart;
  const measured = ganttWidth > 0;
  const lastLeft = useRef(0); // the pane's scrollLeft as onScroll last saw it: a zoom-out clamps it before the effect runs
  const shown = useRef<{ scale: GanttScale; session: typeof session; mode: typeof project.mode; measured: boolean } | null>(null); // before this render
  useLayoutEffect(() => {
    const pane = ganttPane.current;
    const before = shown.current;
    if (!pane) return;
    const zoomOnly = before !== null && before.session === session && before.mode === project.mode && before.measured === measured;
    const couldScroll = before !== null && before.scale.width + LABEL_ROOM > pane.clientWidth + 1;
    pane.scrollLeft = zoomOnly && couldScroll ? keepCentre(before.scale, scale, lastLeft.current, pane.clientWidth) : quarterIn(scale.x(target), pane.clientWidth);
  }, [session, zoom, project.mode, measured]);
  useLayoutEffect(() => {
    shown.current = { scale, session, mode: project.mode, measured }; // after the effect above, which needs the old scale
  });

  // Bring the focused task into view when asked (Issues panel, successors), not on every selection.
  useEffect(() => {
    const pane = ganttPane.current;
    const i = rows.findIndex((row) => row.task.id === selection.at(-1));
    if (!reveal || !pane || i < 0) return;
    pane.scrollTop = Math.max(0, i * rowHeight - pane.clientHeight / 3);
    pane.scrollLeft = revealLeft(rows[i]!.r, project.mode, scale, pane.clientWidth); // the bar as drawn in this mode
  }, [reveal]);

  // The panes scroll together vertically (the grid can scroll itself to keep its active cell in view).
  const follow = (from: RefObject<HTMLDivElement | null>, to: RefObject<HTMLDivElement | null>) => () => {
    if (from.current && to.current && to.current.scrollTop !== from.current.scrollTop) to.current.scrollTop = from.current.scrollTop;
  };

  return (
    <main className="workspace" ref={workspace}>
      <div
        className="pane pane-grid"
        ref={gridPane}
        style={{ width: paneWidth }}
        onScroll={follow(gridPane, ganttPane)}
        onWheel={(e) => {
          if (ganttPane.current && e.deltaY) ganttPane.current.scrollTop += e.deltaY;
        }}
      >
        <Grid key={session} rows={rows} tasks={plan.tasks} mode={project.mode} shown={columns[project.mode]} info={info} suggestions={suggestions} selection={selection} />
        {rows.length === 0 && all.length > 0 && <p className="no-match">No task matches the search or filters.</p>}
        {all.length === 0 && <EmptyPlan mode={project.mode} />}
      </div>
      <Splitter width={paneWidth} onChange={(width) => setGridWidth(project.mode, width)} onFit={() => setGridWidth(project.mode, null)} />
      <div
        className="pane pane-gantt"
        ref={ganttPane}
        onScroll={(e) => {
          lastLeft.current = e.currentTarget.scrollLeft;
          follow(ganttPane, gridPane)();
        }}
      >
        <Gantt
          rows={rows}
          mode={project.mode}
          scale={scale}
          calendar={calendar}
          rowHeight={rowHeight}
          statusDate={project.statusDate}
          today={todayISO()}
          holidays={plan.holidays}
          selection={selection}
          info={info}
          colorBy={colorBy}
          critical={critical}
          paneWidth={ganttWidth}
        />
      </div>
      <RowHover root={workspace} />
      {drawerId !== null && <TaskDrawer plan={plan} result={result} suggestions={suggestions} order={rows.map((row) => row.task.id)} />}
      {drawerId === null && panel === 'issues' && <IssuesPanel />}
    </main>
  );
}

/** Width of an element, kept up to date. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 0 = hidden under the report: keep the last width, so nothing re-lays out or scrolls back on return.
    const update = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Back from the report: the grid gets the focus again, so the keyboard carries on from its active cell. */
function useFocusOnReturn(main: RefObject<HTMLElement | null>, hidden: boolean): void {
  const wasHidden = useRef(hidden);
  useEffect(() => {
    if (wasHidden.current && !hidden) main.current?.querySelector<HTMLElement>('.grid')?.focus({ preventScroll: true });
    wasHidden.current = hidden;
  }, [main, hidden]);
}

const clamp = (w: number) => Math.min(GRID_WIDTH.max, Math.max(GRID_WIDTH.min, w));

/** Draggable divider between grid and Gantt; arrow keys move it too. Double-click or Enter fits the columns again. */
function Splitter({ width, onChange, onFit }: { width: number; onChange: (width: number) => void; onFit: () => void }) {
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    const startX = e.clientX;
    // Captured: the cursor and colour hold however fast the pointer moves, and a release anywhere ends the drag.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone; the window listeners still end the drag
    }
    setDragging(true);
    const move = (ev: globalThis.PointerEvent) => onChange(clamp(width + ev.clientX - startX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDragging(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); // the page doesn't scroll as well
      onChange(clamp(width + (e.key === 'ArrowLeft' ? -24 : 24)));
    } else if (e.key === 'Enter') onFit();
  };
  return (
    <div
      className={dragging ? 'splitter dragging' : 'splitter'}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the task grid"
      title="Drag to resize · double-click to fit the columns"
      aria-valuenow={width}
      aria-valuetext={`${Math.round(width)} px`}
      aria-valuemin={GRID_WIDTH.min}
      aria-valuemax={GRID_WIDTH.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onFit}
    />
  );
}
