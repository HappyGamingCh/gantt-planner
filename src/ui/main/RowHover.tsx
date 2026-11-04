// Row hover (SPEC §7.7): the row under the pointer is highlighted in the grid and in the Gantt together, so a row can
// be followed across the splitter. Grid rows, Gantt lanes and bars carry their task ID in data-row; one style rule
// highlights that row in both panes, so a hover re-renders neither the grid nor the chart.
import { useEffect, useState, type RefObject } from 'react';

/** The style rule that highlights one row in both panes; a selected row keeps its own colour. The Gantt label's halo
 * follows its lane's colour, so it shows no white patch on the hovered band. */
export function rowHoverCss(id: number): string {
  return `.pane-grid .grid-row[data-row="${id}"]:not(.selected){background:var(--surface-2)}.pane-gantt .lane[data-row="${id}"]:not(.lane-selected){fill:var(--surface-2)}.pane-gantt .labels [data-row="${id}"]:not(.label-selected) .bar-label{stroke:var(--surface-2)}`;
}

/** Watches the pointer over `root` (the workspace) and highlights the row under it. */
export function RowHover({ root }: { root: RefObject<HTMLElement | null> }) {
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const find = (target: EventTarget | null) => {
      const row = target instanceof Element && el.contains(target) ? Number(target.closest('[data-row]')?.getAttribute('data-row')) : NaN;
      setId(Number.isInteger(row) ? row : null); // the header, empty space, the drawer: no row
    };
    const over = (e: PointerEvent) => {
      if (e.buttons === 0) find(e.target); // a bar or splitter drag keeps the row it started on...
    };
    const up = (e: PointerEvent) => find(document.elementFromPoint(e.clientX, e.clientY)); // ...until it ends
    const leave = () => setId(null);
    el.addEventListener('pointerover', over);
    el.addEventListener('pointerleave', leave);
    window.addEventListener('pointerup', up);
    return () => {
      el.removeEventListener('pointerover', over);
      el.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointerup', up);
    };
  }, [root]);
  return id === null ? null : <style>{rowHoverCss(id)}</style>;
}
