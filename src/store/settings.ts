// Settings (SPEC §7.14): the drafts of the General, Calendar and Resources tabs and their Apply, one undo step (§8).
// The dialog holds the drafts; the functions here are pure, except openSettings and applySettings.
import { RESOURCE_PALETTE } from '../config';
import { addDays, isPlanDate, toDayNumber } from '../engine/dates';
import type { Holiday, ISODate, Plan, Resource, Task } from '../engine/types';
import { cleanName } from '../excel/cells';
import { DATE_RANGE_MESSAGE, rootsOnProjectStart } from './edit';
import { reportMoved } from './mode';
import { assigneeKey } from './selectors';
import { showToast, useStore } from './store';
import { commit } from './undo';

const { getState: get, setState: set } = useStore;

export type SettingsTab = 'general' | 'calendar' | 'resources';

/** More › Project settings…, Calendar…, Resources… (§7.4): the Settings dialog on that tab. */
export function openSettings(tab: SettingsTab): void {
  set({ dialog: { kind: 'projectSettings', tab } });
}

// === Resources ===

/** A resource as the Resources tab edits it. */
export interface ResourceDraft {
  /** React key, stable while the dialog is open. */
  id: number;
  /** As typed. */
  name: string;
  type?: Resource['type'];
  /** Its own color; undefined = the palette's for its position (§7.2). */
  color?: string;
  /** Its name when the dialog opened; absent when added in the dialog. */
  original?: string;
  /** The Resources row it was read from (Resource.source). */
  source?: unknown;
}

/** Resources, then names used on tasks but not listed yet (the order Save appends them in, §4.4). */
export function resourceDrafts(plan: Plan): ResourceDraft[] {
  const drafts: ResourceDraft[] = plan.resources.map((r, i) => ({ id: i, name: r.name, type: r.type, color: r.color, original: r.name, source: r.source }));
  const seen = new Set(drafts.map((d) => assigneeKey(d.name)));
  for (const task of plan.tasks) {
    for (const name of task.assigned) {
      const key = assigneeKey(name);
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      drafts.push({ id: drafts.length, name: name.trim(), original: name.trim() });
    }
  }
  return drafts;
}

/** The color a draft shows: its own, else the palette's for its position. */
export const draftColor = (drafts: readonly ResourceDraft[], i: number): string =>
  drafts[i]?.color ?? RESOURCE_PALETTE[i % RESOURCE_PALETTE.length]!;

/** Tasks that name the resource (any case). */
export function tasksUsing(tasks: readonly Task[], name: string | undefined): number {
  if (name === undefined) return 0;
  const key = assigneeKey(name);
  return tasks.filter((t) => t.assigned.some((a) => assigneeKey(a) === key)).length;
}

/**
 * Removes draft i. The drafts below it that have no color of their own keep the one they show: the palette goes by
 * position (§7.14).
 */
export function withoutDraft(drafts: readonly ResourceDraft[], i: number): ResourceDraft[] {
  return drafts.flatMap((d, j) => (j === i ? [] : j > i && d.color === undefined ? [{ ...d, color: draftColor(drafts, j) }] : [d]));
}

/** Why a draft's name can't be applied (§7.14), or null. */
export function nameProblem(drafts: readonly ResourceDraft[], i: number): string | null {
  const name = cleanName(drafts[i]!.name);
  if (name === '') return 'Enter a name';
  if (/[,;]/.test(name)) return 'A name can’t contain , or ; (they separate names in Assigned)';
  const key = name.toLowerCase();
  if (drafts.some((d, j) => j < i && cleanName(d.name).toLowerCase() === key)) return 'Another resource has this name';
  return null;
}

/** The first draft whose name can't be applied, or -1. */
export const firstNameProblem = (drafts: readonly ResourceDraft[]): number => drafts.findIndex((_, i) => nameProblem(drafts, i) !== null);

const sameDrafts = (a: readonly ResourceDraft[], b: readonly ResourceDraft[]) =>
  a.length === b.length &&
  a.every((d, i) => {
    const e = b[i]!;
    return d.id === e.id && cleanName(d.name) === cleanName(e.name) && d.type === e.type && d.color?.toUpperCase() === e.color?.toUpperCase();
  });

/**
 * The plan with the drafts applied: the resources in their order, each renamed one renamed on every task that has
 * it (any case). Unchanged drafts leave the plan as it was.
 */
export function applyResourceDrafts(plan: Plan, initial: readonly ResourceDraft[], drafts: readonly ResourceDraft[]): Plan {
  if (sameDrafts(initial, drafts)) return plan;
  const resources = drafts.map((d): Resource => {
    const r: Resource = { name: cleanName(d.name) };
    if (d.type) r.type = d.type;
    if (d.color) r.color = d.color.toUpperCase();
    if (d.source !== undefined) r.source = d.source;
    return r;
  });
  const renamed = new Map(drafts.filter((d) => d.original !== undefined && cleanName(d.name) !== d.original).map((d) => [assigneeKey(d.original!), cleanName(d.name)]));
  const tasks =
    renamed.size === 0
      ? plan.tasks
      : plan.tasks.map((t) =>
          t.assigned.some((a) => renamed.has(assigneeKey(a))) ? { ...t, assigned: t.assigned.map((a) => renamed.get(assigneeKey(a)) ?? a) } : t,
        );
  return { ...plan, resources, tasks };
}

