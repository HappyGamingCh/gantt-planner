// In-cell editors (SPEC §7.7): Enter commits and moves down, Tab commits and moves right, Esc cancels; leaving the
// cell commits. A value that can't be saved says why under the cell and keeps the editor open. Assigned and
// Progress open as popovers next to the cell (CellPopovers.tsx).
import { useId, useMemo, useRef, useState } from 'react';
import { PLAN_DATE_MAX, PLAN_DATE_MIN } from '../../engine/dates';
import { parsePredecessors } from '../../engine/links';
import type { Task } from '../../engine/types';
import type { EditValue } from '../../store/edit';
import { wouldCycle } from '../../store/predecessors';
import { showToast, useStore } from '../../store/store';
import { parseDuration } from '../common/numbers';
import { AssignedEditor, ProgressEditor } from './CellPopovers';
import { dateEditProblem } from './editing';
import { Floating, useFinish, type EditorProps } from './editorKit';

export type { Move } from './editorKit';

export function CellEditor(props: EditorProps) {
  switch (props.column.editor) {
    case 'assigned':
      return <AssignedEditor {...props} />;
    case 'progress':
      return <ProgressEditor {...props} />;
    case 'predecessors':
      return <PredecessorsEditor {...props} />;
    case 'multiline':
      return <TextAreaEditor {...props} />;
    default:
      return <InputEditor {...props} />;
  }
}

/** Text, Duration (number) and date cells. */
function InputEditor({ column, row, seed, anchor, onCommit, onCancel }: EditorProps) {
  const kind = column.editor;
  const initial = column.editValue?.(row) ?? '';
  const [value, setValue] = useState(seed !== undefined && kind !== 'date' ? seed : initial);
  const input = useRef<HTMLInputElement>(null);
  // A date with some parts typed or cleared reads as '' but isn't blank, and while the value stays '' the browser sends
  // no input event: the input itself is asked on every key and click, and again before saving.
  const [badDate, setBadDate] = useState(false);
  const halfTyped = () => kind === 'date' && !!input.current?.validity.badInput;
  const recheck = () => setBadDate(halfTyped());
  const { finish, keys, ended } = useFinish(onCommit, onCancel);
  const hintId = useId();
  const days = kind === 'number' ? parseDuration(value) : null;
  const problem = (incomplete: boolean) => days?.error ?? (kind === 'date' ? dateEditProblem(value, incomplete) : undefined);
  const error = problem(badDate);
  const hint = error ?? days?.note;
  // null: can't be saved, the editor stays open (its hint says why); undefined: unchanged, nothing to save.
  const parsed = (): EditValue | null => {
    const incomplete = halfTyped();
    setBadDate(incomplete);
    if (problem(incomplete)) return null;
    if (days) return days.value === undefined || String(days.value) === initial ? undefined : days.value;
    return value === initial ? undefined : value;
  };
  return (
    <>
      <input
        ref={input}
        className={`cell-input${kind === 'date' ? ' cell-input-date' : ''}${error ? ' cell-invalid' : ''}`}
        type={kind === 'date' ? 'date' : 'text'}
        min={kind === 'date' ? PLAN_DATE_MIN : undefined}
        max={kind === 'date' ? PLAN_DATE_MAX : undefined}
        inputMode={kind === 'number' ? 'decimal' : undefined}
        aria-label={column.header('Plan')}
        aria-invalid={!!error}
        aria-describedby={hint ? hintId : undefined}
        autoFocus
        value={value}
        onFocus={(e) => {
          // Enter, F2 or double-click: a number is selected to retype; text gets the caret at its end, as F2 in Excel.
          if (seed !== undefined || kind === 'date') return;
          if (kind === 'number') e.target.select();
          else e.target.setSelectionRange(e.target.value.length, e.target.value.length);
        }}
        onChange={(e) => {
          setValue(e.target.value);
          if (kind === 'date') recheck();
        }}
        onKeyDown={(e) => keys(e, parsed)}
        onKeyUp={kind === 'date' ? recheck : undefined}
        onClick={kind === 'date' ? recheck : undefined}
        onBlur={() => {
          // Leaving with a value that can't be saved keeps the cell as it was, and says so.
          const why = problem(halfTyped());
          if (why && !ended()) showToast(`${why} — the cell was not changed.`);
          finish(why ? undefined : (parsed() ?? undefined));
        }}
      />
      {hint && (
        <Floating anchor={anchor} id={hintId} className={error ? 'cell-hint' : 'cell-hint cell-hint-note'} role={error ? 'alert' : 'status'}>
          {hint}
        </Floating>
      )}
    </>
  );
}

