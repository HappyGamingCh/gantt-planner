import { describe, expect, it } from 'vitest';
import { isPlanDate } from '../../src/engine/dates';
import type { ComputeResult, QuickFix, Task } from '../../src/engine/types';
import { issuesOf, makeTask, run, taskOf } from './helpers';

// Status date Fri 13 Nov 2026. Task 1: Mon 2 – Fri 6 Nov unless stated.
const one = (fields: Partial<Task>, statusDate = '2026-11-13') =>
  run([makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 5, ...fields })], { statusDate });

describe('Actual Duration', () => {
  it('counts Actual Start → Actual Finish', () => {
    expect(taskOf(one({ actualStart: '2026-11-02', actualFinish: '2026-11-09', progress: 100 }), 1).actualDuration).toBe(8);
  });

  it('counts Actual Start → status date while in progress', () => {
    expect(taskOf(one({ actualStart: '2026-11-09', progress: 50 }), 1).actualDuration).toBe(5);
  });

  it('is blank when Actual Start is after the status date, or not set', () => {
    expect(taskOf(one({ actualStart: '2026-11-16', progress: 10 }), 1).actualDuration).toBeUndefined();
    expect(taskOf(one({}), 1).actualDuration).toBeUndefined();
  });

  it('is at least 1 once started, and 0 for milestones', () => {
    const onHolidays = run(
      [makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 5, actualStart: '2026-11-07', actualFinish: '2026-11-08', progress: 100 })],
      { statusDate: '2026-11-13' },
      ['2026-11-07', '2026-11-08'],
    );
    expect(taskOf(onHolidays, 1).actualDuration).toBe(1);
    expect(taskOf(one({ plannedDuration: 0, actualStart: '2026-11-06', actualFinish: '2026-11-06', progress: 100 }), 1).actualDuration).toBe(0);
  });
});

