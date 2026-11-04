// Horizontal scroll of the Gantt pane (SPEC §7.8): where it goes on open, on a zoom change and to reveal a task.
// Pure functions.
import { toDayNumber } from '../../engine/dates';
import type { TaskResult } from '../../engine/types';
import { span } from '../gantt/bars';
import type { GanttScale } from '../gantt/scale';

/**
 * Least room kept left of `x`: the Status chip (105 px, centred on the status date's line) then starts right of a
 * month name stuck at the pane's left edge ("Sep 2026", 6–66 px), so a narrow pane doesn't open with it covered.
 */
const MIN_INSET = 130;

/** scrollLeft that puts chart position `x` a quarter of the way into a `paneWidth` pane, and at least MIN_INSET in. */
export const quarterIn = (x: number, paneWidth: number): number => Math.max(0, x - Math.max(paneWidth / 4, MIN_INSET));

/** scrollLeft that shows a task's mark as this mode draws it: the planned bar in Plan mode, the forecast/actual bar in Track. */
export function revealLeft(r: TaskResult, mode: 'Plan' | 'Track', scale: GanttScale, paneWidth: number): number {
  return quarterIn(span(r, mode, scale).x0, paneWidth);
}

/** scrollLeft after the scale changes from `old` (scrolled to `left`) to `next` that keeps the same date at the pane's centre. */
export function keepCentre(old: GanttScale, next: GanttScale, left: number, paneWidth: number): number {
  const centre = toDayNumber(old.start) + (left + paneWidth / 2) / old.px; // in days, with the fraction
  return Math.max(0, (centre - toDayNumber(next.start)) * next.px - paneWidth / 2);
}