// === Calendar ===

/** Holidays sorted by date, one per date (the first one listed is kept). */
export function sortedHolidays(holidays: readonly Holiday[]): Holiday[] {
  const byDate = new Map<ISODate, Holiday>();
  for (const h of holidays) if (!byDate.has(h.date)) byDate.set(h.date, h);
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Longest range Add takes at once, in days (§7.14). */
export const MAX_HOLIDAY_RANGE = 366;

/**
 * Add in the Holidays list (§7.14): every date from `from` to `to` (or `from` alone) not listed yet, with the
 * description. `message` says why nothing was added.
 */
export function addHolidays(list: readonly Holiday[], from: ISODate, to: ISODate, description: string): { list: Holiday[]; message?: string } {
  if (!isPlanDate(from) || (to !== '' && !isPlanDate(to))) return { list: [...list], message: DATE_RANGE_MESSAGE };
  const last = to === '' ? from : to;
  if (last < from) return { list: [...list], message: 'The end date is before the start date' };
  const days = toDayNumber(last) - toDayNumber(from) + 1;
  if (days > MAX_HOLIDAY_RANGE) return { list: [...list], message: `Add at most ${MAX_HOLIDAY_RANGE} days at a time` };
  const listed = new Set(list.map((h) => h.date));
  const added = Array.from({ length: days }, (_, i) => addDays(from, i)).filter((d) => !listed.has(d));
  if (added.length === 0) return { list: [...list], message: days === 1 ? 'Already a holiday' : 'These dates are already holidays' };
  return { list: sortedHolidays([...list, ...added.map((date) => ({ date, description: description.trim() }))]) };
}

const sameHolidays = (a: readonly Holiday[], b: readonly Holiday[]) => a.length === b.length && a.every((h, i) => h.date === b[i]!.date && h.description === b[i]!.description);

/** The working days to store: undefined for every day of the week (§4.2). */
const normalDays = (days: readonly number[]) => (days.length >= 7 ? undefined : [...days].sort((a, b) => a - b));
const sameDays = (a: readonly number[] | undefined, b: readonly number[] | undefined) =>
  (a ?? [0, 1, 2, 3, 4, 5, 6]).join() === (b ?? [0, 1, 2, 3, 4, 5, 6]).join();

// === Apply ===

export interface SettingsDraft {
  name: string;
  owner: string;
  projectStart: string;
  /** Also move the root tasks on the old Project Start (§8). */
  moveRoots: boolean;
  /** Working weekdays, 0 = Sunday … 6 = Saturday; never empty. */
  workingDays: number[];
  holidays: Holiday[];
  /** The resource drafts when the dialog opened, and now. */
  initialResources: ResourceDraft[];
  resources: ResourceDraft[];
}

/**
 * Apply (§7.14): every tab's drafts as one undo step, then the dialog closes. Refused, with the dialog left open, for
 * a Project Start outside 1950–2199 (a toast says so) or a resource name that can't be used (the tab says why).
 */
export function applySettings(draft: SettingsDraft): boolean {
  const { plan, result } = get();
  if (!plan || !result) return false;
  if (draft.projectStart !== '' && !isPlanDate(draft.projectStart)) {
    showToast(DATE_RANGE_MESSAGE);
    return false;
  }
  if (firstNameProblem(draft.resources) >= 0) return false;

  const old = plan.project;
  const projectStart = draft.projectStart || old.projectStart;
  const project = { ...old, name: cleanName(draft.name) || old.name, owner: draft.owner.trim(), projectStart };
  const workingDays = normalDays(draft.workingDays);
  if (!sameDays(workingDays, old.workingDays)) {
    delete project.workingDaysText; // written as the app's list from now on (§4.8)
    if (workingDays) project.workingDays = workingDays;
    else delete project.workingDays;
  }
  const holidays = sortedHolidays(draft.holidays.map((h) => ({ date: h.date, description: h.description.trim() })));
  const calendarChanged = !sameDays(workingDays, old.workingDays) || !sameHolidays(holidays, sortedHolidays(plan.holidays));
  const moving = draft.moveRoots && old.mode === 'Plan' && projectStart !== old.projectStart;
  const move = new Set(moving ? rootsOnProjectStart(plan, result).map((t) => t.id) : []);

  const before = new Map(result.tasks.map((r) => [r.id, r]));
  commit(
    (p) => {
      const next = applyResourceDrafts(p, draft.initialResources, draft.resources);
      return {
        ...next,
        project,
        // The file's order is kept until the list changes; then it is the sorted list
        holidays: sameHolidays(holidays, sortedHolidays(p.holidays)) ? p.holidays : holidays,
        tasks: move.size > 0 ? next.tasks.map((t) => (move.has(t.id) ? { ...t, plannedStart: projectStart } : t)) : next.tasks,
      };
    },
    { dialog: null },
  );
  // A new calendar moves planned dates in Plan mode (a new Project Start moves only what the user asked to move).
  if (calendarChanged) reportMoved(before);
  return true;
}
