// Problems tab (SPEC §7.11): errors, then warnings, under their own headings, each row with a severity icon, the
// task's ID and name and its quick fix; information items wait in a closed "Notes" group.
import { ChevronRight, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { Issue } from '../../engine/types';
import type { Problems } from '../../store/selectors';
import { revealTask } from '../../store/store';
import { afterFixTarget, applyQuickFix, fixLabel, keysOf } from './logic';

const ICONS = { error: OctagonAlert, warning: TriangleAlert, info: Info } as const;

export function ProblemList({ problems: { list, notes }, names }: { problems: Problems; names: ReadonlyMap<number, string> }) {
  const listRef = useRef<HTMLDivElement>(null);
  /** Index of the problem whose quick fix was just applied. */
  const fixed = useRef<number | null>(null);

  // The fixed problem's row is gone: focus the one now in its place (else the last, else the empty message).
  useLayoutEffect(() => {
    const i = fixed.current;
    const root = listRef.current;
    if (i === null || !root) return;
    fixed.current = null;
    afterFixTarget(root, i)?.focus();
  });

  const fix = (issue: Issue, i: number) => {
    if (!issue.fix) return;
    fixed.current = i;
    if (!applyQuickFix(issue.fix)) fixed.current = null;
  };

  const [keys, noteKeys] = [keysOf(list), keysOf(notes)];
  const nameOf = (issue: Issue) => (issue.taskId === undefined ? undefined : names.get(issue.taskId));
  const errors = list.filter((i) => i.severity === 'error').length;
  const groups = [
    { id: 'problems-errors', title: 'Errors', from: 0, to: errors },
    { id: 'problems-warnings', title: 'Warnings', from: errors, to: list.length },
  ].filter((g) => g.to > g.from);
  return (
    <>
      <div ref={listRef}>
        {list.length === 0 && (
          <p className="sheet-empty" tabIndex={-1}>
            No errors or warnings.
          </p>
        )}
        {groups.map((g) => (
          <section key={g.id} className="problem-group" aria-labelledby={g.id}>
            <h3 className="problem-heading" id={g.id}>
              {g.title} <span aria-hidden="true">·</span> {g.to - g.from}
            </h3>
            <ul className="problem-list">
              {list.slice(g.from, g.to).map((issue, j) => (
                <ProblemRow key={keys[g.from + j]} issue={issue} name={nameOf(issue)} onFix={() => fix(issue, g.from + j)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {notes.length > 0 && (
        <details className="problem-group problem-notes">
          <summary className="problem-heading">
            Notes <span aria-hidden="true">·</span> {notes.length}
          </summary>
          <ul className="problem-list">
            {notes.map((issue, i) => (
              <ProblemRow key={noteKeys[i]} issue={issue} name={nameOf(issue)} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** One problem: icon, catalog message (§5.11) and "#id · name"; a click shows the task. `name` is set when it exists. */
function ProblemRow({ issue, name, onFix }: { issue: Issue; name: string | undefined; onFix?: () => void }) {
  const Icon = ICONS[issue.severity];
  const body = (
    <>
      <Icon size={16} className={`problem-icon problem-icon-${issue.severity}`} aria-hidden="true" />
      <span className="problem-msg">
        <span>{issue.message}</span>
        {name !== undefined && (
          <span className="problem-task" title={name}>
            #{issue.taskId} · {name}
          </span>
        )}
      </span>
      {name !== undefined && <ChevronRight size={14} className="problem-go" aria-hidden="true" />}
    </>
  );
  return (
    <li className={`problem problem-${issue.severity}`} tabIndex={-1}>
      {name !== undefined ? (
        <button type="button" className="problem-text" onClick={() => revealTask(issue.taskId!)} title="Show the task">
          {body}
        </button>
      ) : (
        <div className="problem-text">{body}</div>
      )}
      {issue.fix && onFix && (
        <button type="button" className="btn fix-button" onClick={onFix}>
          {fixLabel(issue.fix)}
        </button>
      )}
    </li>
  );
}
