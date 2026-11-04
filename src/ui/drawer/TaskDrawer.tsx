// Task drawer (SPEC §7.9): every field of one task. Plan mode puts the plan first and folds the actuals away;
// Track mode puts progress and actuals first and shows the plan read-only (except tasks added this session).
import { ChevronDown, ChevronUp, Lock, Trash2, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { ComputeResult, Plan } from '../../engine/types';
import { deleteTasks, editTask, readOnlyReason, type EditField } from '../../store/edit';
import { linksOf } from '../../store/predecessors';
import { closeDrawer, drawerFocused, nameFocused, openDrawer, revealTask, useStore } from '../../store/store';
import { AssigneeInput } from '../common/AssigneeInput';
import { restoreFocus } from '../common/focus';
import { formatDate, formatVariance } from '../common/format';
import { DateField, DaysField, ProgressField, TextField } from './fields';
import { drawerChips, neighbours } from './logic';
import { PredecessorEditor } from './PredecessorEditor';
import { SummaryDetails } from './SummaryDetails';
import './Drawer.css';

/** `order`: the task IDs of the rows as shown (search and filters applied), for the previous / next buttons. */
export function TaskDrawer({ plan, result, suggestions, order }: { plan: Plan; result: ComputeResult; suggestions: readonly string[]; order: readonly number[] }) {
  const id = useStore((s) => s.drawerId);
  const focus = useStore((s) => s.nameFocus !== null && s.nameFocus === s.drawerId);
  useEffect(() => {
    if (focus) nameFocused();
  }, [focus]);
  // Opened from the keyboard (Enter on the ID, Shift+F2): the drawer takes the focus, so Tab reaches its fields and
  // one Esc closes it. Closing it gives the focus back to the grid when it would fall to the page.
  const aside = useRef<HTMLElement>(null);
  const takeFocus = useStore((s) => s.drawerFocus);
  useEffect(() => {
    if (!takeFocus) return;
    aside.current?.focus({ preventScroll: true });
    drawerFocused();
  }, [takeFocus]);
  useEffect(() => () => restoreFocus(null), []);
  const task = plan.tasks.find((t) => t.id === id);
  const r = result.tasks.find((t) => t.id === id);
  if (!task || !r) return null;
  const mode = plan.project.mode;
  const reason = (field: EditField) => readOnlyReason(field, task, r, mode) ?? undefined;
  const locked = (field: EditField) => reason(field) !== undefined;
  const edit = (field: EditField) => (value: string | number | string[]) => editTask(task.id, field, value);
  const successors = plan.tasks.flatMap((t) => linksOf(t).flatMap((l) => (l.predId === task.id ? [{ task: t, type: l.type }] : [])));
  const { prev, next } = neighbours(plan.tasks, order, task.id);
  const go = (to: number) => {
    revealTask(to);
    openDrawer(to);
  };
  // Fields below are keyed by task: switching tasks starts each from the plan, never from another task's draft.

  const assigned = (
    <Section key="assigned" title="Assigned">
      <AssigneeInput key={task.id} names={task.assigned} suggestions={suggestions} onChange={edit('assigned')} />
    </Section>
  );
  const predecessors = (
    <Section key="predecessors" title="Predecessors" locked={locked('predecessorsText')}>
      <PredecessorEditor key={task.id} task={task} tasks={plan.tasks} editable={!locked('predecessorsText')} />
    </Section>
  );
  const planned = (
    <Section key="planned" title="Planned" locked={locked('plannedDuration')}>
      <div className="drawer-row drawer-row-plan">
        <DateField
          key={`start-${task.id}`}
          label="Start"
          value={r.plannedStart}
          onSave={edit('plannedStart')}
          readOnly={locked('plannedStart')}
          hint={reason('plannedStart')}
          linked={r.links.length > 0}
        />
        <DaysField key={`duration-${task.id}`} label="Duration" value={r.plannedDuration} onSave={edit('plannedDuration')} readOnly={locked('plannedDuration')} hint={reason('plannedDuration')} />
        <DateField
          key={`finish-${task.id}`}
          label="Finish"
          value={r.plannedFinish}
          onSave={edit('plannedFinish')}
          readOnly={locked('plannedFinish')}
          hint={reason('plannedFinish')}
          required="Finish can't be blank — change the duration instead"
        />
      </div>
    </Section>
  );
  const progress = (
    <Section key="progress" title="Progress" locked={locked('progress')}>
      <ProgressField key={task.id} value={r.progress} onSave={edit('progress')} readOnly={locked('progress')} />
    </Section>
  );
  const actual = (
    <Section key="actual" title="Actual" locked={locked('actualStart')}>
      <div className="drawer-row">
        <DateField key={`start-${task.id}`} label="Start" value={r.actualStart} onSave={edit('actualStart')} readOnly={locked('actualStart')} hint={reason('actualStart')} />
        <DateField key={`finish-${task.id}`} label="Finish" value={task.actualFinish} onSave={edit('actualFinish')} readOnly={locked('actualFinish')} hint={reason('actualFinish')} />
      </div>
    </Section>
  );
  const forecast = (
    <Section key="forecast" title="Forecast">
      <p className="drawer-value">
        {formatDate(r.forecastStart)} → {formatDate(r.forecastFinish)}
        {r.variance !== 0 && (
          <>
            {' · '}
            <span className={r.variance > 0 ? 'text-late' : 'text-early'}>{formatVariance(r.variance)}</span>
          </>
        )}
      </p>
    </Section>
  );
  const rest = [
    <Section key="successors" title="Successors">
      {successors.length === 0 ? (
        <p className="drawer-empty">No task depends on this one.</p>
      ) : (
        <ul className="succ-list">
          {successors.map((s) => (
            <li key={s.task.id}>
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  revealTask(s.task.id);
                  openDrawer(s.task.id);
                }}
              >
                #{s.task.id} {s.task.name}
              </button>{' '}
              <span className="text-muted">({s.type})</span>
            </li>
          ))}
        </ul>
      )}
    </Section>,
    <Section key="remarks" title="Remarks">
      <TextField key={task.id} label="Remarks" value={task.remarks} onSave={edit('remarks')} multiline />
    </Section>,
  ];
  // A major task (§5.12): its roll-up, read-only, and its remarks.
  const sections = r.summary
    ? [<SummaryDetails key="summary" r={r} />, rest[1]]
    : mode === 'Plan'
      ? [assigned, predecessors, planned, <details key="actuals" className="drawer-fold"><summary>Actual and forecast</summary>{progress}{actual}{forecast}</details>, ...rest]
      : [progress, actual, forecast, assigned, planned, predecessors, ...rest];

  return (
    <aside ref={aside} className="sheet drawer" aria-label={`Task ${task.id}`} tabIndex={-1}>
      <div className="drawer-head">
        <span className="drawer-id">#{task.id}</span>
        {task.isNewThisSession && <span className="new-tag">New</span>}
        <div className="drawer-nav">
          <StepButtons prev={prev} next={next} go={go} />
          <button type="button" className="btn btn-icon btn-quiet" aria-label="Close" onClick={closeDrawer}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="drawer-name">
        <TextField key={task.id} label="Task name" value={task.name} onSave={edit('name')} autoFocus={focus} required="A task needs a name" />
        <div className="drawer-chips">
          {drawerChips(r).map((chip) => (
            <span key={chip.label} className={`status-chip st-${chip.slug}`}>
              {chip.label}
            </span>
          ))}
        </div>
      </div>
      <div className="drawer-body">{sections}</div>
      <div className="drawer-foot">
        <button type="button" className="btn btn-danger" onClick={() => deleteTasks([task.id])}>
          <Trash2 size={16} aria-hidden="true" /> {r.summary ? 'Delete major task' : 'Delete task'}
        </button>
        <button type="button" className="btn btn-primary" onClick={closeDrawer}>
          Done
        </button>
      </div>
    </aside>
  );
}

/** Previous / next task. aria-disabled, not disabled: stepping onto the first / last row keeps the focus on the button pressed. */
export function StepButtons({ prev, next, go }: { prev?: number; next?: number; go: (id: number) => void }) {
  return (
    <>
      <button type="button" className="btn btn-icon btn-quiet" aria-label="Previous task" title="Previous task" aria-disabled={prev === undefined} onClick={() => prev !== undefined && go(prev)}>
        <ChevronUp size={16} aria-hidden="true" />
      </button>
      <button type="button" className="btn btn-icon btn-quiet" aria-label="Next task" title="Next task" aria-disabled={next === undefined} onClick={() => next !== undefined && go(next)}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </>
  );
}

function Section({ title, locked, children }: { title: string; locked?: boolean; children: ReactNode }) {
  return (
    <section className="drawer-section">
      <h3>
        {title}
        {locked && <Lock size={12} aria-label="Read-only in this mode" />}
      </h3>
      {children}
    </section>
  );
}
