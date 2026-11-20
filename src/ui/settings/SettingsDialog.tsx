import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ALL_WEEKDAYS } from '../../engine/calendar';
import { isPlanDate } from '../../engine/dates';
import type { Plan } from '../../engine/types';
import { SHEETS, findSheet, holidaysWithoutDate, resourcesWithoutName } from '../../excel/schema';
import { parseWorkingDays } from '../../excel/workingDays';
import { DATE_RANGE_MESSAGE, rootsOnProjectStart } from '../../store/edit';
import { applySettings, firstNameProblem, resourceDrafts, sortedHolidays, type SettingsTab } from '../../store/settings';
import { closeDialog, showToast, useStore } from '../../store/store';
import { Dialog } from '../common/Dialog';
import { CalendarTab } from './CalendarTab';
import { GeneralTab, type GeneralDraft } from './GeneralTab';
import { ResourcesTab } from './ResourcesTab';
import './Settings.css';

const TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'resources', label: 'Resources' },
];

/**
 * Settings (SPEC §7.14), opened from More › Project settings…, Calendar… or Resources… on that tab. Every tab edits
 * a draft; Apply applies them all as one undo step, Cancel and Esc drop them.
 */
export function SettingsDialog({ plan, tab: openedOn = 'general' }: { plan: Plan; tab?: SettingsTab }) {
  const { project } = plan;
  const result = useStore((s) => s.result);
  const workbook = useStore((s) => s.file?.workbook);
  const [tab, setTab] = useState<SettingsTab>(openedOn);
  const [general, setGeneral] = useState<GeneralDraft>({ name: project.name, owner: project.owner, projectStart: project.projectStart, moveRoots: true });
  const [workingDays, setWorkingDays] = useState<number[]>(() => [...(project.workingDays ?? ALL_WEEKDAYS)]);
  const [holidays, setHolidays] = useState(() => sortedHolidays(plan.holidays));
  const [initialResources] = useState(() => resourceDrafts(plan));
  const [resources, setResources] = useState(initialResources);
  const [showProblems, setShowProblems] = useState(false);
  const [focus, setFocus] = useState<{ id: number; n: number } | null>(null);
  const startInput = useRef<HTMLInputElement>(null);
  const ids = useId();

  const roots = project.mode === 'Plan' && result ? rootsOnProjectStart(plan, result) : [];
  // Sheets Save leaves alone (§4.4, §4.5): what is edited there would be gone at the next open.
  const locked = useMemo(() => {
    const sheet = (name: string) => (workbook ? findSheet(workbook, name) : undefined);
    const holidaysSheet = sheet(SHEETS.holidays);
    const resourcesSheet = sheet(SHEETS.resources);
    return { holidays: holidaysSheet ? holidaysWithoutDate(holidaysSheet) : false, resources: resourcesSheet ? resourcesWithoutName(resourcesSheet) : false };
  }, [workbook]);
  const unreadDays = project.workingDaysText !== undefined && parseWorkingDays(project.workingDaysText.trim()) === null ? project.workingDaysText.trim() : undefined;

  const apply = () => {
    // A start outside 1950–2199 (a year typed in part): back on General, the field or a toast says why.
    if (general.projectStart !== '' && !isPlanDate(general.projectStart)) {
      if (tab !== 'general') {
        setTab('general');
        showToast(DATE_RANGE_MESSAGE);
      } else if (startInput.current?.reportValidity() !== false) showToast(DATE_RANGE_MESSAGE);
      return;
    }
    const bad = firstNameProblem(resources);
    if (bad >= 0) {
      setTab('resources');
      setShowProblems(true);
      setFocus({ id: resources[bad]!.id, n: (focus?.n ?? 0) + 1 });
      return;
    }
    applySettings({ ...general, workingDays, holidays, initialResources, resources });
  };

  const onTabKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length]!;
    setTab(next.id);
    document.getElementById(`${ids}-${next.id}`)?.focus();
  };

  return (
    <Dialog
      title="Settings"
      className="dialog dialog-settings"
      onCancel={closeDialog}
      actions={[
        { label: 'Apply', onClick: apply, primary: true },
        { label: 'Cancel', onClick: closeDialog },
      ]}
    >
      <div className="settings-tabs" role="tablist" aria-label="Settings" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`${ids}-${t.id}`}
            type="button"
            role="tab"
            className="settings-tab"
            aria-selected={tab === t.id}
            aria-controls={`${ids}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="settings-panel" role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-${tab}`}>
        {tab === 'general' && <GeneralTab project={project} roots={roots} draft={general} onChange={setGeneral} onEnter={apply} startInput={startInput} />}
        {tab === 'calendar' && (
          <CalendarTab
            project={project}
            workingDays={workingDays}
            onWorkingDays={setWorkingDays}
            holidays={holidays}
            onHolidays={setHolidays}
            holidaysLocked={locked.holidays}
            unreadDays={unreadDays}
          />
        )}
        {tab === 'resources' && (
          <ResourcesTab drafts={resources} onDrafts={setResources} tasks={plan.tasks} locked={locked.resources} showProblems={showProblems} focus={focus} />
        )}
      </div>
    </Dialog>
  );
}
