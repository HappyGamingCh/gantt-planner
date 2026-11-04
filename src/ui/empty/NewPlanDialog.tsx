import { useRef, useState } from 'react';
import { isPlanDate, PLAN_DATE_MAX, PLAN_DATE_MIN } from '../../engine/dates';
import { DATE_RANGE_MESSAGE } from '../../store/edit';
import { createPlan, nextMonday } from '../../store/files';
import { closeDialog, showToast, todayISO } from '../../store/store';
import { Dialog } from '../common/Dialog';

/** New plan (SPEC §7.10): name, Project Start (next Monday by default; 1950–2199, §4.7), owner. */
export function NewPlanDialog() {
  const [name, setName] = useState('');
  const [projectStart, setProjectStart] = useState(() => nextMonday(todayISO()));
  const [owner, setOwner] = useState('');
  const startInput = useRef<HTMLInputElement>(null);
  const create = () => {
    // A start outside 1950–2199 (a year typed in part): the dialog stays open and the field says why, above the dialog.
    if (projectStart !== '' && !isPlanDate(projectStart)) {
      if (startInput.current?.reportValidity() !== false) showToast(DATE_RANGE_MESSAGE);
      return;
    }
    createPlan({ name, owner, projectStart: projectStart || nextMonday(todayISO()) });
  };
  return (
    <Dialog title="New plan" onCancel={closeDialog} actions={[{ label: 'Create plan', onClick: create, primary: true }, { label: 'Cancel', onClick: closeDialog }]}>
      <div
        className="form"
        onKeyDown={(e) => {
          if (e.key === 'Enter') create();
        }}
      >
        <label className="field">
          Project name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled project" autoFocus />
        </label>
        <label className="field">
          Project start
          <input ref={startInput} type="date" min={PLAN_DATE_MIN} max={PLAN_DATE_MAX} value={projectStart} onChange={(e) => setProjectStart(e.target.value)} />
        </label>
        <label className="field">
          Owner
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Shown as “Prepared by” on the report" />
        </label>
      </div>
    </Dialog>
  );
}
