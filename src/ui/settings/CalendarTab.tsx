import { X } from 'lucide-react';
import { useState } from 'react';
import { dayOfWeek, PLAN_DATE_MAX, PLAN_DATE_MIN } from '../../engine/dates';
import type { Holiday, Project } from '../../engine/types';
import { WEEK_ORDER, WEEKDAY_NAMES } from '../../excel/workingDays';
import { addHolidays } from '../../store/settings';
import { formatDateLong } from '../common/format';

/** The weekday names in full, for the checkboxes' accessible names. */
const FULL_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Settings › Calendar (SPEC §7.14): the working days of the week, and the Holidays list (read-only, with a note, when
 * the file's Holidays sheet can't be written).
 */
export function CalendarTab({
  project,
  workingDays,
  onWorkingDays,
  holidays,
  onHolidays,
  holidaysLocked,
  unreadDays,
}: {
  project: Project;
  workingDays: readonly number[];
  onWorkingDays: (days: number[]) => void;
  holidays: readonly Holiday[];
  onHolidays: (holidays: Holiday[]) => void;
  /** The Holidays sheet has content but no Date header (§4.5). */
  holidaysLocked: boolean;
  /** The file's Working Days text when it couldn't be read (W_BAD_WORKING_DAYS). */
  unreadDays?: string;
}) {
  const toggle = (day: number) => onWorkingDays(workingDays.includes(day) ? workingDays.filter((d) => d !== day) : [...workingDays, day]);
  return (
    <div className="settings-calendar">
      <fieldset className="settings-section">
        <legend>Working days</legend>
        <div className="weekdays">
          {WEEK_ORDER.map((day) => {
            const checked = workingDays.includes(day);
            const last = checked && workingDays.length === 1;
            return (
              <label key={day} className="weekday" title={last ? 'At least one day of the week is a working day' : undefined}>
                <input type="checkbox" checked={checked} disabled={last} onChange={() => toggle(day)} aria-label={FULL_NAMES[day]} />
                <span aria-hidden="true">{WEEKDAY_NAMES[day]}</span>
              </label>
            );
          })}
        </div>
        <p className="settings-hint">
          {workingDays.length} working day{workingDays.length === 1 ? '' : 's'} a week. Unticked days are non-working, like holidays.
        </p>
        {unreadDays !== undefined && (
          <p className="settings-note">
            The file’s Working Days (“{unreadDays}”) couldn’t be read, so every day counts. Choose the days here, or fix it in the Project sheet.
          </p>
        )}
      </fieldset>
      <fieldset className="settings-section">
        <legend>Holidays{holidaysLocked ? '' : ` (${holidays.length})`}</legend>
        {holidaysLocked ? (
          <p className="settings-note">
            This file’s Holidays sheet has no Date header in row 1, so its dates can’t be read or changed here. Fix the header in Excel and open the file
            again.
          </p>
        ) : (
          <>
            <AddHolidays holidays={holidays} onHolidays={onHolidays} />
            <HolidayList holidays={holidays} onHolidays={onHolidays} workingDays={workingDays} />
          </>
        )}
      </fieldset>
      {project.mode === 'Track' && <p className="settings-hint">The baseline stays as it is; forecasts, variance and the S-curve use the new calendar.</p>}
    </div>
  );
}

/** From, an optional To, a Description and Add (§7.14). Enter in a field adds too. */
function AddHolidays({ holidays, onHolidays }: { holidays: readonly Holiday[]; onHolidays: (holidays: Holiday[]) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const add = () => {
    if (from === '') return setMessage('Choose a date');
    const added = addHolidays(holidays, from, to, description);
    setMessage(added.message ?? null);
    if (added.message) return;
    onHolidays(added.list);
    setFrom('');
    setTo('');
    setDescription('');
  };
  return (
    <div
      className="holiday-add"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          add();
        }
      }}
    >
      <label className="field">
        From
        <input type="date" min={PLAN_DATE_MIN} max={PLAN_DATE_MAX} value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="field">
        To (optional)
        <input type="date" min={from || PLAN_DATE_MIN} max={PLAN_DATE_MAX} value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label className="field holiday-add-text">
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Songkran" />
      </label>
      <button type="button" className="btn" onClick={add}>
        Add
      </button>
      {message && (
        <p className="settings-error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

function HolidayList({ holidays, onHolidays, workingDays }: { holidays: readonly Holiday[]; onHolidays: (holidays: Holiday[]) => void; workingDays: readonly number[] }) {
  if (holidays.length === 0) return <p className="settings-hint">No holidays yet.</p>;
  const set = (i: number, description: string) => onHolidays(holidays.map((h, j) => (j === i ? { ...h, description } : h)));
  return (
    <ul className="settings-list holiday-list">
      {holidays.map((h, i) => {
        const day = dayOfWeek(h.date);
        const label = `${WEEKDAY_NAMES[day]} ${formatDateLong(h.date)}`;
        return (
          <li key={h.date}>
            <span className="holiday-date">{label}</span>
            <input className="settings-input" value={h.description} onChange={(e) => set(i, e.target.value)} aria-label={`Description of ${label}`} placeholder="Holiday" />
            {!workingDays.includes(day) && <span className="settings-hint holiday-off">not a working day anyway</span>}
            <button
              type="button"
              className="btn btn-icon btn-quiet"
              aria-label={`Remove holiday ${formatDateLong(h.date)}`}
              title="Remove"
              onClick={() => onHolidays(holidays.filter((_, j) => j !== i))}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
