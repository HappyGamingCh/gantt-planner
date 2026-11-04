// Grid keys outside editing (SPEC §7.7, §7.12), kept apart from the component so the rules can be tested without a
// DOM: what each key does to the active cell, where the active cell goes when its row goes, and what Delete leaves in a cell.
import type { Project } from '../../engine/types';
import { editTask, readOnlyReason, type EditField, type EditValue } from '../../store/edit';
import type { Row } from '../../store/selectors';
import { showToast } from '../../store/store';
import type { Column } from './columns';

export type GridKey = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>;

/** Where the keyboard is, in the rows and columns shown. */
export interface GridAt {
  /** The active cell (row −1 when its row is no longer shown), or null before a cell is active. */
  active: { row: number; col: number } | null;
  rows: number;
  cols: number;
  /** Row the selection ends on (−1 when it isn't shown): arrows come back there, Shift+↑/↓ extend from it. */
  focus: number;
  /** The active row is selected, and how many rows are. */
  selected: boolean;
  count: number;
  /** The active cell is the ID. */
  idCell: boolean;
  /** A drawer or panel is open: Esc closes it first (window shortcut). */
  overlay: boolean;
}

export type GridAction =
  | { kind: 'move'; row: number; col: number; extend?: boolean }
  | { kind: 'open' } // Enter / F2: edit the cell, or open the drawer on the ID or a calculated cell
  | { kind: 'type'; seed: string }
  | { kind: 'clear' }
  | { kind: 'leave' }; // Esc: no active cell, so Tab leaves the grid

/** Typing a character starts an edit seeded with it, except `/` and `?`: they are shortcuts (§7.12). */
export const startsTyping = (key: string): boolean => key.length === 1 && key !== '/' && key !== '?';

/** What a key does in the grid; null leaves it to the browser (Tab out of the grid) and the window shortcuts. */
export function gridKey(e: GridKey, at: GridAt): GridAction | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  if (!at.active) return e.key.startsWith('Arrow') && at.rows > 0 ? { kind: 'move', row: Math.max(0, at.focus), col: 1 } : null;
  const { row: r, col: c } = at.active;
  const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
  // Shift+↑/↓ extends the selection, as in Excel; from the selection's end when the active row isn't in it.
  if (step !== 0 && e.shiftKey) return { kind: 'move', row: (at.selected || at.focus < 0 ? r : at.focus) + step, col: c, extend: true };
  if (step !== 0) return { kind: 'move', row: r + step, col: c };
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return { kind: 'move', row: r, col: c + (e.key === 'ArrowLeft' ? -1 : 1) };
  if (e.key === 'Tab') {
    const next = c + (e.shiftKey ? -1 : 1);
    return next < 0 || next >= at.cols ? null : { kind: 'move', row: r, col: next }; // the row ends: Tab leaves the grid
  }
  if (e.key === 'F2' && e.shiftKey) return null; // opens the task details (window shortcut)
  if (e.key === 'Enter' || e.key === 'F2') return { kind: 'open' };
  // Delete clears the cell; on the ID cell or with several rows selected it deletes the tasks (window shortcut).
  if (e.key === 'Delete' || e.key === 'Backspace') return at.idCell || at.count > 1 ? null : { kind: 'clear' };
  if (e.key === 'Escape') return at.overlay ? null : { kind: 'leave' };
  return startsTyping(e.key) ? { kind: 'type', seed: e.key } : null;
}

/**
 * An editor is open but the grid kept the focus (its box couldn't take it): keys meant for the editor are held back,
 * so a window shortcut (Delete, `/`) never acts on the task being edited.
 */
export const heldWhileEditing = (e: GridKey): boolean =>
  e.key === 'Delete' || e.key === 'Backspace' || (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey);

export interface GridCell {
  id: number;
  col: Column['key'];
}

/** The active cell while the search or filters hide its row, and the cell standing in for it. */
export interface HiddenCell {
  cell: GridCell;
  stand: GridCell | null;
}

/** Where the active cell goes (`next`; undefined: it stays), what is kept for later, and the row it was last on. */
export interface Kept {
  next?: GridCell | null;
  hidden: HiddenCell | null;
  lastRow: number;
}

/**
 * When the active row is no longer shown the keyboard stays in place (§7.7): the row now there, same column (Task when
 * the column is hidden). A row the search or filters only hide gets the active cell back when it shows again, unless
 * the user moved on meanwhile; a deleted row doesn't. `exists`: the task is still in the plan.
 */
export function keepActive(
  active: GridCell | null,
  hidden: HiddenCell | null,
  lastRow: number,
  order: readonly number[],
  cols: readonly Column['key'][],
  exists: (id: number) => boolean,
): Kept {
  let held = hidden && active === hidden.stand && exists(hidden.cell.id) ? hidden : null;
  if (held && order.includes(held.cell.id)) return { next: held.cell, hidden: null, lastRow };
  if (!active) return { hidden: held, lastRow };
  const i = order.indexOf(active.id);
  const col = cols.includes(active.col) ? active.col : 'task';
  if (i >= 0 && col === active.col) return { hidden: held, lastRow: i };
  const id = i >= 0 ? active.id : order[Math.min(lastRow, order.length - 1)];
  const next = id === undefined ? null : { id, col };
  if (i < 0 && exists(active.id)) held = { cell: held?.cell ?? active, stand: next };
  return { next, hidden: held, lastRow: i >= 0 ? i : lastRow };
}

/** Fields Delete can blank, and their blank value (a blank Planned Start follows Project Start). */
const BLANK: Partial<Record<EditField, EditValue>> = { assigned: [], predecessorsText: '', plannedStart: '', actualStart: '', actualFinish: '', remarks: '' };

/**
 * Delete / Backspace on the active cell (§7.12), as in Excel: blanks the field through the edit rules of §8 (one undo
 * step; clearing Actual Finish puts progress at 99), or says why the cell can't be cleared.
 */
export function clearCell(row: Row, c: Column, mode: Project['mode']): void {
  if (!c.field || !c.editor) return showToast("Calculated — this cell can't be cleared.");
  const reason = readOnlyReason(c.field, row.task, row.r, mode);
  if (reason) return showToast(reason);
  if (!(c.field in BLANK)) return showToast(`${c.key === 'task' ? 'Task name' : c.header(mode)} can't be blank — press Ctrl+Delete to delete the task.`);
  editTask(row.task.id, c.field, BLANK[c.field]);
}
