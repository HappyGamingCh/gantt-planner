// Half days in the workbook (SPEC §4.3, §4.7, §4.8): 0.5 durations, 12:00 = afternoon start / midday finish, other
// times kept, and the template's old whole-number rule on Planned Duration replaced (a user's own rule kept).
import { describe, expect, it } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import type { CellValue, DataValidation } from '../../src/excel/exceljs';
import { validationsOf } from '../../src/excel/exceljs';
import { isOldDurationRule } from '../../src/excel/template';
import { read, reload, save, taskCell, tasksSheet, templateWith } from './helpers';

const at = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m - 1, d, h));
const MON = at(2026, 11, 2);
const noon = (d: Date) => new Date(d.getTime() + 12 * 3600_000);
/** Excel's serial number of a date (1900 date system). */
const serial = (d: Date) => (d.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000;
const time = (v: CellValue) => (v instanceof Date ? v.toISOString().slice(11, 16) : String(v));

const OLD_RULE: DataValidation = {
  type: 'whole',
  operator: 'greaterThanOrEqual',
  allowBlank: true,
  formulae: [0],
  showErrorMessage: true,
  errorTitle: 'Planned Duration',
  error: 'Enter a whole number of working days (0 = milestone).',
};

describe('reading half days (§4.7)', () => {
  it('12:00 exactly is an afternoon start or a midday finish; other times keep the whole-day meaning', () => {
    const r = read(
      templateWith([
        { ID: 1, Task: 'Noon start', 'Planned Start': noon(MON), 'Planned Duration': 0.5 },
        { ID: 2, Task: 'Night shift', 'Planned Start': at(2026, 11, 2, 19), 'Planned Duration': 1 },
        { ID: 3, Task: 'Serial noon', 'Planned Start': serial(MON) + 0.5, 'Planned Duration': 1 },
        { ID: 4, Task: 'Midday finish', 'Planned Start': MON, 'Planned Finish': noon(at(2026, 11, 3)) },
        { ID: 5, Task: 'Almost noon', 'Planned Start': new Date(noon(MON).getTime() - 1000), 'Planned Duration': 1 },
      ]),
    );
    const [t1, t2, t3, t4, t5] = r.plan.tasks;
    expect(t1).toMatchObject({ plannedStart: '2026-11-02', plannedStartPM: true, plannedDuration: 0.5 });
    expect(t2!.plannedStartPM).toBeUndefined();
    expect(t3).toMatchObject({ plannedStart: '2026-11-02', plannedStartPM: true });
    expect(t4).toMatchObject({ plannedFinish: '2026-11-03', plannedFinishMidday: true, plannedDuration: undefined });
    expect(t5!.plannedStartPM).toBeUndefined();
    const result = computePlan(r.plan);
    expect(result.tasks[3]).toMatchObject({ plannedDuration: 1.5, plannedFinishMidday: true }); // from the midday finish
  });
});

describe('writing half days (§4.8)', () => {
  it('writes 0.5 and the time 12:00, shown as the date only, and reads them back', async () => {
    const wb = templateWith([
      { ID: 1, Task: 'Isolate', 'Planned Start': MON, 'Planned Duration': 0.5 },
      { ID: 2, Task: 'Ventilate', Predecessors: '1', 'Planned Duration': 0.5 },
      { ID: 3, Task: 'Inspect', Predecessors: '2+0.5', 'Planned Duration': 1 },
    ]);
    const saved = await save(wb);
    expect(taskCell(saved, 2, 'plannedDuration').value).toBe(0.5);
    expect(time(taskCell(saved, 2, 'plannedFinish').value)).toBe('12:00'); // Isolate: Mon at midday
    expect(time(taskCell(saved, 3, 'plannedStart').value)).toBe('12:00'); // Ventilate: Mon afternoon
    expect(time(taskCell(saved, 3, 'plannedFinish').value)).toBe('00:00');
    expect(time(taskCell(saved, 4, 'plannedStart').value)).toBe('12:00'); // Inspect: Tue afternoon
    expect(time(taskCell(saved, 4, 'plannedFinish').value)).toBe('12:00'); // to Wed midday
    expect(taskCell(saved, 4, 'predecessors').value).toBe('2FS+0.5');
    expect(time(taskCell(saved, 3, 'forecastStart').value)).toBe('12:00');
    expect(taskCell(saved, 2, 'plannedFinish').numFmt).toBe('dd-mmm-yy');

    // Opened again in Track mode, the baseline is exactly as planned: the halves come back from the 12:00 times.
    const again = read(saved);
    again.plan.project.mode = 'Track';
    const tasks = computePlan(again.plan).tasks;
    expect(tasks[1]).toMatchObject({ plannedStart: '2026-11-02', plannedStartPM: true, plannedFinish: '2026-11-02' });
    expect(tasks[2]).toMatchObject({ plannedStart: '2026-11-03', plannedStartPM: true, plannedFinish: '2026-11-04', plannedFinishMidday: true });
    expect(again.changes.filter((c) => c.field === 'Planned Start' || c.field === 'Planned Finish')).toEqual([]);
  });

  it('keeps an input start with another time while its day and half are unchanged; a new half is written at 12:00', async () => {
    const night = at(2026, 11, 2, 19);
    const wb = templateWith([
      { ID: 1, Task: 'Night shift', 'Planned Start': night, 'Planned Duration': 1 },
      { ID: 2, Task: 'Was afternoon', 'Planned Start': noon(MON), 'Planned Duration': 1 },
      { ID: 3, Task: 'Dragged', 'Planned Start': night, 'Planned Duration': 1 },
    ]);
    const r = read(wb);
    r.plan.tasks[1] = { ...r.plan.tasks[1]!, plannedStartPM: undefined }; // a date typed in the app: the morning
    r.plan.tasks[2] = { ...r.plan.tasks[2]!, plannedStartPM: true }; // a bar dragged to the afternoon
    const saved = await save(wb, r);
    expect((taskCell(saved, 2, 'plannedStart').value as Date).getTime()).toBe(night.getTime());
    expect(time(taskCell(saved, 3, 'plannedStart').value)).toBe('00:00');
    expect(time(taskCell(saved, 4, 'plannedStart').value)).toBe('12:00');
  });

  it('a whole-day plan writes no 12:00 anywhere', async () => {
    const saved = await save(
      templateWith([
        { ID: 1, Task: 'A', 'Planned Start': MON, 'Planned Duration': 3 },
        { ID: 2, Task: 'M', Predecessors: '1', 'Planned Duration': 0 },
        { ID: 3, Task: 'B', Predecessors: '2SS+1', 'Planned Duration': 2 },
      ]),
    );
    const times: string[] = [];
    tasksSheet(saved).eachRow((row, n) => {
      if (n > 1) row.eachCell((cell) => cell.value instanceof Date && times.push(time(cell.value)));
    });
    expect(times.length).toBeGreaterThan(0);
    expect(new Set(times)).toEqual(new Set(['00:00']));
  });
});

describe('Planned Duration validation (§4.8)', () => {
  const durationRules = (wb: ReturnType<typeof templateWith>) => {
    const rules = validationsOf(tasksSheet(wb)).model;
    return Object.entries(rules).filter(([address, rule]) => /^G\d+$/.test(address) && rule);
  };

  it("replaces the old template's whole-number rule with the decimal one", async () => {
    let wb = templateWith([{ ID: 1, Task: 'A', 'Planned Start': MON, 'Planned Duration': 0.5 }]);
    const model = validationsOf(tasksSheet(wb)).model;
    for (const key of Object.keys(model)) if (key.startsWith('G')) model[key] = OLD_RULE; // a file from before half days
    wb = await reload(wb);
    expect(durationRules(wb).every(([, rule]) => isOldDurationRule(rule))).toBe(true);
    const saved = await save(wb);
    const rules = durationRules(saved);
    expect(rules.length).toBeGreaterThan(900);
    for (const [, rule] of rules) expect(rule).toMatchObject({ type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], error: 'Enter working days, in steps of 0.5 (0 = milestone).' });
  });

  it('keeps a rule the user made on Planned Duration', async () => {
    const mine: DataValidation = { ...OLD_RULE, operator: 'between', formulae: [0, 30], error: 'At most 30 days' };
    let wb = templateWith([{ ID: 1, Task: 'A', 'Planned Start': MON, 'Planned Duration': 2 }]);
    const model = validationsOf(tasksSheet(wb)).model;
    for (const key of Object.keys(model)) if (key.startsWith('G')) model[key] = mine;
    wb = await reload(wb);
    const saved = await save(wb);
    for (const [, rule] of durationRules(saved)) expect(rule).toMatchObject({ type: 'whole', operator: 'between', formulae: [0, 30], error: 'At most 30 days' });
  });

  it('recognises only the exact old rule', () => {
    expect(isOldDurationRule(OLD_RULE)).toBe(true);
    expect(isOldDurationRule({ ...OLD_RULE, formulae: ['0'] as unknown as number[] })).toBe(true); // as some readers give it
    expect(isOldDurationRule({ ...OLD_RULE, error: 'Whole days please' })).toBe(false);
    expect(isOldDurationRule({ ...OLD_RULE, type: 'decimal' })).toBe(false);
    expect(isOldDurationRule({ ...OLD_RULE, formulae: [1] })).toBe(false);
    expect(isOldDurationRule(undefined)).toBe(false);
  });
});
