// Popover editors (SPEC §7.7): Assigned (chips) and Progress (Track). Enter saves and moves down, Tab saves and moves
// right, Esc cancels; leaving the popover (a click elsewhere, Ctrl+S) saves what was typed.
import { useRef, useState, type KeyboardEvent } from 'react';
import { addNames } from '../common/assignees';
import { AssigneeInput } from '../common/AssigneeInput';
import { parseProgress } from '../common/numbers';
import { ProgressCell } from './cells';
import { Floating, useFinish, type EditorProps, type Move } from './editorKit';

export function AssignedEditor({ row, seed, anchor, suggestions, onCommit, onCancel }: EditorProps) {
  const [names, setNames] = useState(row.task.assigned);
  // Kept in step with every change, so leaving right after one (Tab, a click elsewhere) never saves an older list.
  const latest = useRef(names);
  const pending = useRef(seed ?? '');
  const { finish, cancel } = useFinish(onCommit, onCancel);
  const change = (next: string[]) => {
    latest.current = next;
    setNames(next);
  };
  const leave = () => finish(addNames(latest.current, pending.current, suggestions));
  // Scrolled away from: the chips are saved, but half-typed text never becomes a name the user didn't see added.
  const lost = () => finish(latest.current);
  return (
    <Floating anchor={anchor} className="cell-pop" role="dialog" label="Assigned" onLeave={leave} onAnchorLost={lost}>
      <AssigneeInput
        names={names}
        suggestions={suggestions}
        initialText={seed}
        onTextChange={(text) => {
          pending.current = text;
        }}
        onChange={change}
        onDone={(next, move) => finish(next, move)}
        onCancel={cancel}
        autoFocus
      />
      <p className="cell-pop-hint">Enter adds a name · Enter again or Tab saves · Esc cancels</p>
    </Floating>
  );
}

const STEPS = [0, 25, 50, 75, 100];

/** Progress (Track): type a percent (typing on the cell starts here), or pick 0 / 25 / 50 / 75 / 100 or the slider. */
export function ProgressEditor({ row, seed, anchor, onCommit, onCancel }: EditorProps) {
  const current = row.r.progress;
  const digit = seed !== undefined && /^\d$/.test(seed) ? seed : null; // a digit typed on the cell starts the number
  const [text, setText] = useState(digit ?? String(current));
  const latest = useRef(text);
  latest.current = text;
  const { finish, cancel } = useFinish(onCommit, onCancel);
  const typed = parseProgress(text);
  const shown = typed.value ?? current;
  // An unchanged value saves nothing: no undo step, and no Actual Start filled in by the §8 rules.
  const save = (value: number | undefined, move?: Move) => finish(value === current ? undefined : value, move);
  const saveTyped = (move?: Move) => {
    const { value, error } = parseProgress(latest.current);
    if (!error) save(value, move);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      saveTyped(e.shiftKey ? 'left' : 'right');
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      saveTyped('down');
    }
  };
  // The cell keeps its mini bar and percent under the popover, following the draft (or the saved value while the
  // typed text is blank or not a percent), so the anchor never reads as an empty box.
  return (
    <>
      <ProgressCell progress={shown} status={row.r.status} />
      <Floating
        anchor={anchor}
        className="cell-pop"
        role="dialog"
        label="Progress"
        onLeave={() => (parseProgress(latest.current).error ? cancel() : saveTyped())}
        onAnchorLost={cancel}
      >
        <div onKeyDown={onKeyDown}>
          <div className="progress-steps">
            {STEPS.map((p) => (
              <button key={p} type="button" tabIndex={-1} className={p === current ? 'step step-on' : 'step'} onClick={() => save(p, 'down')}>
                {p}
              </button>
            ))}
          </div>
          <div className="progress-slider">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={shown}
              tabIndex={-1}
              aria-label="Progress slider"
              onChange={(e) => setText(e.target.value)}
              onPointerUp={(e) => save(Number(e.currentTarget.value))}
            />
            <label className="progress-number">
              <input
                className={typed.error ? 'cell-invalid' : undefined}
                inputMode="decimal"
                maxLength={5}
                aria-label="Progress (%)"
                aria-invalid={!!typed.error}
                autoFocus
                value={text}
                onFocus={(e) => (digit === null ? e.target.select() : undefined)}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                  e.preventDefault();
                  setText(String(Math.min(100, Math.max(0, shown + (e.key === 'ArrowUp' ? 5 : -5)))));
                }}
              />
              %
            </label>
          </div>
          <p className={typed.error ? 'cell-pop-hint cell-pop-error' : 'cell-pop-hint'} role={typed.error ? 'alert' : undefined}>
            {typed.error ?? 'Type 0–100 · ↑/↓ ±5 · Enter saves · Esc cancels'}
          </p>
        </div>
      </Floating>
    </>
  );
}
