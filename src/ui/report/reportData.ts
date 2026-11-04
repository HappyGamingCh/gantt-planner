// What the report shows (SPEC §9.3), derived from the computed plan. Pure functions.
import { HEATMAP_DAILY_MAX_SPAN, HEATMAP_DAYS, HEATMAP_WEEKS, type ReportOptions } from '../../config';
import { createCalendar } from '../../engine/calendar';
import { addDays, dayOfWeek, toDayNumber } from '../../engine/dates';
import type { AssigneeSummary, ComputeResult, ISODate, Plan, SCurvePoint } from '../../engine/types';
import type { Row } from '../../store/selectors';
import { formatDateLong, formatPct, formatPts, formatSigned, formatVariance, plural } from '../common/format';

export const isMilestone = ({ r }: Row) => r.plannedDuration === 0;
const started = ({ r }: Row) => r.actualStart !== undefined || r.progress > 0;

/** Status donut: tasks completed, in progress (late or not) and not started (late or not), plus how many are late. */
export function donut(rows: readonly Row[]) {
  const tasks = rows.filter((row) => !isMilestone(row));
  const completed = tasks.filter((row) => row.r.status === 'Completed').length;
  const inProgress = tasks.filter((row) => row.r.status !== 'Completed' && started(row)).length;
  return { completed, inProgress, notStarted: tasks.length - completed - inProgress, late: tasks.filter((row) => row.r.status === 'Late').length };
}

/** Late tasks, largest delay first. */
export function lateTasks(rows: readonly Row[]): Row[] {
  return rows.filter((row) => row.r.status === 'Late').sort((a, b) => b.r.variance - a.r.variance || a.task.id - b.task.id);
}

/** The Late tasks table's rows split into tasks (the KPI late count) and milestones (§17). */
export function lateSummary(rows: readonly Row[]): { tasks: number; milestones: number } {
  const late = lateTasks(rows);
  const milestoneCount = late.filter(isMilestone).length;
  return { tasks: late.length - milestoneCount, milestones: milestoneCount };
}

/** In (SD, SD + N days]: the look-ahead window (§9.3). */
const inWindow = (sd: ISODate, days: number) => {
  const end = addDays(sd, days);
  return (d: ISODate) => d > sd && d <= end;
};

/** Look-ahead: unfinished tasks in progress, plus those starting or finishing in the window; by forecast start. */
export function lookAhead(rows: readonly Row[], sd: ISODate, days: number): Row[] {
  const inside = inWindow(sd, days);
  return rows
    .filter((row) => row.r.status !== 'Completed' && (started(row) || inside(row.r.forecastStart) || inside(row.r.forecastFinish)))
    .sort((a, b) => a.r.forecastStart.localeCompare(b.r.forecastStart) || a.task.id - b.task.id);
}

export function milestones(rows: readonly Row[]): Row[] {
  return rows.filter(isMilestone);
}

/** The whole-report empty state (§9.3), shown instead of the pages with Print disabled; null when there is a report. */
export function reportEmptyNote(taskCount: number, sections: Pick<ReportOptions, 'summary' | 'assignees' | 'attention' | 'gantt'>): string | null {
  if (taskCount === 0) return 'No tasks to report yet. Add tasks in Plan mode, then open the report again.';
  if (!sections.summary && !sections.assignees && !sections.attention && !sections.gantt) return 'Turn on at least one section in Options.';
  return null;
}

/** By-assignee table order: the worst variance first (§9.3). */
export function assigneesByVariance(list: readonly AssigneeSummary[]): AssigneeSummary[] {
  return [...list].sort((a, b) => a.variancePts - b.variancePts);
}

/**
 * Key messages (§9.3): at most five plain sentences, the same numbers as the KPI strip. When every task is
 * Completed, message 2 reads "Finished on …" and the look-ahead message is left out.
 */
export function keyMessages(result: ComputeResult, rows: readonly Row[], sd: ISODate, days: number): string[] {
  const s = result.summary;
  // A plan without tasks is not "On track" (the KPI cards show "—" too).
  if (s.counts.total === 0) return ['No tasks yet.'];
  const slip = Math.abs(s.finishVariance);
  const done = rows.length > 0 && rows.every((row) => row.r.status === 'Completed');
  const finish = `${done ? 'Finished on' : 'Forecast finish is'} ${formatDateLong(s.forecastFinish)}`;
  const late = lateTasks(rows.filter((row) => !isMilestone(row)));
  const worst = late[0];
  const inside = inWindow(sd, days);
  const tasks = rows.filter((row) => !isMilestone(row));
  const starts = tasks.filter((row) => inside(row.r.forecastStart)).length;
  const finishes = tasks.filter((row) => inside(row.r.forecastFinish)).length;
  const pct = (n: number) => `${formatSigned(Math.round(n))}%`;
  const messages = [
    `Overall progress is ${formatPct(s.actualPct)} against a plan of ${formatPct(s.plannedPct)} (${formatPts(s.variancePts)}, ${s.state}).`,
    s.finishVariance === 0
      ? `${finish}, on the planned finish date.`
      : `${finish}, ${plural(slip, 'working day')} ${s.finishVariance > 0 ? 'after' : 'before'} the planned finish.`,
    worst
      ? `${plural(late.length, 'task')} ${late.length === 1 ? 'is' : 'are'} late; the largest delay is #${worst.task.id} ${worst.task.name} (${formatVariance(worst.r.variance)}).`
      : 'No tasks are late.',
    `Last 7 days: ${pct(s.weekActualDelta)} actual vs ${pct(s.weekPlannedDelta)} planned.`,
  ];
  if (!done) {
    messages.push(`Next ${plural(days, 'day')}: ${plural(starts, 'task')} ${starts === 1 ? 'starts' : 'start'} and ${plural(finishes, 'task')} ${finishes === 1 ? 'finishes' : 'finish'}.`);
  }
  return messages;
}

