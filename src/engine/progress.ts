// Progress metrics (SPEC §5.8). Every task weighs the same; milestones are excluded from percentages and task counts.
import { SCHEDULE_STATE_BANDS } from '../config';
import type { Calendar } from './calendar';
import { addDays, minDate } from './dates';
import { actualPctAt, mean, plannedPct } from './scurve';
import type { AssigneeSummary, ISODate, Project, ProjectSummary, Resource, ScheduleState, TaskCalc } from './types';

/** Rounds to 0.1, half away from zero (−3.45 → −3.5), never returning −0. */
const round1 = (x: number): number => (Math.sign(x) * Math.round(Math.abs(x) * 10)) / 10 || 0;

export function scheduleState(variancePts: number): ScheduleState {
  if (variancePts >= SCHEDULE_STATE_BANDS.ahead) return 'Ahead';
  if (variancePts > SCHEDULE_STATE_BANDS.onTrack) return 'On track';
  if (variancePts > SCHEDULE_STATE_BANDS.slightlyBehind) return 'Slightly behind';
  return 'Behind';
}

function countStatuses(work: readonly TaskCalc[]) {
  const count = (s: TaskCalc['status']) => work.filter((t) => t.status === s).length;
  return {
    completed: count('Completed'),
    inProgress: count('In Progress'),
    notStarted: count('Not Started'),
    late: count('Late'),
    total: work.length,
  };
}

export function summarizeProject(rows: readonly TaskCalc[], project: Project, cal: Calendar): ProjectSummary {
  const sd = project.statusDate;
  const work = rows.filter((t) => !t.isMilestone);
  const milestones = rows.filter((t) => t.isMilestone);

  let plannedStart = rows[0]?.plannedStart ?? project.projectStart;
  let plannedFinish = rows[0]?.plannedFinish ?? project.projectStart;
  let forecastFinish = rows[0]?.forecastFinish ?? project.projectStart;
  for (const t of rows) {
    if (t.plannedStart < plannedStart) plannedStart = t.plannedStart;
    if (t.plannedFinish > plannedFinish) plannedFinish = t.plannedFinish;
    if (t.forecastFinish > forecastFinish) forecastFinish = t.forecastFinish;
  }

  const actualAt = (d: ISODate) => mean(work.map((t) => actualPctAt(t, d, sd, cal)));
  const plannedAt = (d: ISODate) => mean(work.map((t) => plannedPct(t, d, cal)));
  const actualPct = mean(work.map((t) => t.progress));
  const plannedPctAtSD = plannedAt(sd);
  const variancePts = round1(actualPct - plannedPctAtSD);
  // "This week": the 7 days ending at the status date.
  const weekStart = addDays(sd, -7);

  return {
    plannedStart,
    plannedFinish,
    forecastFinish,
    finishVariance: cal.workdayDiff(plannedFinish, forecastFinish),
    durationDays: rows.length === 0 ? 0 : cal.countWorkdays(plannedStart, plannedFinish),
    elapsedDays: rows.length === 0 ? 0 : cal.countWorkdays(plannedStart, minDate(sd, plannedFinish)),
    actualPct,
    plannedPct: plannedPctAtSD,
    variancePts,
    spi: plannedPctAtSD > 0 ? actualPct / plannedPctAtSD : null,
    state: scheduleState(variancePts),
    weekActualDelta: actualAt(sd) - actualAt(weekStart),
    weekPlannedDelta: plannedPctAtSD - plannedAt(weekStart),
    counts: countStatuses(work),
    milestones: { done: milestones.filter((t) => t.status === 'Completed').length, total: milestones.length },
  };
}

/**
 * Same metrics per assignee (a shared task counts fully for each). Order: Resources sheet order, then new
 * names by first appearance, then "Unassigned". Names match case-insensitively; assignees without tasks are omitted.
 */
export function summarizeByAssignee(
  rows: readonly TaskCalc[],
  resources: readonly Resource[],
  statusDate: ISODate,
  cal: Calendar,
): AssigneeSummary[] {
  const groups = new Map<string, { name: string; type?: Resource['type']; tasks: TaskCalc[] }>();
  for (const r of resources) {
    const key = r.name.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: r.name.trim(), type: r.type, tasks: [] });
  }
  const unassigned: TaskCalc[] = [];
  for (const t of rows) {
    if (t.isMilestone) continue;
    const seen = new Set<string>();
    for (const raw of t.assigned) {
      const name = raw.trim();
      const key = name.toLowerCase();
      if (name === '' || seen.has(key)) continue;
      seen.add(key);
      let group = groups.get(key);
      if (!group) {
        group = { name, tasks: [] };
        groups.set(key, group);
      }
      group.tasks.push(t);
    }
    if (seen.size === 0) unassigned.push(t);
  }

  const list = [...groups.values()];
  if (unassigned.length > 0) list.push({ name: 'Unassigned', tasks: unassigned });
  return list
    .filter((g) => g.tasks.length > 0)
    .map((g) => {
      const counts = countStatuses(g.tasks);
      const actualPct = mean(g.tasks.map((t) => t.progress));
      const planned = mean(g.tasks.map((t) => plannedPct(t, statusDate, cal)));
      return {
        name: g.name,
        type: g.type,
        tasks: counts.total,
        completed: counts.completed,
        inProgress: counts.inProgress,
        late: counts.late,
        plannedPct: planned,
        actualPct,
        variancePts: round1(actualPct - planned),
      };
    });
}
