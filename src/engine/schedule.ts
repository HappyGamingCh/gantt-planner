// Planned schedule / baseline (SPEC §5.4), counted in half days (§5.1).
import { MAX_DAYS } from '../config';
import { dayOf, endOfDayOf, finishHalf, halfOf, isAfternoon, morningOf, type Calendar, type Half } from './calendar';
import { makeIssue } from './issues';
import type { Change, ISODate, Issue, Link, Project, Task } from './types';

export interface Planned {
  start: ISODate;
  duration: number;
  finish: ISODate;
  /** The half it starts in and the half it finishes in. A start milestone sits at the start of its half: f = s. */
  s: Half;
  f: Half;
  /** A milestone at the start of its half (startMilestones), so its f is a start rather than an end. */
  startMs: boolean;
}

/** A task's place for its successors' links: where it starts and finishes, in halves. */
export interface Placed {
  s: Half;
  f: Half;
  startMs: boolean;
}

/**
 * Start milestones sit at the start of their day: milestones with no predecessors, or only start-milestone
 * predecessors (e.g. "Shutdown"). Any other milestone sits at the end of its predecessor's finish day.
 */
export function startMilestones(order: readonly Task[], calcLinks: Map<number, Link[]>): Set<number> {
  const result = new Set<number>();
  for (const task of order) {
    if (task.plannedDuration === 0 && (calcLinks.get(task.id) ?? []).every((l) => result.has(l.predId))) result.add(task.id);
  }
  return result;
}

/** FS gap in halves: 0 into a milestone or out of a start milestone, else 1 (the next half). */
export function fsGap(predIsStartMilestone: boolean, taskIsMilestone: boolean): number {
  return predIsStartMilestone || taskIsMilestone ? 0 : 1;
}

/** Halves a duration of `days` working days takes. */
export const halvesOf = (days: number): number => Math.round(days * 2);

/** The half a task of `duration` days that starts in half `s` finishes in (a milestone: s). */
export function finishFrom(s: Half, duration: number, cal: Calendar): Half {
  const n = halvesOf(duration);
  return n >= 1 ? cal.addHalves(s, n - 1) : s;
}

/** Whether a finish half puts the date at midday rather than the end of the day (a start milestone: its half's start). */
export const finishesMidday = (f: Half, startMs: boolean): boolean => (startMs ? isAfternoon(f) : !isAfternoon(f));

/**
 * Where a link lets its task start (§5.4); into an end milestone (`endMilestone`), the half the milestone may sit at
 * the end of: an FS link gives the predecessor's finish half plus the lag, an SS link (or an FS link from a start
 * milestone) the end of that day, as whole days did.
 */
export function linkHalf(link: Link, pred: Placed, endMilestone: boolean, taskIsMilestone: boolean, cal: Calendar): Half {
  const lag = halvesOf(link.lag);
  if (link.type === 'SS') {
    const h = cal.addHalves(pred.s, lag);
    return endMilestone ? endOfDayOf(h) : h;
  }
  if (endMilestone) {
    const h = cal.addHalves(pred.f, lag);
    return pred.startMs ? endOfDayOf(h) : h;
  }
  return cal.addHalves(pred.f, fsGap(pred.startMs, taskIsMilestone) + lag);
}

/** A date for the Changes list: the day, with " afternoon" or " midday" when the half says so. */
export const withHalf = (d: ISODate, half: boolean | undefined, word: 'afternoon' | 'midday'): string => (half ? `${d} ${word}` : d);

/**
 * Plan mode derives every planned value from the inputs. Track mode keeps stored planned values
 * (frozen) and derives only blank ones — except tasks added this session, which behave as in Plan mode.
 */
