// Header (SPEC §7.4): name (click to rename) and file chip, Plan | Track, status date, issues badge, Open, Save, Report,
// Print Gantt, More.
import { Activity, FileDown, FilePlus, Info, Keyboard, ListOrdered, Lock, MoreHorizontal, PencilLine, PencilRuler, Printer, SaveAll, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isPlanDate, PLAN_DATE_MAX, PLAN_DATE_MIN } from '../../engine/dates';
import { askRenumber, DATE_RANGE_MESSAGE, setMode, setStatusDate, updateProject } from '../../store/edit';
import { askNewPlan, downloadTemplate, openPicked, save, saveAs } from '../../store/files';
import { changesUnsaved } from '../../store/selectors';
import { openIssues, openPrint, openReport, showToast, todayISO, useStore, type State } from '../../store/store';
import { AppMark } from '../common/AppMark';
import { formatDayMonth, formatTime } from '../common/format';
import { Menu } from '../common/Menu';
import { Segmented } from '../common/Segmented';
import { IssuesBadge } from '../issues/IssuesBadge';
import './Header.css';

// §7.4: each option says what its mode is for (icon + tooltip); the icon is aria-hidden, so the option's text (and
// QA's textContent) stays "Plan" / "Track".
const MODES = [
  {
    value: 'Plan',
    label: 'Plan',
    icon: <PencilRuler size={14} aria-hidden="true" />,
    title: 'Plan mode: build and adjust the baseline (dates, durations, links)',
  },
  { value: 'Track', label: 'Track', icon: <Activity size={14} aria-hidden="true" />, title: 'Track mode: update progress against the baseline' },
] as const;

function saveState(s: State): string {
  if (s.busy === 'opening') return s.opening ? `Opening ${s.opening}…` : 'Opening…';
  if (s.busy === 'saving') return 'Saving…';
  if (s.dirty) return 'Unsaved changes';
  // Without a handle, Save was a download (fallback, §3.5): the app can't tell that the file reached the disk.
  if (s.savedAt) return `${s.file?.handle ? 'Saved' : 'Downloaded'} ${formatTime(s.savedAt)}`;
  return s.file?.handle ? 'Saved' : 'Not saved yet';
}

/** Fallback (§3.5): until the first download, the file chip says where Save will put the plan. */
export const downloadHint = (s: State) => s.fallback && !s.busy && !s.file?.handle && !s.savedAt;

export function Header() {
  const project = useStore((s) => s.plan?.project);
  const busy = useStore((s) => !!s.busy);
  const canSave = useStore((s) => !s.busy && (s.dirty || !s.file?.handle));
  const setDialog = (dialog: State['dialog']) => useStore.setState({ dialog });
  if (!project) return null;
  return (
    <header className="header">
      <div className="header-title">
        <AppMark />
        <div className="header-name">
          <ProjectName name={project.name} />
          <FileChip />
        </div>
      </div>
      <ModeSwitch mode={project.mode} />
      <div className="header-actions">
        <StatusDate date={project.statusDate} />
        <IssuesBadge />
        <button type="button" className="btn" onClick={openPicked} disabled={busy} title="Open (Ctrl+O)">
          Open
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!canSave} title="Save (Ctrl+S)">
          Save
        </button>
        <button type="button" className="btn" onClick={openReport} title="Progress report to print or save as PDF">
          Report
        </button>
        {/* Below 1100 px only its icon shows (Header.css), so the project name and file chip keep their room */}
        <button type="button" className="btn header-print" onClick={openPrint} aria-label="Print Gantt" title="The grid and Gantt as shown, to print or save as PDF (Ctrl+P)">
          <Printer size={16} aria-hidden="true" />
          <span className="header-print-label">Print Gantt</span>
        </button>
        <Menu
          label="More"
          quiet
          icon={<MoreHorizontal size={18} aria-hidden="true" />}
          items={[
            { label: 'New plan', icon: <FilePlus size={16} />, onSelect: askNewPlan },
            { label: 'Save as…', icon: <SaveAll size={16} />, shortcut: 'Ctrl+Shift+S', onSelect: () => void saveAs() },
            { label: 'Download blank template', icon: <FileDown size={16} />, onSelect: () => void downloadTemplate() },
            'separator',
            { label: 'Project settings…', icon: <Settings size={16} />, onSelect: () => setDialog({ kind: 'projectSettings' }) },
            ...(project.mode === 'Plan' ? [{ label: 'Renumber IDs…', icon: <ListOrdered size={16} />, onSelect: askRenumber }] : []),
            'separator',
            { label: 'Keyboard shortcuts', icon: <Keyboard size={16} />, shortcut: '?', onSelect: () => setDialog({ kind: 'shortcuts' }) },
            { label: 'About', icon: <Info size={16} />, onSelect: () => setDialog({ kind: 'about' }) },
          ]}
        />
      </div>
    </header>
  );
}

