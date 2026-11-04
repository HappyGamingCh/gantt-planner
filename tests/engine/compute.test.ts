import { describe, expect, it } from 'vitest';
import { createCalendar } from '../../src/engine/calendar';
import { compute } from '../../src/engine/compute';
import { SAMPLE_STATUS_DATE, sampleData } from '../../src/sample/sampleData';
import { makeProject, makeTask, taskOf } from './helpers';

// Sample: PM (3Y) F-101, Track mode, 7-day week, status date Wed 30 Sep 2026 (R = Thu 1 Oct),
// holidays Tue 13 Oct and Fri 23 Oct. Expected values below were worked out by hand.
const calendar = createCalendar(sampleData.holidays.map((h) => h.date));
const result = compute(sampleData.project, sampleData.tasks, calendar, sampleData.resources);

describe('sample project', () => {
  it('uses the fixed status date and loads without issues', () => {
    expect(sampleData.project.statusDate).toBe(SAMPLE_STATUS_DATE);
    expect(result.issues).toEqual([]);
  });

  it('builds the baseline from FS/SS links, a lag, a lead, milestones and the holidays', () => {
    expect(taskOf(result, 2).plannedStart).toBe('2026-09-28'); // after the Shutdown start milestone: same day
    expect(taskOf(result, 15).plannedStart).toBe('2026-09-30'); // 2FS+1
    expect(taskOf(result, 17).plannedStart).toBe('2026-10-02'); // 16FS-1
    expect(taskOf(result, 3).plannedStart).toBe('2026-09-28'); // 2SS
    expect(taskOf(result, 7).plannedFinish).toBe('2026-10-12'); // 14 days, Sat/Sun included
    expect(taskOf(result, 20).plannedStart).toBe('2026-10-07'); // milestone at the end of 13's and 19's last day
    expect(taskOf(result, 21).plannedStart).toBe('2026-10-08'); // next day after that milestone
    expect(taskOf(result, 24).plannedStart).toBe('2026-10-14'); // 7 ends 12 Oct; 13 Oct is a holiday
    expect(result.summary).toMatchObject({ plannedStart: '2026-09-28', plannedFinish: '2026-10-15', durationDays: 17, elapsedDays: 3 });
  });

  it('has the intended status mix', () => {
    expect(result.summary.counts).toEqual({ completed: 7, inProgress: 3, notStarted: 9, late: 3, total: 22 });
    expect(result.summary.milestones).toEqual({ done: 1, total: 3 });
    expect(taskOf(result, 5)).toMatchObject({ status: 'Completed', variance: 1 }); // finished late
    expect(taskOf(result, 7)).toMatchObject({ status: 'Late', forecastFinish: '2026-10-15', variance: 2 }); // in progress, behind
    expect(taskOf(result, 14)).toMatchObject({ status: 'Late', forecastStart: '2026-10-01', variance: 2 }); // not started, past its start
    expect(taskOf(result, 18)).toMatchObject({ status: 'In Progress', variance: -1 }); // started early
  });

  it('pushes the finish through the late chain and across the 13 Oct holiday', () => {
    expect(taskOf(result, 24)).toMatchObject({ forecastStart: '2026-10-16', forecastFinish: '2026-10-17', status: 'Late' });
    expect(taskOf(result, 25).forecastFinish).toBe('2026-10-17');
    expect(taskOf(result, 13).status).toBe('Not Started'); // the not-started late task (14) does not propagate
    expect(result.summary).toMatchObject({ forecastFinish: '2026-10-17', finishVariance: 2 });
  });

  it('summarizes progress: 37% against a plan of 40%, slightly behind', () => {
    expect(result.summary.actualPct).toBeCloseTo(805 / 22, 10);
    // At SD: 8 tasks planned done; task 7 at 2 of 14 days; tasks 11 and 16 at 1 of 3 days.
    expect(result.summary.plannedPct).toBeCloseTo((800 + (2 / 14) * 100 + (2 * 100) / 3) / 22, 10);
    expect(result.summary).toMatchObject({ variancePts: -3.5, state: 'Slightly behind' });
  });

  it('groups by assignee, with the shared and the unassigned task', () => {
    const names = result.byAssignee.map((a) => a.name);
    expect(names.at(-1)).toBe('Unassigned');
    expect(result.byAssignee.find((a) => a.name === 'QC')?.tasks).toBe(1); // task 5, shared with Inst
    expect(result.byAssignee.find((a) => a.name === 'Inst')).toMatchObject({ tasks: 3, completed: 1, late: 2 });
  });

  it('S-curve joins at the status date and reaches 100 at the forecast finish', () => {
    const sd = result.sCurve.find((p) => p.date === SAMPLE_STATUS_DATE);
    expect(sd?.actual).toBe(result.summary.actualPct);
    expect(sd?.forecast).toBe(sd?.actual);
    expect(result.sCurve.at(-1)).toMatchObject({ date: '2026-10-17', planned: 100, forecast: 100 });
  });
});

describe('compute', () => {
  it('recomputes 200 tasks well under 10 ms', () => {
    // A large plan: 10 parallel sections of 20 chained tasks; every third task links SS+1 to the previous
    // task and FS to the one before that. 30 tasks in progress.
    const tasks = Array.from({ length: 200 }, (_, i) => {
      const k = i % 20; // position in the section
      return makeTask(i + 1, {
        plannedDuration: 1 + (i % 7),
        predecessorsText: k === 0 ? '' : k % 3 === 0 ? `${i}SS+1, ${i - 1}` : `${i}`,
        actualStart: i < 30 ? '2026-11-02' : undefined,
        progress: i < 30 ? 50 : 0,
      });
    });
    const project = makeProject({ mode: 'Track' });
    const cal = createCalendar(['2026-12-31']);
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      compute(project, tasks, cal);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[7]).toBeLessThan(10);
  });
});
