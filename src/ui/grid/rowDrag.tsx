// Moving rows by dragging (SPEC §7.7): hold a row 0.4 s, or drag the grip left of its ID, then drag up or down; moving
// left or right picks the Level among those the place allows. A line shows where the row (with its tasks) will go.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { dropRow } from '../../store/outline';
import { dropLevels } from '../../store/outlineOps';
import { isFiltering, type Row } from '../../store/selectors';
import { showToast, useStore } from '../../store/store';
import { LEVEL_INDENT } from './outlineCells';

/** How long a press on a row starts a drag, and how far the pointer may move before that (a click or a scroll). */
const HOLD_MS = 400;
const SLOP_PX = 6;
/** The edge band of the grid pane that scrolls while dragging, and the most it scrolls per frame. */
const EDGE_PX = 32;
const EDGE_STEP = 14;

export interface RowDrag {
  id: number;
  /** The rows shown that move with it: the row and its tasks. */
  block: number[];
  /** Where it would go: before `beforeId` (null: the end), its first row at `level`; null when nowhere fits. */
  target: { beforeId: number | null; level: number; top: number } | null;
}

/** The place under `y` (grid coordinates) among the rows shown, the block left out, and the Level `dx` picks there. */
export function dropTarget(rows: readonly Row[], block: readonly number[], tops: readonly number[], rowHeight: number, y: number, rootLevel: number, depth: number, dx: number, collapsed: readonly number[]): RowDrag['target'] {
  const rest = rows.map((row, i) => ({ row, top: tops[i]! })).filter((x) => !block.includes(x.row.task.id));
  let g = rest.findIndex((x) => y < x.top + rowHeight / 2);
  if (g < 0) g = rest.length;
  const above = rest[g - 1];
  const below = rest[g];
  const range = dropLevels(above && { level: above.row.r.level, collapsed: above.row.r.summary !== undefined && collapsed.includes(above.row.task.id) }, below && { level: below.row.r.level }, depth);
  if (!range) return null;
  const level = Math.min(range.max, Math.max(range.min, rootLevel + Math.round(dx / LEVEL_INDENT)));
  return { beforeId: below?.row.task.id ?? null, level, top: below ? below.top : above ? above.top + rowHeight : 0 };
}

export function useRowDrag(rows: readonly Row[], root: RefObject<HTMLDivElement | null>, rowHeight: number) {
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const current = useRef<RowDrag | null>(null); // the drag as the window handlers see it
  const put = (d: RowDrag | null) => {
    current.current = d;
    setDrag(d);
  };
  const press = useRef<{ id: number; x: number; y: number; timer: number; pointer: number } | null>(null);
  const live = useRef<{ startX: number; rootLevel: number; depth: number; x: number; y: number } | null>(null);

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const begin = (id: number, x: number, y: number) => {
    cancelPress();
    if (isFiltering(useStore.getState().filters)) return showToast('Clear the search and filters to move rows by dragging');
    const i = rows.findIndex((row) => row.task.id === id);
    if (i < 0) return;
    const level = rows[i]!.r.level;
    let end = i + 1;
    while (end < rows.length && rows[end]!.r.level > level) end++;
    const block = rows.slice(i, end).map((row) => row.task.id);
    const depth = Math.max(...rows.slice(i, end).map((row) => row.r.level)) - level;
    live.current = { startX: x, rootLevel: level, depth, x, y };
    put({ id, block, target: null });
  };

  /** pointerdown on a row: the grip starts at once, elsewhere a hold does; editors and buttons keep their own. */
  const onPointerDown = (e: ReactPointerEvent, row: Row) => {
    const target = e.target as Element;
    if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.metaKey || target.closest('input, textarea, button, select, .cell-editing')) return;
    if (target.closest('[data-grip]')) {
      e.preventDefault();
      return begin(row.task.id, e.clientX, e.clientY);
    }
    const { clientX: x, clientY: y } = e;
    cancelPress();
    press.current = { id: row.task.id, x, y, pointer: e.pointerId, timer: window.setTimeout(() => begin(row.task.id, x, y), HOLD_MS) };
  };

  // A press that moves or ends before the hold is a click, a selection or a scroll.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP_PX) cancelPress();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', cancelPress);
    window.addEventListener('pointercancel', cancelPress);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', cancelPress);
      window.removeEventListener('pointercancel', cancelPress);
      cancelPress();
    };
  }, []);

  // While dragging: follow the pointer, scroll at the pane's edges, drop on release, Esc cancels.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const el = root.current;
    const pane = el?.closest<HTMLElement>('.pane-grid');
    if (!el) return;
    const update = () => {
      const l = live.current;
      if (!l) return;
      const tops = rows.map((row) => el.querySelector<HTMLElement>(`[data-row="${row.task.id}"]`)?.offsetTop ?? 0);
      const y = l.y - el.getBoundingClientRect().top;
      const d = current.current;
      if (d) put({ ...d, target: dropTarget(rows, d.block, tops, rowHeight, y, l.rootLevel, l.depth, l.x - l.startX, useStore.getState().collapsed) });
    };
    const move = (e: PointerEvent) => {
      if (live.current) [live.current.x, live.current.y] = [e.clientX, e.clientY];
      update();
    };
    let frame = 0;
    const scroll = () => {
      const l = live.current;
      const box = pane?.getBoundingClientRect();
      if (l && pane && box) {
        const step = l.y < box.top + EDGE_PX ? -EDGE_STEP : l.y > box.bottom - EDGE_PX ? EDGE_STEP : 0;
        if (step !== 0) {
          pane.scrollTop += step;
          update();
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    const stop = () => {
      live.current = null;
      put(null);
    };
    const up = () => {
      const d = current.current;
      stop();
      if (d?.target) dropRow(d.id, d.target.beforeId, d.target.level);
      el.focus({ preventScroll: true });
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation(); // the drawer stays open
      stop();
    };
    document.body.classList.add('row-dragging-on');
    update();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(frame);
      document.body.classList.remove('row-dragging-on');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
    };
  }, [dragging]);

  return { drag, onPointerDown };
}

/** The line where the row will go, indented to the Level it will get. */
export function DropLine({ drag, taskLeft }: { drag: RowDrag; taskLeft: number }) {
  if (!drag.target) return null;
  return <div className="row-drop-line" aria-hidden="true" style={{ top: drag.target.top - 1, left: taskLeft + (drag.target.level - 1) * LEVEL_INDENT }} />;
}
