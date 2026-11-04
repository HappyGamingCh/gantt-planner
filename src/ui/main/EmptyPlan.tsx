// A plan without tasks (blank template, every task deleted): the grid says so and offers the next step — Add task in
// Plan mode, the switch to Plan mode in Track mode. When the reader found why the file has no tasks, that comes first.
import { Plus } from 'lucide-react';
import { addTask, setMode } from '../../store/edit';
import { openPicked } from '../../store/files';
import { useStore } from '../../store/store';
import './EmptyPlan.css';

/** Reader issues that explain an empty plan (§5.11). Strings, so this compiles before the reader has the code. */
const FILE_PROBLEMS: readonly string[] = ['W_NO_TASKS_SHEET'];

export function EmptyPlan({ mode }: { mode: 'Plan' | 'Track' }) {
  const problem = useStore((s) => s.readIssues.find((i) => FILE_PROBLEMS.includes(i.code)));
  const busy = useStore((s) => !!s.busy);
  return (
    <div className="empty-plan">
      {problem && (
        <p className="empty-plan-problem">
          {problem.message}{' '}
          <button type="button" className="btn-link" onClick={openPicked} disabled={busy}>
            Open another file
          </button>
        </p>
      )}
      <p className="empty-plan-title">No tasks yet</p>
      {mode === 'Plan' ? (
        <>
          <button type="button" className="btn btn-primary" onClick={addTask}>
            <Plus size={16} aria-hidden="true" /> Add task
          </button>
          <p className="empty-plan-hint">or press Ctrl+Enter. You can also fill the Tasks sheet in Excel and open the file again.</p>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-primary" onClick={() => setMode('Plan')}>
            Switch to Plan mode
          </button>
          <p className="empty-plan-hint">Build the schedule in Plan mode, then switch back to Track to report progress.</p>
        </>
      )}
    </div>
  );
}
