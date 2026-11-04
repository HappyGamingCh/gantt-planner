// Keyboard focus for dialogs, menus and segmented controls (SPEC §10: all actions reachable by keyboard, visible focus).

/** Id of the task grid: where focus goes when the control that had it is gone, and the skip link's target. */
export const GRID_ID = 'task-grid';

/**
 * After a dialog closes: if focus fell to <body> (the control that opened it is gone or disabled, e.g. a menu item
 * or the Delete button once nothing is selected), put it back on that control, else on the task grid, so keyboard
 * work goes on where it was.
 */
export function restoreFocus(opener: Element | null): void {
  requestAnimationFrame(() => {
    if (document.activeElement && document.activeElement !== document.body) return; // something took it on purpose
    // <body> had focus when the dialog opened (just after a file opened, or a menu closed by a click elsewhere):
    // that is no place to go back to, so the grid takes it.
    const back = opener instanceof HTMLElement && opener !== document.body && opener.isConnected ? opener : null;
    back?.focus({ preventScroll: true });
    if (back && document.activeElement === back) return;
    document.getElementById(GRID_ID)?.focus({ preventScroll: true });
  });
}

/**
 * Whether an Esc keydown is an open menu's or popover's to close it: not when something nearer took it
 * (defaultPrevented), nor when a dialog opened on top of it (a shortcut pressed while it was open), whose Esc it is.
 */
export function popupTakesEscape(e: Pick<KeyboardEvent, 'key' | 'defaultPrevented'>, popup: Node | null, openDialog: Node | null): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented) return false;
  return !openDialog || openDialog.contains(popup);
}

/**
 * Arrow-key focus in a list of `count` items (menu, segmented control): the index ↓/→ (next), ↑/← (previous),
 * Home or End moves to from `index`, wrapping at the ends; -1 = nothing focused yet. Null for any other key.
 */
export function moveIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return index < 0 ? 0 : (index + 1) % count;
    case 'ArrowUp':
    case 'ArrowLeft':
      return index < 0 ? count - 1 : (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
