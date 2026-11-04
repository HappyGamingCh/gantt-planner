// Issues panel (SPEC §7.11): Problems (click jumps to the task; quick fixes apply in one step) and Changes grouped by
// field, as tabs (arrow keys move between them).
import { X } from 'lucide-react';
import { useMemo } from 'react';
import { isISODate } from '../../engine/dates';
import type { Change, Task } from '../../engine/types';
import type { Problems } from '../../store/selectors';
import { closePanel, revealTask, setIssuesTab, useStore, type State } from '../../store/store';
import { formatDayMonth } from '../common/format';
import { onTabKey, TABS, tabId } from './logic';
import { ProblemList } from './ProblemList';
import { useProblems } from './useProblems';
import './IssuesPanel.css';

export function IssuesPanel() {
  const tab = useStore((s) => s.issuesTab);
  const tasks = useStore((s) => s.plan?.tasks);
  const changes = useStore((s) => s.changes);
  const found = useProblems();
  return tasks ? <IssuesSheet tab={tab} found={found} changes={changes} tasks={tasks} /> : null;
}

/** The sheet, drawn from its data. */
export function IssuesSheet({ tab, found, changes, tasks }: { tab: State['issuesTab']; found: Problems; changes: Change[]; tasks: readonly Task[] }) {
  const names = useMemo(() => new Map(tasks.map((t) => [t.id, t.name])), [tasks]);
  const count = { problems: found.list.length, changes: changes.length };
  return (
    <aside className="sheet" aria-label="Issues">
      <div className="sheet-head">
        <div className="sheet-tabs" role="tablist" aria-label="Issues" onKeyDown={(e) => onTabKey(e, tab)}>
          {TABS.map((t) => (
            <button
              key={t.tab}
              type="button"
              role="tab"
              id={tabId(t.tab)}
              aria-selected={tab === t.tab}
              aria-controls="issues-tabpanel"
              tabIndex={tab === t.tab ? 0 : -1}
              onClick={() => setIssuesTab(t.tab)}
            >
              {t.label} <span className="tab-count">{count[t.tab]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-icon btn-quiet" aria-label="Close issues" onClick={closePanel}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="sheet-body" role="tabpanel" id="issues-tabpanel" aria-labelledby={tabId(tab)}>
        {tab === 'problems' ? <ProblemList problems={found} names={names} /> : <Changes changes={changes} names={names} />}
      </div>
    </aside>
  );
}

/** A value in a change row: dates as "3 Nov", blanks as "blank". */
function shown(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'blank';
  if (typeof value === 'string' && isISODate(value)) return formatDayMonth(value);
  return String(value);
}

/** `names`: the tasks in the plan now; "#id" shows a task only while one has that ID. */
function Changes({ changes, names }: { changes: Change[]; names: ReadonlyMap<number, string> }) {
  if (changes.length === 0) return <p className="sheet-empty">Nothing was filled in or corrected.</p>;
  const groups = new Map<string, Change[]>();
  for (const c of changes) groups.set(c.field, [...(groups.get(c.field) ?? []), c]);
  return (
    <div className="change-groups">
      {[...groups].map(([field, list]) => (
        <details key={field} className="change-group">
          <summary>
            {field} <span className="tab-count">×{list.length}</span>
          </summary>
          <ul>
            {list.map((c, i) => (
              <li key={i}>
                {c.taskId !== undefined &&
                  (names.has(c.taskId) ? (
                    <button type="button" className="btn-link" onClick={() => revealTask(c.taskId!)} title={names.get(c.taskId)}>
                      #{c.taskId}
                    </button>
                  ) : (
                    <span>#{c.taskId}</span>
                  ))}{' '}
                {shown(c.from)} → {shown(c.to)} <span className="change-reason">· {c.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
