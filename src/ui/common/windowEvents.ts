// Window-level behaviour: keyboard shortcuts (SPEC §7.12), drop-to-open (§3.5), unsaved guard (§7.11).
import { useEffect, useState } from 'react';
import { addTask, deleteSelected, linkSelected, moveSelected } from '../../store/edit';
import { openDropped, openPicked, save, saveAs } from '../../store/files';
import { indentSelected, outdentSelected, setCollapsedOf } from '../../store/outline';
import { closeDrawer, closePanel, closeView, openDrawer, openPrint, useStore, type Dialog } from '../../store/store';
import { redo, undo } from '../../store/undo';
import { flushPendingEdit } from '../grid/pendingEdit';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Finishes an edit in progress before a shortcut acts on the plan: inline editors and drawer fields save when they
 * lose focus, the grid's popover editors (Assigned, Progress) when flushed.
 */
function finishEdit() {
  if (isTyping(document.activeElement)) (document.activeElement as HTMLElement).blur();
  flushPendingEdit();
}

export type ShortcutKey = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>;

/**
 * The key a shortcut matches, lower case. With Ctrl, a non-Latin layout reports its own character (Thai: Ctrl+S
 * arrives as 'ห', Ctrl+Shift+Z as '('), so a letter key falls back to its physical position, as in Excel and the
 * browser. AltGr (Ctrl+Alt) keeps the character it types; `/` and `?` always match the character typed.
 */
export function shortcutKey(e: ShortcutKey): string {
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !/^[a-z]$/.test(key) && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  return key;
}

/** Dialogs Ctrl+S / Ctrl+O may act over: file problems (Save retries) and help, where nothing typed can be lost. */
const FILE_SHORTCUTS_OK: ReadonlySet<Dialog['kind']> = new Set<Dialog['kind']>(['conflict', 'failed', 'missing', 'unreadable', 'buildFailed', 'denied', 'unsupported', 'shortcuts', 'about', 'error']);

/** Ctrl+S / Ctrl+Shift+S / Ctrl+O never close a form or a confirmation and drop what it holds (a new dialog is safe). */
export const fileShortcutsAllowed = (dialog: Dialog | null): boolean => !dialog || FILE_SHORTCUTS_OK.has(dialog.kind);

/**
 * §7.12: Ctrl+S / Ctrl+Shift+S / Ctrl+O, Ctrl+P (Print Gantt), undo and redo, Ctrl+Enter, Delete, Alt+↑/↓, Alt+Shift+←/→ (Outdent / Indent),
 * Alt+Shift+−/= (collapse / expand), Ctrl+L, Shift+F2, /, Esc, ?.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { plan, dialog, drawerId, panel, view, selection } = useStore.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = shortcutKey(e);
      const run = (action: () => void) => {
        e.preventDefault();
        action();
      };
      // The browser's own Save page / Open file never shows; over a form or confirmation the keys do nothing.
      if (ctrl && !e.altKey && key === 's') {
        return run(() => {
          if (!plan || !fileShortcutsAllowed(dialog)) return;
          finishEdit();
          void (e.shiftKey ? saveAs() : save());
        });
      }
      if (ctrl && !e.altKey && !e.shiftKey && key === 'o') {
        return run(() => {
          if (!fileShortcutsAllowed(dialog)) return;
          finishEdit(); // so the unsaved-changes guard sees the edit
          openPicked();
        });
      }
      // Print Gantt (§9.4) in place of the browser printing the main view; the report and Print Gantt pages print
      // with the browser's own Ctrl+P.
      if (ctrl && !e.altKey && !e.shiftKey && key === 'p' && plan && view === 'main') {
        return run(() => {
          if (dialog) return;
          finishEdit();
          openPrint();
        });
      }
      // A key the grid or an editor already used (typing, Delete clearing a cell) is not a shortcut too.
      if (e.defaultPrevented || !plan || dialog || isTyping(e.target)) return;
      if (view !== 'main') {
        if (key === 'escape') run(closeView);
        return;
      }
      if (ctrl && key === 'z') return run(e.shiftKey ? redo : undo);
      if (ctrl && key === 'y') return run(redo);
      if (ctrl && key === 'enter') return run(addTask);
      if (ctrl && key === 'l') return run(linkSelected);
      if (ctrl && !e.altKey && key === 'delete') return run(deleteSelected);
      if (e.altKey && e.shiftKey && (key === 'arrowleft' || key === 'arrowright')) return run(key === 'arrowright' ? indentSelected : outdentSelected);
      // By the physical key, as Shift turns − and = into _ and + on most layouts.
      const fold = e.code === 'Minus' || e.code === 'NumpadSubtract' ? true : e.code === 'Equal' || e.code === 'NumpadAdd' ? false : undefined;
      if (e.altKey && e.shiftKey && fold !== undefined) {
        const id = selection.at(-1);
        return id === undefined ? undefined : run(() => setCollapsedOf(id, fold));
      }
      if (e.altKey && (key === 'arrowup' || key === 'arrowdown')) return run(() => moveSelected(key === 'arrowup' ? -1 : 1));
      if (ctrl || e.altKey) return;
      if (key === 'delete') return run(deleteSelected);
      if (key === 'f2' && e.shiftKey) {
        const id = selection.at(-1);
        return id === undefined ? undefined : run(() => openDrawer(id, { focus: true }));
      }
      if (key === '/') return run(() => document.getElementById('task-search')?.focus());
      if (key === '?') return run(() => useStore.setState({ dialog: { kind: 'shortcuts' } }));
      if (key === 'escape' && (drawerId !== null || panel)) return run(drawerId !== null ? closeDrawer : closePanel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** The browser asks before leaving while there are unsaved changes. */
export function useUnsavedGuard(): void {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}

/** Opens a file dropped anywhere on the window; true while files are dragged over it. */
export function useDropToOpen(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      finishEdit(); // so the unsaved-changes guard sees the edit
      openDropped(e.dataTransfer!);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
  return dragging;
}