/**
 * §7.4 Mode switch with a caption under it: Plan (violet, "Editing the baseline") changes the baseline; Track (the
 * daily mode, neutral, "Baseline locked") doesn't. Plan from Track still asks first (§6, setMode).
 */
export function ModeSwitch({ mode }: { mode: 'Plan' | 'Track' }) {
  const plan = mode === 'Plan';
  return (
    <div className={`mode-switch mode-switch-${mode.toLowerCase()}`}>
      <Segmented label="Mode" className="segmented segmented-mode" options={MODES} value={mode} onChange={setMode} describedBy="mode-caption" />
      <span id="mode-caption" className={plan ? 'mode-caption mode-caption-plan' : 'mode-caption'}>
        {plan ? <PencilLine size={12} aria-hidden="true" /> : <Lock size={12} aria-hidden="true" />}
        {plan ? 'Editing the baseline' : 'Baseline locked'}
      </span>
    </div>
  );
}

/** Click the name to rename the project; Enter saves, Esc cancels. */
function ProjectName({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <h1>
        <button type="button" className="name-button" title="Rename the project" onClick={() => setEditing(true)}>
          {name}
        </button>
      </h1>
    );
  }
  const done = (value: string) => {
    setEditing(false);
    if (value.trim() !== '' && value !== name) updateProject({ name: value });
  };
  return (
    <input
      className="name-input"
      aria-label="Project name"
      defaultValue={name}
      autoFocus
      onFocus={(e) => e.target.select()}
      onBlur={(e) => done(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done(e.currentTarget.value);
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

function FileChip() {
  const fileName = useStore((s) => s.file?.name ?? '');
  const state = useStore(saveState);
  const dirty = useStore((s) => s.dirty);
  // Changes the last Save hasn't written yet (load fills, plan recalculations); a saved list is no reason to look.
  const unsaved = useStore(changesUnsaved);
  const downloads = useStore(downloadHint);
  return (
    <p className="file-chip">
      <span className="file-name">{fileName}</span>
      <span aria-hidden="true">·</span>
      {dirty && <span className="dot" aria-hidden="true" />}
      {dirty && unsaved ? (
        <button type="button" className="file-state-link" onClick={() => openIssues('changes')} title="Show what the app filled or corrected">
          {state}
        </button>
      ) : (
        <span>{state}</span>
      )}
      {downloads && (
        <>
          <span aria-hidden="true">·</span>
          <span title="Your browser can't save directly to the file. Saving will download a new copy.">Save downloads a copy</span>
        </>
      )}
    </p>
  );
}

/**
 * A status date typed in the header, once the user is done with it: the date to set, or null to go back to the plan's
 * date. `refused` = say why: a whole date outside 1950–2199 (§4.7), such as a year typed only in part (0202).
 */
export function settleStatusDate(text: string, current: string): { value: string | null; refused: boolean } {
  if (text === current || text === '') return { value: null, refused: false };
  return isPlanDate(text) ? { value: text, refused: false } : { value: null, refused: true };
}

/**
 * §7.4 Status date input and "Today"; a hint when it isn't today. Typed text is a draft, set on Enter or on leaving
 * the field (one undo step), so the half-typed years the input reports on each key (0002, 0020, 0202) never reach the
 * plan; a date picked in the calendar is set at once. Esc puts the plan's date back.
 */
function StatusDate({ date }: { date: string }) {
  const today = todayISO();
  const [draft, setDraft] = useState(date);
  const keyAt = useRef(-Infinity); // when a key was last pressed in the field
  useEffect(() => setDraft(date), [date]);
  const done = (text: string) => {
    const { value, refused } = settleStatusDate(text, date);
    if (value) setStatusDate(value);
    else setDraft(date);
    if (refused) showToast(DATE_RANGE_MESSAGE);
  };
  return (
    <div className="status-date" title="Progress is reported as of the end of this day">
      <label className="status-date-label" htmlFor="status-date">
        Status date
      </label>
      <input
        id="status-date"
        type="date"
        className="status-date-input"
        min={PLAN_DATE_MIN}
        max={PLAN_DATE_MAX}
        value={draft}
        onKeyDown={(e) => {
          keyAt.current = e.timeStamp;
          if (e.key === 'Enter') done(e.currentTarget.value);
          if (e.key === 'Escape') setDraft(date);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          // No key just pressed: a pick in the calendar, set at once. Typing waits for Enter or blur.
          if (e.timeStamp - keyAt.current > 100 && isPlanDate(e.target.value)) setStatusDate(e.target.value);
        }}
        onBlur={(e) => done(e.target.value)}
      />
      <button
        type="button"
        className="btn-link"
        // A click leaves focus where it is, so a half-typed date isn't refused (with a toast) on its way to today's.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setStatusDate(today)}
        disabled={date === today}
      >
        Today
      </button>
      {date !== today && <span className="status-date-hint">Today is {formatDayMonth(today)}</span>}
    </div>
  );
}
