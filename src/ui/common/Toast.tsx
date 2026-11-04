import { useEffect, useState } from 'react';
import { dismissToast, useStore, type Toast } from '../../store/store';
import { restoreFocus } from './focus';

/** How long a toast stays (SPEC §7.11); the time starts again when the pointer or focus leaves it. */
export const TOAST_MS = 4000;

/**
 * What keeps a toast up, by toast id: the pointer on it, focus in it. Each is let go on its own, so a pointer passing
 * over and off the toast can't start the timer while the keyboard is on its Undo or Review.
 */
export interface ToastHolds {
  hover: number | null;
  focus: number | null;
}

export const toastHeld = (holds: ToastHolds, id: number): boolean => holds.hover === id || holds.focus === id;

/**
 * Shows the current toast for 4 s (SPEC §7.11), longer while it is hovered or focused, so Undo or Review can't vanish
 * under the cursor; Esc on it dismisses it. The polite live region is always on the page and the toast is keyed by
 * id, so screen readers announce every message, the same one twice included.
 */
export function ToastHost() {
  const toast = useStore((s) => s.toast);
  const [holds, setHolds] = useState<ToastHolds>({ hover: null, focus: null });
  const held = toast !== null && toastHeld(holds, toast.id); // tied to this toast: it can't stay stuck when the toast goes
  useEffect(() => {
    if (!toast || held) return;
    const timer = setTimeout(dismissToast, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, held]);
  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
      {toast && <ToastView key={toast.id} toast={toast} onHold={(by, on) => setHolds((h) => ({ ...h, [by]: on ? toast.id : null }))} />}
    </div>
  );
}

export function ToastView({ toast, onHold }: { toast: Toast; onHold: (by: keyof ToastHolds, on: boolean) => void }) {
  const { message, action } = toast;
  return (
    <div
      className="toast"
      onMouseEnter={() => onHold('hover', true)}
      onMouseLeave={() => onHold('hover', false)}
      onFocus={() => onHold('focus', true)}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) onHold('focus', false);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault(); // the window Esc must not also close the drawer
        dismissToast();
        restoreFocus(null);
      }}
    >
      <span>{message}</span>
      {action && (
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            dismissToast();
            action.run();
            restoreFocus(null); // the button is gone: keep the keyboard on the grid
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
