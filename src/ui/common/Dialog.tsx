import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { restoreFocus } from './focus';
import './Dialog.css';

export interface DialogAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  /** The action to focus when the dialog has no form field (default: the primary one). */
  focus?: boolean;
}

/**
 * The action a dialog focuses when it opens (unless a form field comes first): the one marked `focus`, else the
 * primary one — the safe choice in a confirm (Cancel, Stay in Track). Never the browser's pick, the first button,
 * which there is the destructive one (Reload file, Discard changes, Delete), so Enter can't run it by accident.
 */
export function focusedAction(actions: readonly DialogAction[]): number {
  const marked = actions.findIndex((a) => a.focus);
  return marked >= 0 ? marked : actions.findIndex((a) => a.primary);
}

/** What an open dialog focuses: its first form field (New plan, Project settings), else the focused action. */
function initialFocus(dialog: HTMLDialogElement): HTMLElement | null {
  return (
    dialog.querySelector<HTMLElement>('.dialog-body input:not(:disabled), .dialog-body select, .dialog-body textarea') ??
    dialog.querySelector<HTMLElement>('.dialog-actions [data-autofocus]')
  );
}

/** Modal dialog for file-level and destructive actions (SPEC §7.11), and help. Esc = cancel. */
export function Dialog({
  title,
  children,
  actions,
  onCancel,
  className = 'dialog',
}: {
  title: string;
  children: ReactNode;
  actions: DialogAction[];
  onCancel: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const focus = focusedAction(actions);
  // Layout effects: React's autoFocus fires while the <dialog> is still closed (so it does nothing), and the cleanup
  // must run while the dialog is still on the page, so that close() hands focus back to the control that opened it.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.close();
      restoreFocus(opener);
    };
  }, []);
  // Again when another dialog takes this one's place (e.g. a save that ends in "Can't save").
  useLayoutEffect(() => {
    if (ref.current) initialFocus(ref.current)?.focus();
  }, [title]);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">
        {actions.map((a, i) => (
          <button key={a.label} type="button" className={a.primary ? 'btn btn-primary' : 'btn'} onClick={a.onClick} data-autofocus={i === focus ? '' : undefined}>
            {a.label}
          </button>
        ))}
      </div>
    </dialog>
  );
}
