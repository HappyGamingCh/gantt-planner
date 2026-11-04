// The grid's popover editors (Assigned, Progress) keep their value until the user leaves them (SPEC §7.7). Shortcuts
// that act on the whole plan (Ctrl+S, Ctrl+O, drop-to-open) finish them first, as leaving the popover would (§17).
let pending: (() => void) | null = null;

/** Registers what finishes the open popover editor; returns the function that unregisters it. */
export function setPendingEdit(finish: () => void): () => void {
  pending = finish;
  return () => {
    if (pending === finish) pending = null;
  };
}

/** Finishes the open popover editor, if there is one. */
export function flushPendingEdit(): void {
  const finish = pending;
  pending = null;
  finish?.();
}
