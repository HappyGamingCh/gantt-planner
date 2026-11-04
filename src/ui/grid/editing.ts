// Pure parts of the in-cell editors (SPEC §7.7): where a popover sits next to its cell, and how a typed date is checked
// (typed numbers are checked in common/numbers.ts). No DOM, so they are unit-tested.
import { TIMELINE_HEIGHT } from '../../config';
import { isPlanDate } from '../../engine/dates';
import { DATE_RANGE_MESSAGE } from '../../store/rules';

export interface Box {
  top: number;
  bottom: number;
  left: number;
}

/**
 * Popover position (fixed): under the cell, or above it when it doesn't fit below and does above. Above is set
 * with `bottom`, so a popover that grows (chips added) grows away from its cell. Kept 8 px inside the window.
 */
export function floatingPosition(cell: Box, width: number, height: number, viewWidth: number, viewHeight: number): { left: number; top?: number; bottom?: number } {
  const left = Math.max(8, Math.min(cell.left, viewWidth - width - 8));
  const fitsBelow = cell.bottom + 4 + height <= viewHeight - 8;
  const fitsAbove = cell.top - 4 - height >= 8;
  return fitsBelow || !fitsAbove ? { left, top: cell.bottom + 4 } : { left, bottom: viewHeight - cell.top + 4 };
}

/**
 * What a box does when it is placed: follow its cell while the cell is in the grid pane (below the timeline header).
 * Once a scroll or resize (`moved`) takes the cell out, a popover ends ('lost') and a hint hides. Opening or growing
 * never ends an edit: the box waits, unseen, until the cell is back.
 */
export function floatingState(cell: Box, pane: { top: number; bottom: number } | undefined, moved: boolean, endsWhenLost: boolean): 'place' | 'lost' | 'hide' | 'wait' {
  // Rows start under the header and its 1 px rule (Grid.css .grid-head: --timeline-h + 1px).
  if (!pane || (cell.bottom > pane.top + TIMELINE_HEIGHT + 1 && cell.top < pane.bottom)) return 'place';
  if (!moved) return 'wait';
  return endsWhenLost ? 'lost' : 'hide';
}

/**
 * Why the grid's date editor can't save (§7.7): only 1950–2199, and never a half-typed date (`halfTyped`: some parts
 * set, so the input reads as ''). With every part cleared the input is blank, not half typed, and '' clears the cell.
 */
export function dateEditProblem(value: string, halfTyped: boolean): string | undefined {
  if (halfTyped) return 'Enter a complete date, or clear every part';
  return value !== '' && !isPlanDate(value) ? DATE_RANGE_MESSAGE : undefined; // the store refuses it too: same words
}
