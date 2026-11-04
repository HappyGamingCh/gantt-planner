import { useRef, useState } from 'react';
import { isPlanDate, PLAN_DATE_MAX, PLAN_DATE_MIN } from '../../engine/dates';
import type { Project } from '../../engine/types';
import { DATE_RANGE_MESSAGE, rootsOnProjectStart, updateProject } from '../../store/edit';
import { closeDialog, showToast, useStore } from '../../store/store';
import { Dialog } from '../common/Dialog';
import { formatDate } from '../common/format';

/**
 * More › Project settings (SPEC §7.4): name, owner, project start. In Plan mode a new start can take the root tasks
 * on the old one along (§8): Apply does both as one undo step; Cancel and Esc drop every edit.
 */
export function ProjectSettingsDialog({ project }: { project: Project }) {
  const plan = useStore((s) => s.plan);
  const result = useStore((s) => s.result);
  const [name, setName] = useState(project.name);
  const [owner, setOwner] = useState(project.owner);
  const [projectStart, setProjectStart] = useState(project.projectStart);
  const [moveRoots, setMoveRoots] = useState(true);
  const roots = project.mode === 'Plan' && plan && result ? rootsOnProjectStart(plan, result) : [];
  const offer = isPlanDate(projectStart) && projectStart !== project.projectStart && roots.length > 0;
  const startInput = useRef<HTMLInputElement>(null);
  const apply = () => {
    // A start outside 1950–2199 (a year typed in part): the dialog stays open and the field says why, above the dialog.
    if (projectStart !== '' && !isPlanDate(projectStart)) {
      if (startInput.current?.reportValidity() !== false) showToast(DATE_RANGE_MESSAGE);
      return;
    }
    updateProject({ name, owner: owner.trim(), projectStart: projectStart || project.projectStart }, offer && moveRoots);
  };
  return (
    <Dialog title="Project settings" onCancel={closeDialog} actions={[{ label: 'Apply', onClick: apply, primary: true }, { label: 'Cancel', onClick: closeDialog }]}>
      <div
        className="form"
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply();
        }}
      >
        <label className="field">
          Project name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          Owner
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Shown as “Prepared by” on the report" />
        </label>
        <label className="field">
          Project start
          <input ref={startInput} type="date" min={PLAN_DATE_MIN} max={PLAN_DATE_MAX} value={projectStart} onChange={(e) => setProjectStart(e.target.value)} />
        </label>
        {offer && (
          <label className="check" title={roots.map((t) => `#${t.id} ${t.name}`).join('\n')}>
            <input type="checkbox" checked={moveRoots} onChange={() => setMoveRoots(!moveRoots)} />
            Also move {roots.length === 1 ? 'the task that starts' : `${roots.length} tasks that start`} on {formatDate(project.projectStart)} to{' '}
            {formatDate(projectStart)} (linked tasks follow)
          </label>
        )}
      </div>
    </Dialog>
  );
}
