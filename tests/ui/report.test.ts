import type { LegendItem } from 'chart.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REPORT } from '../../src/config';
import { computePlan } from '../../src/engine/compute';
import { addDays } from '../../src/engine/dates';
import type { Plan } from '../../src/engine/types';
import { SAMPLE_STATUS_DATE, sampleData } from '../../src/sample/sampleData';
import { rowsOf } from '../../src/store/selectors';
import { fittedScale } from '../../src/ui/gantt/scale';
import { assigneeBarsConfig, sCurveConfig } from '../../src/ui/report/charts';
import {
  assigneesByVariance,
  donut,
  keyMessages,
  lateSummary,
  lateTasks,
  lookAhead,
  milestones,
  reportEmptyNote,
  sCurveChartPoints,
  shortLabel,
  statusDateSlot,
  workload,
} from '../../src/ui/report/reportData';

// The sample (SPEC §13): status date Wed 30 Sep 2026.
const result = computePlan(sampleData);
const rows = rowsOf(sampleData, result);
const ids = (list: { task: { id: number } }[]) => list.map((row) => row.task.id);

describe('report data — SPEC §9.3', () => {
  it('key messages carry the KPI strip numbers', () => {
    expect(keyMessages(result, rows, SAMPLE_STATUS_DATE, 14)).toEqual([
      'Overall progress is 37% against a plan of 40% (−3.5 pts, Slightly behind).',
      'Forecast finish is 17 Oct 2026, 2 working days after the planned finish.',
      '3 tasks are late; the largest delay is #7 Calibrate instruments and inspection valves (+2d).',
      `Last 7 days: +${Math.round(result.summary.weekActualDelta)}% actual vs +${Math.round(result.summary.weekPlannedDelta)}% planned.`,
      // (30 Sep, 14 Oct]: #8, 9, 12, 13, 14, 17, 19, 21, 22, 23 start; those and #11, 16, 18 finish.
      'Next 14 days: 10 tasks start and 13 tasks finish.',
    ]);
    expect(keyMessages(result, rows, SAMPLE_STATUS_DATE, DEFAULT_REPORT.lookAheadDays).at(-1)).toBe('Next 7 days: 7 tasks start and 10 tasks finish.');
  });

  it('a finished project: "Finished on …" and no look-ahead message', () => {
    const done = finishedPlan();
    const doneResult = computePlan(done);
    const messages = keyMessages(doneResult, rowsOf(done, doneResult), done.project.statusDate, 7);
    expect(messages[1]).toBe('Finished on 15 Oct 2026, on the planned finish date.');
    expect(messages).toHaveLength(4);
    expect(messages.some((m) => m.startsWith('Next'))).toBe(false);
  });

  it('late tasks, largest delay first; a late milestone is listed too (the key message counts tasks only)', () => {
    expect(lateTasks(rows).map((row) => [row.task.id, row.r.variance])).toEqual([
      [7, 2],
      [14, 2],
      [24, 2],
      [25, 2],
    ]);
  });

  it('donut: late tasks counted as started or not', () => {
    expect(donut(rows)).toEqual({ completed: 7, inProgress: 4, notStarted: 11, late: 3 });
  });

  it('late rows split into tasks (the KPI late count) and milestones', () => {
    expect(lateSummary(rows)).toEqual({ tasks: 3, milestones: 1 });
    expect(lateSummary(rows).tasks).toBe(result.summary.counts.late);
  });

  it('look-ahead: tasks in progress plus those starting or finishing in the window of N days', () => {
    const week = lookAhead(rows, SAMPLE_STATUS_DATE, 7);
    expect(ids(week)).toContain(7); // in progress
    expect(ids(week)).toContain(8); // starts 1 Oct
    expect(ids(week)).not.toContain(2); // completed
    expect(ids(week)).toContain(20); // a milestone: listed too
    expect(ids(week)).not.toContain(21); // after (30 Sep, 7 Oct]
    expect(ids(lookAhead(rows, SAMPLE_STATUS_DATE, 3))).toEqual([7, 11, 16, 18, 8, 14, 9, 17, 12]);
    expect(ids(lookAhead(rows, SAMPLE_STATUS_DATE, 14))).not.toContain(25); // 17 Oct, after the 14-day window
    expect(week.map((row) => row.r.forecastStart)).toEqual([...week.map((row) => row.r.forecastStart)].sort());
  });

  it('milestones in row order', () => {
    expect(ids(milestones(rows))).toEqual([1, 20, 25]);
  });

  it('assignees: worst variance first', () => {
    const sorted = assigneesByVariance(result.byAssignee);
    expect(sorted.map((a) => a.variancePts)).toEqual([...sorted.map((a) => a.variancePts)].sort((a, b) => a - b));
  });

  it('workload of a short project: one column per day for the next 14 days; a holiday is not counted', () => {
    const heat = workload(rows, ['Inst', 'Unassigned'], sampleData, result.summary.forecastFinish);
    expect(heat.unit).toBe('day');
    expect(heat.columns).toEqual(Array.from({ length: 14 }, (_, i) => addDays(SAMPLE_STATUS_DATE, i + 1))); // 1 → 14 Oct
    expect(heat.columns.filter((_, i) => heat.holiday[i])).toEqual(['2026-10-13']);
    // Inst: #7 (30 Sep → 15 Oct); #24 (16 → 17 Oct) is after the columns; 13 Oct is a holiday.
    expect(heat.counts[0]).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1]);
    expect(heat.counts[1]).toEqual(Array(14).fill(0)); // #4 is done; the rest are milestones
    // The columns stop at the forecast finish.
    expect(workload(rows, ['Inst'], sampleData, '2026-10-04').columns).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  });

  it("workload of a longer project: weeks from the status date's Monday to the forecast finish's, at most 8", () => {
    const long = { ...sampleData, project: { ...sampleData.project, projectStart: '2026-08-01' } };
    const heat = workload(rows, ['Inst'], long, result.summary.forecastFinish); // 77 days after Project Start
    expect(heat.unit).toBe('week');
    expect(heat.columns).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(heat.counts[0]).toEqual([1, 1, 2]); // #7 (30 Sep → 15 Oct) and #24 (16 → 17 Oct)
    expect(heat.holiday).toEqual([false, false, false]);
    expect(workload(rows, ['Inst'], long, '2027-06-01').columns).toHaveLength(8);
  });

  it('workload: no columns when nothing is open after the status date (the page shows a note)', () => {
    const done = finishedPlan(); // status date 30 Oct, finished 15 Oct
    const doneResult = computePlan(done);
    expect(workload(rowsOf(done, doneResult), ['Inst'], done, doneResult.summary.forecastFinish)).toEqual({ unit: 'day', columns: [], holiday: [], counts: [[]] });
    // Open tasks, but the forecast finish is not after the status date (daily) / before the status date's week (weekly).
    expect(workload(rows, ['Inst'], sampleData, SAMPLE_STATUS_DATE).columns).toEqual([]);
    const long = { ...sampleData, project: { ...sampleData.project, projectStart: '2026-08-01' } };
    expect(workload(rows, ['Inst'], long, '2026-09-27').columns).toEqual([]);
    expect(workload(rows, ['Inst'], long, '2026-09-28').columns).toEqual(['2026-09-28']);
  });

  it('whole-report empty states: no tasks, or no section on', () => {
    expect(reportEmptyNote(25, DEFAULT_REPORT)).toBeNull();
    expect(reportEmptyNote(25, { ...DEFAULT_REPORT, summary: false, attention: false, gantt: false })).toBeNull();
    expect(reportEmptyNote(0, DEFAULT_REPORT)).toBe('No tasks to report yet. Add tasks in Plan mode, then open the report again.');
    expect(reportEmptyNote(25, { ...DEFAULT_REPORT, summary: false, assignees: false, attention: false, gantt: false })).toBe('Turn on at least one section in Options.');
  });

  it('chart labels: at most 22 characters; Thai vowel and tone marks do not count', () => {
    expect(shortLabel('Contractor A')).toBe('Contractor A');
    expect(shortLabel('ทีมเครื่องมือวัด')).toBe('ทีมเครื่องมือวัด');
    expect(shortLabel('บริษัท ไทยเอ็นจิเนียริ่ง แอนด์ คอนสตรัคชั่น จำกัด')).toBe('บริษัท ไทยเอ็นจิเนียริ่ง แอน…');
    const bars = assigneeBarsConfig([{ ...result.byAssignee[0]!, name: 'A very long contractor company name' }]);
    expect(bars.data.labels).toEqual(['A very long contracto…']); // 21 + "…"
    expect(bars.options?.scales?.y?.ticks?.autoSkip).toBe(false);
  });
});