describe('§5.5 rules', () => {
  it('Actual Finish set and Progress ≠ 100 → Progress = 100 (corrected)', () => {
    const r = one({ actualStart: '2026-11-02', actualFinish: '2026-11-06', progress: 60 });
    expect(taskOf(r, 1)).toMatchObject({ progress: 100, status: 'Completed' });
    expect(r.changes).toContainEqual({ taskId: 1, field: 'Progress (%)', from: 60, to: 100, kind: 'corrected', reason: 'Actual Finish is set' });
  });

  it('milestone with Actual Finish and no Actual Start → Actual Start = Actual Finish (filled)', () => {
    const r = one({ plannedDuration: 0, actualFinish: '2026-11-06', progress: 100 });
    expect(taskOf(r, 1).actualStart).toBe('2026-11-06');
    expect(r.changes).toContainEqual(expect.objectContaining({ field: 'Actual Start', to: '2026-11-06', kind: 'filled' }));
    expect(r.issues).toEqual([]);
  });

  it('milestone at 100% without Actual Finish → W_100_NO_AF only; completed at the status date', () => {
    const r = one({ plannedDuration: 0, progress: 100 });
    expect(r.issues).toEqual([
      expect.objectContaining({ code: 'W_100_NO_AF', fix: { kind: 'setActualFinish', taskId: 1, value: '2026-11-13' } }),
    ]);
    expect(taskOf(r, 1)).toMatchObject({ status: 'Completed', forecastFinish: '2026-11-13', actualStart: undefined });
  });

  it('Actual Finish without Actual Start (non-milestone) → warning; calculated as starting on Actual Finish', () => {
    const r = one({ actualFinish: '2026-11-05', progress: 100 });
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'W_AF_NO_AS',
        message: 'Task 1: actual finish without actual start',
        fix: { kind: 'setActualStart', taskId: 1, value: '2026-11-05' },
      }),
    ]);
    expect(taskOf(r, 1)).toMatchObject({ forecastStart: '2026-11-05', actualDuration: 1, actualStart: undefined });
  });

  it('Actual Finish before Actual Start → warning; calculated as finishing on Actual Start', () => {
    const r = one({ actualStart: '2026-11-05', actualFinish: '2026-11-03', progress: 100 });
    expect(issuesOf(r)).toEqual(['W_AF_BEFORE_AS']);
    expect(taskOf(r, 1)).toMatchObject({ forecastStart: '2026-11-05', forecastFinish: '2026-11-05' });
  });

  it('Progress > 0 without Actual Start → warning; calculated from min(Planned Start, status date)', () => {
    const started = one({ progress: 40 });
    expect(started.issues).toEqual([
      expect.objectContaining({ code: 'W_PROGRESS_NO_AS', fix: { kind: 'setActualStart', taskId: 1, value: '2026-11-02' } }),
    ]);
    expect(taskOf(started, 1)).toMatchObject({ forecastStart: '2026-11-02', actualStart: undefined, status: 'Late' });

    const early = one({ plannedStart: '2026-11-18', progress: 20 });
    expect(early.issues[0]?.fix).toEqual({ kind: 'setActualStart', taskId: 1, value: '2026-11-13' });
    expect(taskOf(early, 1).forecastStart).toBe('2026-11-13');
  });

  it('Progress = 100 without Actual Finish → warning; completed at the status date', () => {
    const r = one({ actualStart: '2026-11-02', progress: 100 });
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'W_100_NO_AF',
        message: 'Task 1: 100% but no actual finish',
        fix: { kind: 'setActualFinish', taskId: 1, value: '2026-11-13' },
      }),
    ]);
    expect(taskOf(r, 1)).toMatchObject({ status: 'Completed', forecastFinish: '2026-11-13' });
  });

  it('an actual date after the status date → one W_FUTURE_ACTUAL per task', () => {
    const r = one({ actualStart: '2026-11-16', actualFinish: '2026-11-17', progress: 100 });
    expect(issuesOf(r)).toEqual(['W_FUTURE_ACTUAL']);
  });

  it('a future Actual Start with 100% and no Actual Finish never finishes before it starts', () => {
    const r = one({ actualStart: '2026-11-16', progress: 100 });
    expect(issuesOf(r)).toEqual(['W_100_NO_AF', 'W_FUTURE_ACTUAL']);
    expect(taskOf(r, 1).forecastFinish).toBe('2026-11-16');
  });
});

describe('actual dates outside 1950–2199', () => {
  it('a 2-digit year (0026) in Actual Start is W_BAD_DATE and ignored for calculation, but kept as written', () => {
    const r = one({ actualStart: '0026-09-29', progress: 40 });
    expect(r.issues[0]).toMatchObject({ code: 'W_BAD_DATE', taskId: 1, message: 'Task 1: "0026-09-29" in Actual Start is not a date' });
    expect(issuesOf(r)).toEqual(['W_BAD_DATE', 'W_PROGRESS_NO_AS']);
    expect(taskOf(r, 1)).toMatchObject({ actualStart: '0026-09-29', forecastStart: '2026-11-02', actualDuration: 12 });
    expect(r.sCurve[0]?.date).toBe('2026-11-02');
  });

  it('an out-of-range Actual Finish is ignored: no forced 100%, not completed', () => {
    const r = one({ actualStart: '2026-11-02', actualFinish: '2300-01-01', progress: 60 });
    expect(issuesOf(r)).toEqual(['W_BAD_DATE']);
    expect(r.issues[0]?.message).toBe('Task 1: "2300-01-01" in Actual Finish is not a date');
    expect(taskOf(r, 1)).toMatchObject({ progress: 60, status: 'Late' });
  });
});

