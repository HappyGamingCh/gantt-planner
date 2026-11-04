import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { popupTakesEscape } from './focus';

/** Gap between the trigger and the panel (`.menu-list` top), and the margin kept above the window's bottom edge. */
const PANEL_GAP = 6;
const WINDOW_MARGIN = 8;

/**
 * A toolbar button with a panel below it; closes on an outside click or Esc (which puts focus back on the button).
 * The button's visible text is its name, so a screen reader reads what it shows (the Filter count included); `label`
 * names the panel. `quiet` makes the trigger a ghost button (toolbar: Filter, Columns); the default is outlined.
 * `title` is the trigger's tooltip (the toolbar's Filter and Columns show their icons only in a narrow window).
 */
export function Popover({
  label,
  button,
  children,
  align = 'right',
  quiet = false,
  title,
}: {
  label: string;
  button: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  quiet?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // A tall panel (16 columns) in a short window: it ends above the window's bottom edge and scrolls inside.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!open || !panel.current || !box) return;
    const room = window.innerHeight - box.getBoundingClientRect().bottom - PANEL_GAP - WINDOW_MARGIN;
    panel.current.style.maxHeight = `${Math.max(160, Math.floor(room))}px`;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!popupTakesEscape(e, ref.current, document.querySelector('dialog[open]'))) return;
      e.preventDefault(); // one Esc closes one thing: not also the drawer, the Issues panel or the report
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button ref={trigger} type="button" className={quiet ? 'btn btn-quiet' : 'btn'} title={title} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        {button}
      </button>
      {open && (
        <div ref={panel} className={`menu-list popover popover-${align}`} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