/** The sample with every task done on its planned dates; status date 30 Oct, after the finish. */
function finishedPlan(): Plan {
  return {
    ...sampleData,
    project: { ...sampleData.project, statusDate: '2026-10-30' },
    tasks: sampleData.tasks.map((t) => {
      const r = result.tasks.find((x) => x.id === t.id)!;
      return { ...t, progress: 100, actualStart: r.plannedStart, actualFinish: r.plannedFinish };
    }),
  };
}

describe('report S-curve chart — SPEC §9.2, §9.3', () => {
  it('rises from a 0 % point on the day before the first point; the engine data is unchanged', () => {
    const pts = sCurveChartPoints(result.sCurve, SAMPLE_STATUS_DATE);
    expect(pts).toHaveLength(result.sCurve.length + 1);
    expect(pts[0]).toEqual({ date: addDays(result.sCurve[0]!.date, -1), planned: 0, actual: 0, forecast: null });
    expect(pts.slice(1)).toEqual(result.sCurve);
    expect(sCurveChartPoints([], SAMPLE_STATUS_DATE)).toEqual([]);
    // Status date before the curve: no Actual yet; the Forecast starts from 0.
    expect(sCurveChartPoints(result.sCurve, '2026-09-01')[0]).toMatchObject({ actual: null, forecast: 0 });
  });

  it('status date: a point, or an edge label before or after the curve', () => {
    const pts = sCurveChartPoints(result.sCurve, SAMPLE_STATUS_DATE);
    expect(pts[statusDateSlot(pts, SAMPLE_STATUS_DATE) as number]!.date).toBe(SAMPLE_STATUS_DATE);
    expect(statusDateSlot(pts, '2026-09-01')).toBe('before');
    expect(statusDateSlot(pts, '2026-11-30')).toBe('after');
    expect(statusDateSlot([], SAMPLE_STATUS_DATE)).toBeNull();
  });

  it('draws Actual and Forecast over Planned; the legend keeps Planned · Actual · Forecast', () => {
    const config = sCurveConfig(result.sCurve, SAMPLE_STATUS_DATE, true);
    const [planned, actual, forecast] = config.data.datasets;
    expect([planned!.label, actual!.label, forecast!.label]).toEqual(['Planned', 'Actual', 'Forecast']);
    expect(actual!.order).toBeLessThan(planned!.order!);
    expect(forecast!.order).toBeLessThan(planned!.order!);
    const sort = config.options!.plugins!.legend!.labels!.sort!;
    const items = [{ datasetIndex: 2 }, { datasetIndex: 0 }, { datasetIndex: 1 }] as LegendItem[];
    expect(items.sort((a, b) => sort(a, b, config.data)).map((i) => i.datasetIndex)).toEqual([0, 1, 2]);
    expect(sCurveConfig(result.sCurve, SAMPLE_STATUS_DATE, false).data.datasets.map((d) => d.label)).toEqual(['Planned']);
  });

  it('leaves out a series with no values: a finished project has no Forecast', () => {
    const done = finishedPlan();
    const config = sCurveConfig(computePlan(done).sCurve, done.project.statusDate, true);
    expect(config.data.datasets.map((d) => d.label)).toEqual(['Planned', 'Actual']);
  });
});

describe('report Gantt appendix — SPEC §9.3', () => {
  it('keeps room after the last bar for its label; a short plan keeps the full width', () => {
    const long = fittedScale('2026-01-01', addDays('2026-01-01', 119), 740, 100); // 120 days
    expect((long.days - 5) * long.px + 100).toBeLessThanOrEqual(740);
    const short = fittedScale('2026-01-01', addDays('2026-01-01', 29), 740, 100); // 30 days
    expect(short.px).toBeCloseTo(740 / 30);
    expect(fittedScale('2026-01-01', addDays('2026-01-01', 119), 740).px).toBeCloseTo(740 / 120);
  });
});