describe('milestone with an Actual Start only', () => {
  // 1: Mon 2 – Fri 6 Nov, done. 2: milestone after 1 (6 Nov). 3: FS after 2, 4 days (7–10 Nov).
  const plan = (milestone: Partial<Task>, statusDate = '2026-11-13') =>
    run(
      [
        makeTask(1, { plannedDuration: 5, actualStart: '2026-11-02', actualFinish: '2026-11-06', progress: 100 }),
        makeTask(2, { predecessorsText: '1', plannedDuration: 0, ...milestone }),
        makeTask(3, { predecessorsText: '2', plannedDuration: 4 }),
      ],
      { mode: 'Track', statusDate },
    );

  it('is achieved on its Actual Start, with W_MS_NO_AF offering Actual Finish = Actual Start', () => {
    const r = plan({ actualStart: '2026-11-06' }, '2026-11-06');
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'W_MS_NO_AF',
        taskId: 2,
        message: 'Task 2: milestone has an actual start but no actual finish',
        fix: { kind: 'setActualFinish', taskId: 2, value: '2026-11-06' },
      }),
    ]);
    expect(taskOf(r, 2)).toMatchObject({ status: 'Completed', progress: 100, forecastFinish: '2026-11-06', variance: 0, actualStart: '2026-11-06' });
    expect(r.changes).toContainEqual(
      expect.objectContaining({ taskId: 2, field: 'Progress (%)', from: 0, to: 100, kind: 'corrected', reason: 'Milestone reached on its Actual Start' }),
    );
    expect(r.summary.milestones).toEqual({ done: 1, total: 1 });

    // Same numbers as with the fix applied.
    const fixed = plan({ actualStart: '2026-11-06', actualFinish: '2026-11-06' }, '2026-11-06');
    expect(fixed.issues).toEqual([]);
    for (const id of [2, 3]) {
      const { forecastStart, forecastFinish, variance, status, progress } = taskOf(fixed, id);
      expect(taskOf(r, id)).toMatchObject({ forecastStart, forecastFinish, variance, status, progress });
    }
    expect(r.summary.finishVariance).toBe(fixed.summary.finishVariance);
  });

  it('at 100% gets W_MS_NO_AF only, with Actual Finish = Actual Start', () => {
    const r = plan({ actualStart: '2026-11-06', progress: 100 });
    expect(issuesOf(r)).toEqual(['W_MS_NO_AF']);
    expect(r.issues[0]?.fix).toEqual({ kind: 'setActualFinish', taskId: 2, value: '2026-11-06' });
  });

  it('is not achieved while its Actual Start is after the status date: W_FUTURE_ACTUAL only', () => {
    const r = plan({ actualStart: '2026-11-20' });
    expect(issuesOf(r)).toEqual(['W_FUTURE_ACTUAL']);
    expect(taskOf(r, 2)).toMatchObject({ progress: 0, actualStart: '2026-11-20' });
    expect(taskOf(r, 2).status).not.toBe('Completed');
    expect(r.summary.milestones).toEqual({ done: 0, total: 1 });
    expect(r.changes.filter((c) => c.field === 'Progress (%)')).toEqual([]);
  });

  it('progress without an Actual Start still only gets W_PROGRESS_NO_AS and is not achieved', () => {
    const r = plan({ progress: 50 });
    expect(issuesOf(r)).toEqual(['W_PROGRESS_NO_AS']);
    expect(taskOf(r, 2).status).not.toBe('Completed');
  });
});

