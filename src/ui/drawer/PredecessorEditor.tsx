// Predecessors in the drawer (SPEC §7.9): each link with its type and lag, and a searchable picker where tasks that
// would create a cycle are disabled. Tokens the app can't read stay until removed.
import { Plus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { parsePredecessors, type ParsedToken } from '../../engine/links';
import type { LinkType, Task } from '../../engine/types';
import { editTask } from '../../store/edit';
import { textOf, wouldCycle } from '../../store/predecessors';
import { showToast, useStore } from '../../store/store';
import { parseLag, pickerMatches, pickerStart, pickerStep } from './logic';

export function PredecessorEditor({ task, tasks, editable }: { task: Task; tasks: readonly Task[]; editable: boolean }) {
  const tokens = parsePredecessors(task.predecessorsText);
  const names = new Map(tasks.map((t) => [t.id, t.name]));
  const save = (next: ParsedToken[]) => editTask(task.id, 'predecessorsText', textOf(next));
  const replace = (i: number, token: ParsedToken) => save(tokens.map((t, j) => (j === i ? token : t)));

  return (
    <div className="pred-editor">
      {tokens.length === 0 && <p className="drawer-empty">No predecessors — the task starts on its own date.</p>}
      <ul className="pred-list">
        {/* Keyed by the token, so removing a link doesn't hand its row (and lag draft) to the next one. */}
        {tokens.map((token, i) =>
          token.link ? (
            <li key={`L${token.link.predId}-${i}`}>
              <span className="pred-name" title={names.get(token.link.predId)}>
                <span className="pred-id">#{token.link.predId}</span> {names.get(token.link.predId) ?? 'missing task'}
              </span>
              {editable ? (
                <>
                  <select
                    aria-label="Link type"
                    title={`FS: starts after #${token.link.predId} finishes · SS: can start once #${token.link.predId} starts`}
                    value={token.link.type}
                    onChange={(e) => replace(i, { ...token, link: { ...token.link!, type: e.target.value as LinkType } })}
                  >
                    <option value="FS">FS</option>
                    <option value="SS">SS</option>
                  </select>
                  <LagInput lag={token.link.lag} onChange={(lag) => replace(i, { ...token, link: { ...token.link!, lag } })} />
                  <button type="button" className="icon-button" aria-label={`Remove link to ${token.link.predId}`} onClick={() => save(tokens.filter((_, j) => j !== i))}>
                    <X size={14} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <span className="pred-type">
                  {token.link.type} {token.link.lag === 0 ? '' : token.link.lag > 0 ? `+${token.link.lag}d` : `−${-token.link.lag}d`}
                </span>
              )}
            </li>
          ) : (
            <li key={`R${token.raw}-${i}`} className="pred-invalid">
              <span>“{token.raw}” {token.error === 'unsupported' ? '— FF/SF links are not supported yet' : 'is not valid notation'}</span>
              {editable && (
                <button type="button" className="icon-button" aria-label={`Remove “${token.raw}”`} onClick={() => save(tokens.filter((_, j) => j !== i))}>
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ),
        )}
      </ul>
      {editable && tokens.some((t) => t.link) && <p className="drawer-empty pred-help">FS = start after it finishes · SS = start when it starts · lag in working days (− = overlap)</p>}
      {editable && <Picker task={task} tasks={tasks} taken={new Set(tokens.flatMap((t) => (t.link ? [t.link.predId] : [])))} onPick={(predId) => save([...tokens, { raw: '', link: { predId, type: 'FS', lag: 0 } }])} />}
    </div>
  );
}

/**
 * Lag in working days (±MAX_DAYS); negative = lead. Saved on Enter or when leaving the field, Esc puts it back.
 * Outside an edit it shows the plan's lag, so undo, another task or a removed link never leave a stale number.
 */
function LagInput({ lag, onChange }: { lag: number; onChange: (lag: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null); // null: not editing
  const cancelled = useRef(false);
  const save = () => {
    const parsed = draft === null || cancelled.current ? null : parseLag(draft);
    cancelled.current = false;
    setDraft(null);
    if (parsed && 'message' in parsed) showToast(parsed.message);
    else if (parsed && parsed.lag !== lag) onChange(parsed.lag);
  };
  return (
    <span className="days-input">
      <input
        className="lag-input"
        aria-label="Lag in working days"
        title="Lag in working days (negative = lead)"
        maxLength={5}
        value={draft ?? String(lag)}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d-]/g, ''))}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
      d
    </span>
  );
}

/**
 * Searchable task picker (a combobox): type an ID ("12" or "#12") or part of a name, ↑/↓ move the highlight, Enter
 * picks it, Esc or a click outside closes it.
 */
function Picker({ task, tasks, taken, onPick }: { task: Task; tasks: readonly Task[]; taken: Set<number>; onPick: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<number | null>(null); // null: the default row for this query
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(null);
  };
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const result = useStore((s) => s.result);
  const summaries = useMemo(() => result?.tasks.filter((r) => r.summary).map((r) => r.id) ?? [], [result]);
  const matches = open ? pickerMatches(tasks, task.id, query) : [];
  const why = matches.map((t) =>
    summaries.includes(t.id) ? 'A major task: link a task inside it' : taken.has(t.id) ? 'Already a predecessor' : wouldCycle(tasks, t.id, task.id) ? 'Would create a circular dependency' : undefined,
  );
  const enabled = why.map((w) => w === undefined);
  const at = active ?? pickerStart(matches.map((t) => t.id), enabled, query);
  const optionId = (id: number) => `${listId}-${id}`;
  // Keep the highlighted row in view.
  useEffect(() => {
    root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, at]);

  if (!open) {
    return (
      <button type="button" className="btn-link add-link" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" /> Add predecessor
      </button>
    );
  }
  const pick = (id: number) => {
    onPick(id);
    close();
  };
  return (
    <div className="picker" ref={root}>
      <input
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={at >= 0 && matches[at] ? optionId(matches[at].id) : undefined}
        aria-label="Find a task by ID or name"
        placeholder="Find a task by ID or name"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(pickerStep(enabled, at, e.key === 'ArrowDown' ? 1 : -1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (at >= 0 && enabled[at]) pick(matches[at]!.id); // an exact ID that can't be linked picks nothing
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      />
      <ul className="picker-list" role="listbox" id={listId} aria-label="Tasks">
        {matches.map((t, i) => (
          <li key={t.id} role="presentation">
            <button
              type="button"
              role="option"
              id={optionId(t.id)}
              tabIndex={-1}
              aria-selected={i === at}
              className={i === at ? 'picker-active' : undefined}
              disabled={!enabled[i]}
              title={why[i]}
              onClick={() => pick(t.id)}
            >
              <span className="pred-id">#{t.id}</span> {t.name}
            </button>
          </li>
        ))}
        {matches.length === 0 && (
          <li role="presentation" className="drawer-empty">
            No matching task
          </li>
        )}
      </ul>
    </div>
  );
}