export function schedulePlanned(
  order: readonly Task[],
  calcLinks: Map<number, Link[]>,
  startMs: ReadonlySet<number>,
  project: Project,
  cal: Calendar,
  issues: Issue[],
  changes: Change[],
): Map<number, Planned> {
  const planned = new Map<number, Planned>();

  for (const task of order) {
    const frozen = project.mode === 'Track' && !task.isNewThisSession;
    const change = (field: string, from: unknown, to: unknown, kind: Change['kind'], reason: string) =>
      changes.push({ taskId: task.id, field, from, to, kind, reason });
    const milestone = task.plannedDuration === 0; // blank duration counts as non-milestone
    const atStart = milestone && startMs.has(task.id);
    const storedStart = task.plannedStart === undefined ? undefined : halfOf(task.plannedStart, task.plannedStartPM);
    const startText = (h: Half) => withHalf(dayOf(h), isAfternoon(h), 'afternoon');
    const storedStartText = task.plannedStart === undefined ? undefined : withHalf(task.plannedStart, task.plannedStartPM, 'afternoon');

    // 1. Planned Start (an end milestone's finish comes with it)
    let s: Half;
    let endAt: Half | undefined;
    const links = calcLinks.get(task.id) ?? [];
    if (frozen && storedStart !== undefined) {
      s = storedStart;
    } else if (links.length > 0) {
      const endMilestone = milestone && !atStart;
      const at = Math.max(...links.map((link) => linkHalf(link, planned.get(link.predId)!, endMilestone, milestone, cal)));
      if (endMilestone) endAt = at;
      s = endMilestone ? morningOf(at) : at;
      if (storedStart === undefined) {
        change('Planned Start', undefined, startText(s), 'filled', 'Set by predecessors');
      } else if (storedStart !== s) {
        change('Planned Start', storedStartText, startText(s), 'corrected', 'Driven by predecessors — use lag to delay');
        issues.push(makeIssue('W_START_DRIVEN', { id: task.id }));
      }
    } else {
      s = cal.snapHalf(storedStart ?? halfOf(project.projectStart));
      if (storedStart === undefined) {
        change('Planned Start', undefined, startText(s), 'filled', 'From Project Start');
      } else if (storedStart !== s) {
        change('Planned Start', storedStartText, startText(s), 'corrected', 'Moved to next working day');
        issues.push(makeIssue('W_NONWORKDAY', { id: task.id }));
      }
    }

    // 2. Planned Duration (above MAX_DAYS: invalid and treated as blank, so a typo can't stretch the plan for centuries)
    let duration: number;
    const stored = task.plannedDuration;
    const valid = stored !== undefined && stored >= 0 && stored <= MAX_DAYS;
    if (stored !== undefined && !valid) {
      issues.push(makeIssue('W_BAD_NUMBER', { id: task.id, text: String(stored), field: 'Planned Duration' }));
    }
    const storedFinish = task.plannedFinish === undefined ? undefined : finishHalf(task.plannedFinish, task.plannedFinishMidday);
    if (valid) {
      duration = stored === 0 ? 0 : Math.max(0.5, halvesOf(stored) / 2); // the reader and the app give steps of 0.5
    } else if (storedFinish !== undefined && storedFinish >= s) {
      const halves = cal.countHalves(s, storedFinish);
      duration = halves > 0 ? halves / 2 : 1; // no working half between them (a frozen start on a holiday): 1 day, as before
      change('Planned Duration', undefined, duration, 'filled', 'From Planned Finish');
    } else {
      duration = 1;
      change('Planned Duration', undefined, duration, 'filled', 'No duration — set to 1 day');
      issues.push(makeIssue('W_NO_DURATION', { id: task.id }));
    }

    // 3. Planned Finish
    let f: Half;
    if (frozen && task.plannedFinish !== undefined) {
      f = atStart ? halfOf(task.plannedFinish, task.plannedFinishMidday) : storedFinish!;
    } else {
      if (duration > 0) f = finishFrom(s, duration, cal);
      else f = atStart ? s : (endAt ?? endOfDayOf(s));
      const midday = finishesMidday(f, atStart);
      const finishText = withHalf(dayOf(f), midday, 'midday');
      if (task.plannedFinish === undefined) {
        change('Planned Finish', undefined, finishText, 'filled', 'From start and duration');
      } else if (task.plannedFinish !== dayOf(f) || !!task.plannedFinishMidday !== midday) {
        change('Planned Finish', withHalf(task.plannedFinish, task.plannedFinishMidday, 'midday'), finishText, 'corrected', 'Recalculated from duration');
        issues.push(makeIssue('W_FINISH_RECALC', { id: task.id }));
      }
    }

    planned.set(task.id, { start: dayOf(s), duration, finish: dayOf(f), s, f, startMs: atStart });
  }
  return planned;
}