describe('quick fixes change no number, in any order', () => {
  // 100% with neither actual date: PS 2 Nov, PD 5; 2 is a 20-day task so the S-curve has work after it.
  const tasks = (fields: Partial<Task> = {}) => [
    makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 5, progress: 100, ...fields }),
    makeTask(2, { plannedStart: '2026-11-02', plannedDuration: 20 }),
  ];
  const track = (t: Task[]) => run(t, { mode: 'Track' });
  /** What the store's applyFix does (src/store/edit.ts). */
  const applyTo = (task: Task, fix: QuickFix): Task => {
    if (fix.kind === 'setActualStart') return { ...task, actualStart: fix.value };
    if (fix.kind === 'setActualFinish') {
      const keep = task.actualStart !== undefined && isPlanDate(task.actualStart);
      return { ...task, actualFinish: fix.value, actualStart: keep ? task.actualStart : (fix.actualStart ?? task.actualStart) };
    }
    return task;
  };
  const numbers = (r: ComputeResult) => ({
    tasks: r.tasks.map(({ forecastStart, forecastFinish, actualDuration, variance, status }) => ({ forecastStart, forecastFinish, actualDuration, variance, status })),
    week: r.summary.weekActualDelta,
    sCurve: r.sCurve,
  });

  it('W_100_NO_AF also carries the start used for calculation (non-milestone)', () => {
    const r = track(tasks());
    expect(r.issues.map((i) => [i.code, i.fix])).toEqual([
      ['W_100_NO_AF', { kind: 'setActualFinish', taskId: 1, value: '2026-11-13', actualStart: '2026-11-02' }],
      ['W_PROGRESS_NO_AS', { kind: 'setActualStart', taskId: 1, value: '2026-11-02' }],
    ]);
    expect(taskOf(r, 1).actualDuration).toBe(12);
  });

  it.each(['W_100_NO_AF', 'W_PROGRESS_NO_AS'])('applying %s first, then any fix left, changes no number', (code) => {
    const before = track(tasks());
    const other = tasks()[1]!;
    let task = applyTo(tasks()[0]!, before.issues.find((i) => i.code === code)!.fix!);
    for (let step = 0; step < 3; step++) {
      const now = track([task, other]);
      expect(numbers(now)).toEqual(numbers(before));
      const next = now.issues.find((i) => i.fix)?.fix;
      if (!next) break;
      task = applyTo(task, next);
    }
    expect(track([task, other]).issues).toEqual([]);
    expect(task).toMatchObject({ actualStart: '2026-11-02', actualFinish: '2026-11-13' });
  });

  it('an out-of-range Actual Start is replaced by the start used for calculation, so no number changes', () => {
    const [bad, other] = tasks({ actualStart: '0026-11-02' }) as [Task, Task];
    const before = track([bad, other]);
    expect(issuesOf(before)).toEqual(['W_BAD_DATE', 'W_100_NO_AF', 'W_PROGRESS_NO_AS']);
    const task = applyTo(bad, before.issues.find((i) => i.code === 'W_100_NO_AF')!.fix!);
    expect(task).toMatchObject({ actualStart: '2026-11-02', actualFinish: '2026-11-13' });
    const after = track([task, other]);
    expect(after.issues).toEqual([]);
    expect(numbers(after)).toEqual(numbers(before));
  });
});

describe('progress normalization', () => {
  it('clamps to 0–100 with W_PROGRESS_CLAMPED', () => {
    const high = one({ progress: 120, actualStart: '2026-11-02', actualFinish: '2026-11-06' });
    expect(taskOf(high, 1).progress).toBe(100);
    expect(high.issues).toEqual([expect.objectContaining({ code: 'W_PROGRESS_CLAMPED', message: 'Task 1: progress 120 adjusted to 100' })]);

    const low = one({ progress: -5 });
    expect(taskOf(low, 1).progress).toBe(0);
    expect(issuesOf(low)).toEqual(['W_PROGRESS_CLAMPED']);
  });

  it('rounds to a whole number without an issue', () => {
    const r = one({ progress: 42.6, actualStart: '2026-11-02' });
    expect(taskOf(r, 1).progress).toBe(43);
    expect(r.changes).toContainEqual(expect.objectContaining({ field: 'Progress (%)', from: 42.6, to: 43, reason: 'Rounded to a whole number' }));
    expect(r.issues).toEqual([]);
  });

  it('treats a non-number as 0', () => {
    expect(taskOf(one({ progress: Number.NaN }), 1).progress).toBe(0);
  });
});
