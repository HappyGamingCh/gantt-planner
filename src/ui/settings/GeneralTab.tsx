import type { RefObject } from 'react';
import { isPlanDate, PLAN_DATE_MAX, PLAN_DATE_MIN } from '../../engine/dates';
import type { Project, Task } from '../../engine/types';
import { formatDate } from '../common/format';

export interface GeneralDraft {
  name: string;
  owner: string;
  projectStart: string;
  moveRoots: boolean;
}

/**
 * Settings › General (SPEC §7.14): name, owner, project start. In Plan mode a new start can take the root tasks on the
 * old one along (§8); Apply does both as one undo step.
 */
export function GeneralTab({
  project,
  roots,
  draft,
  onChange,
  onEnter,
  startInput,
}: {
  project: Project;
  /** Root tasks on the old Project Start (Plan mode). */
  roots: readonly Task[];
  draft: GeneralDraft;
  onChange: (draft: GeneralDraft) => void;
  /** Enter in a field applies the dialog. */
  onEnter: () => void;
  startInput: RefObject<HTMLInputElement>;
}) {
  const offer = isPlanDate(draft.projectStart) && draft.projectStart !== project.projectStart && roots.length > 0;
  const set = (fields: Partial<GeneralDraft>) => onChange({ ...draft, ...fields });
  return (
    <div
      className="form"
      onKeyDown={(e) => {
        if (e.key === 'Enter') onEnter();
      }}
    >
      <label className="field">
        Project name
        <input value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
      </label>
      <label className="field">
        Owner
        <input value={draft.owner} onChange={(e) => set({ owner: e.target.value })} placeholder="Shown as “Prepared by” on the report" />
      </label>
      <label className="field">
        Project start
        <input
          ref={startInput}
          type="date"
          min={PLAN_DATE_MIN}
          max={PLAN_DATE_MAX}
          value={draft.projectStart}
          onChange={(e) => set({ projectStart: e.target.value })}
        />
      </label>
      {offer && (
        <label className="check" title={roots.map((t) => `#${t.id} ${t.name}`).join('\n')}>
          <input type="checkbox" checked={draft.moveRoots} onChange={() => set({ moveRoots: !draft.moveRoots })} />
          Also move {roots.length === 1 ? 'the task that starts' : `${roots.length} tasks that start`} on {formatDate(project.projectStart)} to{' '}
          {formatDate(draft.projectStart)} (linked tasks follow)
        </label>
      )}
    </div>
  );
}
