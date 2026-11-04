// Shared parts of the in-cell editors (SPEC §7.7): their props, the keys that end an edit, and the box a popover or
// hint floats in next to its cell.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Task } from '../../engine/types';
import type { EditValue } from '../../store/edit';
import type { Row } from '../../store/selectors';
import type { Column } from './columns';
import { floatingPosition, floatingState } from './editing';
import { setPendingEdit } from './pendingEdit';

export type Move = 'down' | 'right' | 'left';

export interface EditorProps {
  column: Column;
  row: Row;
  /** A typed character that started the edit; it replaces the value. */
  seed?: string;
  /** The cell when the edit started (the popovers then follow the cell itself). */
  anchor: DOMRect;
  tasks: readonly Task[];
  suggestions: readonly string[];
  /** `undefined`: nothing to save; the edit just ends (and moves). */
  onCommit: (value: EditValue, move?: Move) => void;
  onCancel: () => void;
}

/** Ends an edit once: `finish` saves, `cancel` drops it. `keys`: Enter, Tab, Esc; a `null` value keeps the editor open. */
export function useFinish(onCommit: EditorProps['onCommit'], onCancel: () => void) {
  const done = useRef(false);
  const finish = (value: EditValue, move?: Move) => {
    if (done.current) return;
    done.current = true;
    onCommit(value, move);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };
  const keys = (e: KeyboardEvent, value: () => EditValue | null) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const v = value();
      if (v !== null) finish(v, e.key === 'Enter' ? 'down' : e.shiftKey ? 'left' : 'right');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };
  return { finish, cancel, keys, ended: () => done.current };
}

interface FloatingProps {
  anchor: DOMRect;
  className: string;
  role?: string;
  label?: string;
  id?: string;
  children: ReactNode;
  /** A popover: a click outside it, Ctrl+S or Ctrl+O ends the edit. */
  onLeave?: () => void;
  /** The cell scrolled out of the grid; without it the box hides until the cell is back. */
  onAnchorLost?: () => void;
}

/**
 * A box fixed next to the cell, outside the grid's clipping: under it, or above when it only fits there. It
 * follows the cell while the grid scrolls. Clicks inside don't reach the cell under it.
 */
export function Floating({ anchor, className, role, label, id, children, onLeave, onAnchorLost }: FloatingProps) {
  const marker = useRef<HTMLSpanElement>(null); // in the cell, so the box can find it
  const box = useRef<HTMLDivElement>(null);
  // Unseen until placed, but not visibility:hidden: the editor's autoFocus runs before place() and needs a focusable box.
  const [style, setStyle] = useState<CSSProperties>({ left: anchor.left, top: anchor.bottom + 4, opacity: 0, pointerEvents: 'none' });
  const leave = useRef(onLeave);
  leave.current = onLeave;
  const lost = useRef(onAnchorLost);
  lost.current = onAnchorLost;

  useLayoutEffect(() => {
    // `moved`: a scroll or resize, the only thing that can take the cell away (floatingState).
    const place = (moved: boolean) => {
      const el = box.current;
      const cell = marker.current?.parentElement;
      if (!el || !cell) return;
      const a = cell.getBoundingClientRect();
      const state = floatingState(a, cell.closest('.pane-grid')?.getBoundingClientRect(), moved, lost.current !== undefined);
      if (state === 'lost') lost.current?.();
      else if (state === 'hide') setStyle((s) => ({ ...s, visibility: 'hidden' }));
      else if (state === 'place') setStyle(floatingPosition(a, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight));
    };
    const follow = () => place(true);
    place(false);
    const observer = new ResizeObserver(() => place(false));
    if (box.current) observer.observe(box.current);
    window.addEventListener('scroll', follow, true); // capture: the grid and Gantt panes scroll, not the window
    window.addEventListener('resize', follow);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, []);

  const leaves = onLeave !== undefined;
  useEffect(() => {
    if (!leaves) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) leave.current?.();
    };
    document.addEventListener('pointerdown', onDown, true);
    const unregister = setPendingEdit(() => leave.current?.()); // Ctrl+S / Ctrl+O first finish the popover like a click outside
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      unregister();
    };
  }, [leaves]);

  return (
    <>
      <span ref={marker} hidden />
      {createPortal(
        <div
          ref={box}
          id={id}
          className={className}
          role={role}
          aria-label={label}
          style={style}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