export interface Workload {
  unit: 'day' | 'week';
  /** The day, or the Monday of the week, of each column. */
  columns: ISODate[];
  /** Per column: a holiday (daily columns only), shown blank and not counted. */
  holiday: boolean[];
  /** Per assignee, per column. */
  counts: number[][];
}

/**
 * Workload heatmap (§9.3): unfinished tasks per assignee whose forecast window overlaps each column. When the
 * forecast finish is at most 42 days after Project Start, one column per day for SD+1 … min(SD+14, forecast finish);
 * otherwise one column per week from the week of SD to the week of the forecast finish, at most 8. No columns when
 * no task is open or those ranges are empty (the page then shows a note).
 */
export function workload(rows: readonly Row[], names: readonly string[], plan: Pick<Plan, 'project' | 'holidays'>, forecastFinish: ISODate): Workload {
  const sd = plan.project.statusDate;
  const daily = addDays(plan.project.projectStart, HEATMAP_DAILY_MAX_SPAN) >= forecastFinish;
  const open = rows.filter((row) => !isMilestone(row) && row.r.status !== 'Completed');
  const clamp = (n: number, max: number) => (open.length === 0 ? 0 : Math.min(max, Math.max(0, n)));
  const assignedTo = (row: Row, name: string) =>
    name === 'Unassigned' ? row.task.assigned.length === 0 : row.task.assigned.some((a) => a.trim().toLowerCase() === name.toLowerCase());
  const count = (name: string, from: ISODate, to: ISODate) =>
    open.filter((row) => assignedTo(row, name) && row.r.forecastStart <= to && row.r.forecastFinish >= from).length;

  if (daily) {
    const isWorkday = createCalendar(plan.holidays.map((h) => h.date)).isWorkday;
    const columns = Array.from({ length: clamp(toDayNumber(forecastFinish) - toDayNumber(sd), HEATMAP_DAYS) }, (_, i) => addDays(sd, i + 1));
    const holiday = columns.map((d) => !isWorkday(d));
    return { unit: 'day', columns, holiday, counts: names.map((name) => columns.map((d, j) => (holiday[j] ? 0 : count(name, d, d)))) };
  }
  const monday = addDays(sd, -((dayOfWeek(sd) + 6) % 7));
  const weeks = clamp(Math.floor((toDayNumber(forecastFinish) - toDayNumber(monday)) / 7) + 1, HEATMAP_WEEKS);
  const columns = Array.from({ length: weeks }, (_, i) => addDays(monday, 7 * i));
  return { unit: 'week', columns, holiday: columns.map(() => false), counts: names.map((name) => columns.map((week) => count(name, week, addDays(week, 6)))) };
}

/**
 * S-curve points for the chart: the engine's points (§5.9) after a point on the day before the first one, so the
 * lines rise from 0 %. Its values follow the engine's rules: Actual 0 up to the status date, Forecast 0 from it.
 */
export function sCurveChartPoints(points: readonly SCurvePoint[], statusDate: ISODate): SCurvePoint[] {
  const first = points[0];
  if (!first) return [];
  const date = addDays(first.date, -1);
  return [{ date, planned: 0, actual: date <= statusDate ? 0 : null, forecast: date < statusDate ? null : 0 }, ...points];
}

/** Where the status date sits on the S-curve: a point index, before the first or after the last point, or nowhere. */
export function statusDateSlot(points: readonly SCurvePoint[], statusDate: ISODate): number | 'before' | 'after' | null {
  if (points.length === 0) return null;
  const i = points.findIndex((p) => p.date === statusDate);
  if (i >= 0) return i;
  return statusDate < points[0]!.date ? 'before' : statusDate > points.at(-1)!.date ? 'after' : null;
}

const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });

/** A chart label of at most `max` characters, ending in "…" when cut; Thai vowel and tone marks don't count. */
export function shortLabel(text: string, max = 22): string {
  const chars = Array.from(graphemes.segment(text), (s) => s.segment);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}
