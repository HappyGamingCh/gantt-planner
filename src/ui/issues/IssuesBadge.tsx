// Header issues badge (SPEC §7.4): "!" + the Problems tab count.
import type { Issue } from '../../engine/types';
import { openIssues } from '../../store/store';
import { severityText, useProblems } from './useProblems';

export function IssuesBadge() {
  return <ProblemsBadge list={useProblems().list} />;
}

/** "!" + number of errors and warnings; red with errors, amber with warnings only; hidden when there are none. */
export function ProblemsBadge({ list }: { list: readonly Issue[] }) {
  if (list.length === 0) return null;
  const errors = list.some((i) => i.severity === 'error');
  const summary = severityText(list);
  return (
    <button
      type="button"
      className={`issues-badge ${errors ? 'issues-badge-error' : 'issues-badge-warning'}`}
      onClick={() => openIssues('problems')}
      aria-label={`${summary} — show issues`}
      title={`${summary} — click to review`}
    >
      ! {list.length}
    </button>
  );
}
