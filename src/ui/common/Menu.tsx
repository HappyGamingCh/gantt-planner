import { Check } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { moveIndex, popupTakesEscape } from './focus';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Icon in the leading column (16 px, aria-hidden). */
  icon?: ReactNode;
  /** A choice (Color by, Row density): a check marks the one that is on. */
  checked?: boolean;
  /** Shortcut hint at the right, e.g. "Ctrl+Shift+S". */
  shortcut?: string;
}

/** An item, or a line between groups of items. */
export type MenuEntry = MenuItem | 'separator';

const itemsOf = (list: HTMLElement | null) => [...(list?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];

/**
 * Icon button with a popover list. Opening focuses the current choice (else the first item); ↑/↓/Home/End move,
 * Enter picks; it closes on a choice, Esc, Tab or an outside click. A choice or Esc puts focus back on the button, so
 * a dialog the item opens returns there too. `active` marks a non-default setting (accent button); `quiet` makes the
 * button a ghost (More in the header, density in the toolbar); the default is outlined (the Gantt corner).
 */
export function Menu({
  label,
  icon,
  items,
  active = false,
  quiet = false,
}: {
  label: string;
  icon: ReactNode;
  items: readonly MenuEntry[];
  active?: boolean;
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const entries = itemsOf(list.current);
    // preventScroll: the Color by menu sits in the Gantt pane, which must not jump.
    (entries.find((el) => el.getAttribute('aria-checked') === 'true') ?? entries[0])?.focus({ preventScroll: true });
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!popupTakesEscape(e, ref.current, document.querySelector('dialog[open]'))) return;
      e.preventDefault(); // one Esc closes one thing: not also the drawer, the Issues panel or the report
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') return setOpen(false); // focus moves on as usual
    const entries = itemsOf(e.currentTarget);
    const next = moveIndex(e.key, entries.indexOf(document.activeElement as HTMLElement), entries.length);
    if (next === null || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    entries[next]?.focus();
  };
  return (
    <div className="menu" ref={ref}>
      <button
        ref={button}
        type="button"
        className={active ? 'btn btn-icon btn-active' : quiet ? 'btn btn-icon btn-quiet' : 'btn btn-icon'}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
      </button>
      {open && (
        <div className="menu-list" role="menu" aria-label={label} ref={list} onKeyDown={onListKey}>
          <MenuEntries
            items={items}
            onPick={(item) => {
              setOpen(false);
              button.current?.focus();
              item.onSelect();
            }}
          />
        </div>
      )}
    </div>
  );
}

/** The entries of an open menu. A choice shows a check when on, an action its icon, in one aligned leading column. */
export function MenuEntries({ items, onPick }: { items: readonly MenuEntry[]; onPick: (item: MenuItem) => void }) {
  const lead = items.some((i) => i !== 'separator' && (i.icon !== undefined || i.checked !== undefined));
  return (
    <>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={`separator-${i}`} role="separator" className="menu-sep" />
        ) : (
          <button
            key={item.label}
            type="button"
            role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={item.checked}
            tabIndex={-1}
            onClick={() => onPick(item)}
          >
            {lead && (
              <span className="menu-lead" aria-hidden="true">
                {item.checked ? <Check size={16} /> : item.icon}
              </span>
            )}
            <span className="menu-label">{item.label}</span>
            {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </>
  );
}
