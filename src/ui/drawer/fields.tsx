// Drawer fields (SPEC §7.9). Each saves when the user is done with it (Enter or leaving the field), so one change is
// one undo step. Esc puts the value back and leaves the field; a second Esc closes the drawer. Outside an edit a
// field shows the plan's value, so an edit the plan refused or normalised never stays on screen.
import { Link2 } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react';
import { PLAN_DATE_MAX, PLAN_DATE_MIN } from '../../engine/dates';
import type { ISODate } from '../../engine/types';
import { showToast } from '../../store/store';
import { formatDate } from '../common/format';
import { parseDuration } from '../common/numbers';
import { dateProblem, durationProblem, leaveField, settledText } from './logic';

type Field = HTMLInputElement | HTMLTextAreaElement;

interface DraftOptions {
  /** Why the text can't be saved; the message is shown and the field goes back to the plan's value. */
  check?: (text: string, el: Field) => string | null;
}

/** Draft text of a field while it is being edited: saved through `commit` on Enter or blur, dropped on Esc. */
function useDraft(value: string, commit: (text: string) => void, { check }: DraftOptions = {}) {
  const [draft, setDraft] = useState<string | null>(null); // null: not editing, show the plan's value
  const cancelled = useRef(false);
  return {
    value: draft ?? value,
    onChange: (e: ChangeEvent<Field>) => setDraft(e.target.value),
    onBlur: (e: FocusEvent<Field>) => {
      const el = e.currentTarget;
      const halfTyped = el instanceof HTMLInputElement && el.type === 'date' && el.validity.badInput;
      const text = cancelled.current ? null : settledText(draft, halfTyped);
      const outcome = text === null ? {} : leaveField(text, value, check?.(text, el) ?? null);
      cancelled.current = false;
      setDraft(null);
      if (outcome.message) showToast(outcome.message);
      else if (outcome.save !== undefined) commit(outcome.save);
      // A half-typed date reads as '' in the DOM, which React takes for "unchanged": clear its segments by hand.
      if (halfTyped) el.value = value;
    },
    onKeyDown: (e: KeyboardEvent<Field>) => {
      if (e.key === 'Enter' && e.currentTarget.tagName === 'INPUT') e.currentTarget.blur();
      if (e.key === 'Escape') {
        cancelled.current = true;
        setDraft(null);
        e.currentTarget.blur();
      }
    },
  };
}

/** A text field; `required` is the message shown when it is left blank (the plan keeps its value). */
export function TextField({ label, value, onSave, multiline, autoFocus, required }: { label: string; value: string; onSave: (v: string) => void; multiline?: boolean; autoFocus?: boolean; required?: string }) {
  const draft = useDraft(value, onSave, { check: (text) => (required && text.trim() === '' ? required : null) });
  return multiline ? (
    <textarea className="drawer-input" aria-label={label} rows={3} {...draft} />
  ) : (
    <input className="drawer-input drawer-title" aria-label={label} autoFocus={autoFocus} onFocus={(e) => autoFocus && e.target.select()} {...draft} />
  );
}

/**
 * A date input (1950–2199; a half-typed date is never saved), or the date in a static box when it can't be changed
 * here — `hint` says why, `linked` adds the link icon of a start set by predecessors. `required` is the message shown
 * when the date is cleared, for a date that can't be blank.
 */
export function DateField({
  label,
  value,
  onSave,
  readOnly,
  hint,
  linked,
  required,
}: {
  label: string;
  value?: ISODate;
  onSave: (v: string) => void;
  readOnly?: boolean;
  hint?: string;
  linked?: boolean;
  required?: string;
}) {
  const draft = useDraft(value ?? '', onSave, { check: (text, el) => dateProblem(text, el instanceof HTMLInputElement && el.validity.badInput, required) });
  return (
    <label className="drawer-field" title={hint}>
      <span>{label}</span>
      {readOnly ? (
        <span className="drawer-static">
          {linked && <Link2 size={12} aria-hidden="true" />}
          {value ? formatDate(value) : '—'}
        </span>
      ) : (
        <input type="date" className="drawer-input" min={PLAN_DATE_MIN} max={PLAN_DATE_MAX} data-empty={draft.value === '' ? '' : undefined} {...draft} />
      )}
    </label>
  );
}

/** Planned Duration: whole days, 0–MAX_DAYS (0 = milestone); a decimal is rounded and a toast says so; a blank isn't saved. */
export function DaysField({ label, value, onSave, readOnly, hint }: { label: string; value: number; onSave: (v: number) => void; readOnly?: boolean; hint?: string }) {
  const save = (text: string) => {
    const { value: days, note } = parseDuration(text); // the check already refused text, negatives and blanks
    if (days === undefined) return;
    if (note) showToast(note); // first, so a message from the plan replaces it
    if (days !== value) onSave(days);
  };
  const draft = useDraft(String(value), save, { check: durationProblem });
  return (
    <label className="drawer-field" title={hint}>
      <span>{label}</span>
      {readOnly ? (
        <span className="drawer-static">{value}d</span>
      ) : (
        <span className="days-input">
          <input className="drawer-input" inputMode="decimal" maxLength={7} {...draft} />d
        </span>
      )}
    </label>
  );
}

/**
 * §7.9 Progress: 0 / 25 / 50 / 75 / 100 and a slider. A drag saves on release; keyboard steps (arrows, PageUp/Down,
 * Home/End) only move the slider until Enter or leaving it, so one change is one edit; Esc puts it back.
 */
export function ProgressField({ value, onSave, readOnly }: { value: number; onSave: (v: number) => void; readOnly?: boolean }) {
  const [draft, setDraft] = useState<number | null>(null); // null: not moved, show the plan's value
  const [dragging, setDragging] = useState(false);
  const cancelled = useRef(false);
  const hintId = useId();
  if (readOnly) return <p className="drawer-value">{value}%</p>;
  const current = draft ?? value;
  const pending = draft !== null && draft !== value && !dragging; // a keyboard change waiting for Enter
  const save = () => {
    if (draft !== null && draft !== value) onSave(draft);
    setDraft(null);
  };
  return (
    <div className="drawer-progress">
      <div className="progress-steps">
        {[0, 25, 50, 75, 100].map((p) => (
          <button key={p} type="button" className={p === value ? 'step step-on' : 'step'} onClick={() => onSave(p)}>
            {p}
          </button>
        ))}
      </div>
      <label className="progress-slider">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={current}
          aria-label="Progress"
          aria-describedby={pending ? hintId : undefined}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => {
            setDragging(false);
            save();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
              cancelled.current = true;
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            if (cancelled.current) cancelled.current = false;
            else save();
          }}
        />
        <span>{current}%</span>
      </label>
      {pending && (
        <p className="progress-hint" id={hintId}>
          Enter saves · Esc cancels
        </p>
      )}
    </div>
  );
}
