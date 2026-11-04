// Assignee chip editor (SPEC §7.7, §7.9): Enter (or a comma) adds the typed name, with suggestions from Resources
// and other tasks; × or Backspace removes one. Text is split on "," and ";" (a pasted list gives several names), and
// text left in the box is added when it loses focus or a suggestion is picked, so a typed name is never lost. A new
// name becomes a resource when the plan is saved.
import { useId, useRef, useState } from 'react';
import { addNames } from './assignees';

export function AssigneeInput({
  names,
  suggestions,
  onChange,
  onDone,
  onCancel,
  onTextChange,
  initialText,
  autoFocus,
}: {
  names: string[];
  suggestions: readonly string[];
  /** Every add or remove. */
  onChange: (names: string[]) => void;
  /** Enter on an empty field (down), or Tab / Shift+Tab (right / left): the names, any typed text added. */
  onDone?: (names: string[], move: 'down' | 'right' | 'left') => void;
  /** Esc (a popover); without it Esc drops the typed text and leaves the field. */
  onCancel?: () => void;
  /** The text typed but not added yet, for a popover that adds it when it closes. */
  onTextChange?: (text: string) => void;
  /** A typed character that opened the editor. */
  initialText?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(initialText ?? '');
  const cancelled = useRef(false);
  const listId = useId();
  const type = (value: string) => {
    setText(value);
    onTextChange?.(value);
  };
  /** Adds the names in `raw` (the box by default) and empties the box; returns the resulting list. */
  const add = (raw = text): string[] => {
    const next = addNames(names, raw, suggestions);
    if (next !== names) onChange(next);
    type('');
    return next;
  };
  return (
    <div className="assignee-input">
      {names.map((name) => (
        <span key={name} className="tag tag-edit">
          {name}
          <button type="button" aria-label={`Remove ${name}`} onClick={() => onChange(names.filter((n) => n !== name))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={text}
        list={listId}
        autoFocus={autoFocus}
        aria-label="Add assignee"
        placeholder={names.length === 0 ? 'Add a name' : '+ Add'}
        onChange={(e) => {
          // A suggestion picked from the list, or a pasted list ("ACME, ThermCo"), is added at once.
          const input = e.nativeEvent as InputEvent;
          const picked = input.inputType === 'insertReplacementText' || (input.inputType === undefined && suggestions.includes(e.target.value));
          if (picked || (input.inputType === 'insertFromPaste' && /[,;]/.test(e.target.value))) add(e.target.value);
          else type(e.target.value);
        }}
        onBlur={() => {
          if (cancelled.current) cancelled.current = false;
          else if (text.trim() !== '') add();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (text.trim() !== '') add();
            else onDone?.(names, 'down');
          } else if (e.key === ',' || e.key === ';') {
            e.preventDefault();
            add();
          } else if (e.key === 'Tab' && onDone) {
            e.preventDefault();
            onDone(add(), e.shiftKey ? 'left' : 'right');
          } else if (e.key === 'Escape') {
            // Drops the typed text. A popover closes; a drawer field is left (a second Esc closes the drawer).
            e.preventDefault();
            cancelled.current = true;
            type('');
            if (onCancel) {
              e.stopPropagation();
              onCancel();
            } else e.currentTarget.blur();
          } else if (e.key === 'Backspace' && text === '' && names.length > 0) {
            onChange(names.slice(0, -1));
          }
        }}
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !names.some((n) => n.toLowerCase() === s.toLowerCase()))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}
