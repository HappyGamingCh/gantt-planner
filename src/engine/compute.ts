// Engine entry point: full recompute from inputs (SPEC §3.3, §5.3).
import { applyActualRules } from './actuals';
import { createCalendar, type Calendar } from './calendar';
import { computeTotalFloat } from './critical';
import { computeForecast } from './forecast';
import { makeIssue } from './issues';
import { buildGraph } from './links';
import { normalizeLevels, outlineOf, rollUp } from './outline';
import { summarizeByAssignee, summarizeProject } from './progress';
import { schedulePlanned, startMilestones } from './schedule';
import { buildSCurve, plannedPct } from './scurve';
import { taskStatus, taskVariance } from './status';
import type { Change, ComputeResult, Issue, Plan, Project, Resource, Task, TaskCalc, TaskResult } from './types';

/** compute() for a whole plan, with the calendar built from its Holidays. */
export function computePlan(plan: Plan): ComputeResult {
  return compute(plan.project, plan.tasks, createCalendar(plan.holidays.map((h) => h.date)), plan.resources);
}

export function compute(
  project: Project,
  tasks: readonly Task[],
  calendar: Calendar,
  resources: readonly Resource[] = [],
): ComputeResult {
  const issues: Issue[] = [];
  const changes: Change[] = [];
  const sd = project.statusDate;

  // §5.12: major tasks have no links or values of their own; the schedule is the leaf tasks', then rolled up.
  const levels = normalizeLevels(tasks, changes);
  const outline = outlineOf(tasks, levels);
  const leaves = outline.summaries.size === 0 ? tasks : tasks.filter((t) => !outline.summaries.has(t.id));
  for (const task of tasks) {
    if (outline.summaries.has(task.id) && task.predecessorsText.trim() !== '') issues.push(makeIssue('W_SUMMARY_PREDS', { id: task.id }));
  }

  const graph = buildGraph(leaves, issues, changes, outline.summaries);
  const startMs = startMilestones(graph.order, graph.calcLinks);
  const planned = schedulePlanned(graph.order, graph.calcLinks, startMs, project, calendar, issues, changes);
  const actuals = applyActualRules(leaves, planned, sd, calendar, issues, changes);
  const forecast = computeForecast(graph.order, graph.calcLinks, startMs, planned, actuals, sd, calendar);
  const floats = computeTotalFloat(graph.order, graph.calcLinks, startMs, planned, actuals, forecast, calendar);

  const rows: TaskCalc[] = [];
  const levelOf = new Map(tasks.map((t, i) => [t.id, levels[i]!]));
  const leafResults = leaves.map((task): TaskResult => {
    const plan = planned.get(task.id)!;
    const act = actuals.get(task.id)!;
    const fc = forecast.get(task.id)!;
    const totalFloat = floats.get(task.id);
    const variance = taskVariance(plan.finish, fc.finish, calendar);
    const status = taskStatus(act.calcFinish !== undefined, variance, act.calcStart !== undefined || act.progress > 0);
    const row: TaskCalc = {
      id: task.id,
      assigned: task.assigned,
      isMilestone: plan.duration === 0,
      plannedStart: plan.start,
      plannedDuration: plan.duration,
      plannedFinish: plan.finish,
      progress: act.progress,
      calcStart: act.calcStart,
      calcFinish: act.calcFinish,
      forecastStart: fc.start,
      forecastFinish: fc.finish,
      status,
    };
    rows.push(row);
    return {
      id: task.id,
      level: levelOf.get(task.id)!,
      plannedStart: plan.start,
      plannedDuration: plan.duration,
      plannedFinish: plan.finish,
      progress: act.progress,
      actualStart: act.actualStart,
      actualDuration: act.actualDuration,
      forecastStart: fc.start,
      forecastFinish: fc.finish,
      variance,
      status,
      predecessorsText: graph.predecessorsText.get(task.id)!,
      links: graph.calcLinks.get(task.id)!,
      successorsText: graph.successorsText.get(task.id)!,
      plannedPctAtSD: plannedPct(row, sd, calendar),
      totalFloat,
      critical: totalFloat !== undefined && totalFloat <= 0,
    };
  });

  const resultOf = new Map(leafResults.map((r) => [r.id, r]));
  const calcOf = new Map(rows.map((row) => [row.id, row]));
  const results = tasks.map((task) => {
    const leafIds = outline.leavesOf.get(task.id);
    if (!leafIds) return resultOf.get(task.id)!;
    const leafRows = leafIds.map((id) => ({ r: resultOf.get(id)!, calc: calcOf.get(id)! }));
    return rollUp(task, levelOf.get(task.id)!, leafRows, sd, calendar);
  });

  reportNewResources(leaves, resources, issues, changes);

  return {
    tasks: results,
    summary: summarizeProject(rows, project, calendar),
    byAssignee: summarizeByAssignee(rows, resources, sd, calendar),
    sCurve: buildSCurve(rows, sd, calendar),
    issues,
    changes,
  };
}

/** §5.3 step 9: assignees missing from Resources are reported; the store/writer appends them. */
function reportNewResources(tasks: readonly Task[], resources: readonly Resource[], issues: Issue[], changes: Change[]) {
  const known = new Set(resources.map((r) => r.name.trim().toLowerCase()));
  for (const task of tasks) {
    for (const raw of task.assigned) {
      const name = raw.trim();
      const key = name.toLowerCase();
      if (name === '' || known.has(key)) continue;
      known.add(key);
      issues.push(makeIssue('W_NEW_RESOURCE', { name }));
      changes.push({ taskId: task.id, field: 'Resources', from: undefined, to: name, kind: 'filled', reason: 'New assignee' });
    }
  }
}
