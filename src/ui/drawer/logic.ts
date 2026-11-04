// Pure rules of the task drawer (SPEC §7.9), kept apart from the components so they can be tested.
import { MAX_DAYS } from '../../config';
import { isPlanDate } from '../../engine/dates';
import type { Task, TaskResult } from '../../engine/types';
import { DATE_RANGE_MESSAGE } from '../../store/rules';
import { formatVariance } from '../common/format';
import { parseDuration } from '../common/numbers';
import { STATUS_LABEL, STATUS_SLUG } from '../common/status';

/** Leaving a field: save the draft, or say why it can't be saved; nothing when it is unchanged. */
export function leaveField(draft: string, value: string, problem: string | null): { save?: string; message?: string } {
  if (problem) return { message: problem };
  return draft !== value ? { save: draft } : {};
}

/**
 * The text leaving a field settles: its draft, else '' for a date half-typed into an empty input (the browser sends
 * no change for it, so there is no draft, yet it must still say "Incomplete date"); null: nothing was edited.
 */
export function settledText(draft: string | null, halfTypedDate: boolean): string | null {
  return draft ?? (halfTypedDate ? '' : null);
}

/** Why a typed date can't be saved: only a complete date in 1950–2199 is, or a cleared field unless `required` says why not. */
export function dateProblem(text: string, incomplete: boolean, required?: string): string | null {
  if (incomplete) return 'Incomplete date — not saved';
  if (text === '') return required ?? null;
  return isPlanDate(text) ? null : DATE_RANGE_MESSAGE; // the store refuses it too: same words
}

/** Why a typed Planned Duration can't be saved (0 makes a milestone, so a blank isn't read as 0); a decimal is rounded. */
export function durationProblem(text: string): string | null {
  if (text.trim() === '') return "Duration can't be empty — 0 makes a milestone";
  return parseDuration(text).error ?? null; // the grid's Duration editor checks it the same way
}

/** Lag typed in the drawer: whole working days within ±MAX_DAYS; blank = 0. */
export function parseLag(text: string): { lag: number } | { message: string } {
  const t = text.trim();
  if (!/^-?\d*$/.test(t) || t === '-') return { message: 'Lag must be a whole number of working days' };
  const lag = Number(t) || 0; // '-0' is 0
  return Math.abs(lag) > MAX_DAYS ? { message: `Lag must be between −${MAX_DAYS} and ${MAX_DAYS} working days` } : { lag };
}

const pickerQuery = (query: string) => query.trim().replace(/^#\s*/, '').toLowerCase();

/** Picker rows (§7.9): the exact ID first, then IDs starting with the query, then names containing it; "#12" reads as 12. */
export function pickerMatches(tasks: readonly Task[], selfId: number, query: string): Task[] {
  const q = pickerQuery(query);
  const others = tasks.filter((t) => t.id !== selfId);
  if (q === '') return others;
  const id = (t: Task) => String(t.id);
  return [
    ...others.filter((t) => id(t) === q),
    ...others.filter((t) => id(t) !== q && id(t).startsWith(q)),
    ...others.filter((t) => !id(t).startsWith(q) && t.name.toLowerCase().includes(q)),
  ];
}

/**
 * Row the picker highlights first: none before anything is typed (Enter then links nothing; ↓ goes to the first
 * row), an exact ID match even when it can't be picked (Enter then does nothing rather than pick another task), else
 * the first row that can be picked; -1 when there is none.
 */
export function pickerStart(ids: readonly number[], enabled: readonly boolean[], query: string): number {
  const q = pickerQuery(query);
  if (q === '') return -1;
  if (ids.length > 0 && String(ids[0]) === q) return 0;
  return enabled.indexOf(true);
}

/** The next row that can be picked from `from` towards `dir`; stays put at the ends. */
export function pickerStep(enabled: readonly boolean[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < enabled.length; i += dir) if (enabled[i]) return i;
  return from;
}

export interface HeaderChip {
  label: string;
  slug: 'completed' | 'progress' | 'late' | 'idle';
}

/**
 * Header chips (§7.9 "(In progress) (Late +3d)"): the work state, then how late. A finished task's variance is
 * history, not an alarm, so it gets a neutral chip.
 */
export function drawerChips(r: Pick<TaskResult, 'status' | 'variance' | 'actualStart' | 'progress'>): HeaderChip[] {
  if (r.status === 'Late') {
    const started = r.actualStart !== undefined || r.progress > 0; // the engine's test for an unfinished task
    return [started ? { label: STATUS_LABEL['In Progress'], slug: 'progress' } : { label: STATUS_LABEL['Not Started'], slug: 'idle' }, { label: `Late ${formatVariance(r.variance)}`, slug: 'late' }];
  }
  const chips: HeaderChip[] = [{ label: STATUS_LABEL[r.status], slug: STATUS_SLUG[r.status] }];
  if (r.status === 'Completed' && r.variance !== 0) chips.push({ label: `Finished ${Math.abs(r.variance)}d ${r.variance > 0 ? 'late' : 'early'}`, slug: 'idle' });
  return chips;
}

/**
 * The drawer's previous / next task: the shown rows (`order`) just before and after this task in plan order, so
 * stepping still works when the task has just left a filter such as "Late only".
 */
export function neighbours(tasks: readonly Task[], order: readonly number[], id: number): { prev?: number; next?: number } {
  const index = new Map(tasks.map((t, i) => [t.id, i]));
  const at = index.get(id) ?? -1;
  const pos = (other: number) => index.get(other) ?? -1;
  return { prev: order.filter((o) => pos(o) < at).at(-1), next: order.find((o) => pos(o) > at) };
}