/** Remarks keep their line breaks (§4.8): Alt+Enter or Shift+Enter adds one, as in Excel; Enter saves. */
function TextAreaEditor({ column, row, seed, onCommit, onCancel }: EditorProps) {
  const initial = column.editValue?.(row) ?? '';
  const [value, setValue] = useState(seed ?? initial);
  const { finish, keys } = useFinish(onCommit, onCancel);
  const parsed = () => (value === initial ? undefined : value);
  return (
    <textarea
      className="cell-input cell-textarea"
      aria-label={column.header('Plan')}
      rows={Math.min(6, value.split('\n').length)}
      wrap="off"
      autoFocus
      value={value}
      onFocus={(e) => (seed === undefined ? e.target.setSelectionRange(e.target.value.length, e.target.value.length) : undefined)}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || !(e.altKey || e.shiftKey)) return keys(e, parsed);
        e.preventDefault();
        const ta = e.currentTarget;
        ta.setRangeText('\n', ta.selectionStart, ta.selectionEnd, 'end');
        setValue(ta.value);
      }}
      onBlur={() => finish(parsed())}
    />
  );
}

/** Live check of predecessor notation (§7.7): the first problem shows under the cell. */
function predecessorProblem(text: string, task: Task, tasks: readonly Task[], summaries: readonly number[]): string | null {
  const ids = new Set(tasks.map((t) => t.id));
  for (const token of parsePredecessors(text)) {
    if (token.error === 'unsupported') return `“${token.raw}”: FF/SF links are not supported yet`;
    if (!token.link) return `“${token.raw}” is not valid notation — e.g. 3, 3SS, 3+2`;
    if (token.link.predId === task.id) return 'A task cannot depend on itself';
    if (!ids.has(token.link.predId)) return `Task ${token.link.predId} does not exist`;
    if (summaries.includes(token.link.predId)) return `${token.link.predId} is a major task — link a task inside it`;
    if (wouldCycle(tasks, token.link.predId, task.id)) return `Task ${token.link.predId} already depends on this task`;
  }
  return null;
}

function PredecessorsEditor({ column, row, seed, anchor, tasks, onCommit, onCancel }: EditorProps) {
  const [value, setValue] = useState(seed ?? column.editValue?.(row) ?? '');
  const { finish, keys } = useFinish(onCommit, onCancel);
  const hintId = useId();
  const result = useStore((s) => s.result);
  const summaries = useMemo(() => result?.tasks.filter((r) => r.summary).map((r) => r.id) ?? [], [result]);
  const problem = useMemo(() => predecessorProblem(value, row.task, tasks, summaries), [value, row.task, tasks, summaries]);
  return (
    <>
      <input
        className={`cell-input${problem ? ' cell-invalid' : ''}`}
        aria-label="Predecessors"
        aria-invalid={!!problem}
        aria-describedby={problem ? hintId : undefined}
        autoFocus
        value={value}
        onFocus={(e) => (seed === undefined ? e.target.setSelectionRange(e.target.value.length, e.target.value.length) : undefined)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => keys(e, () => value)}
        onBlur={() => finish(value)}
      />
      {problem && (
        <Floating anchor={anchor} id={hintId} className="cell-hint" role="alert">
          {problem}
        </Floating>
      )}
    </>
  );
}
