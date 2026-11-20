import { beforeEach, describe, expect, it } from 'vitest';
import { RESOURCE_PALETTE } from '../../src/config';
import type { Plan } from '../../src/engine/types';
import { setMode } from '../../src/store/edit';
import {
  addHolidays,
  applySettings,
  nameProblem,
  resourceDrafts,
  sortedHolidays,
  withoutDraft,
  type ResourceDraft,
  type SettingsDraft,
} from '../../src/store/settings';
import { useStore } from '../../src/store/store';
import { undo } from '../../src/store/undo';
import { makeTask } from '../engine/helpers';
import { load, result, small, state, task } from './editHelpers';

/** Apply with the dialog's drafts as they open, changed by `fields`. */
function apply(fields: Partial<SettingsDraft> = {}): boolean {
  const plan = state().plan!;
  const drafts = resourceDrafts(plan);
  return applySettings({
    name: plan.project.name,
    owner: plan.project.owner,
    projectStart: plan.project.projectStart,
    moveRoots: true,
    workingDays: plan.project.workingDays ?? [0, 1, 2, 3, 4, 5, 6],
    holidays: sortedHolidays(plan.holidays),
    initialResources: drafts,
    resources: drafts,
    ...fields,
  });
}

const withResources = (): Plan => ({
  ...small(),
  resources: [{ name: 'ACME', type: 'Contractor', color: '#0D9488', source: { row: 2, key: 'acme' } }, { name: 'Refracto' }],
  tasks: small().tasks.map((t) => (t.id === 1 ? { ...t, assigned: ['acme', 'NewCo'] } : t.id === 2 ? { ...t, assigned: ['ACME'] } : t)),
});

describe('resource drafts — SPEC §7.14', () => {
  it('lists the resources, then names used on tasks but not listed yet', () => {
    expect(resourceDrafts(withResources())).toEqual([
      { id: 0, name: 'ACME', type: 'Contractor', color: '#0D9488', original: 'ACME', source: { row: 2, key: 'acme' } },
      { id: 1, name: 'Refracto', type: undefined, color: undefined, original: 'Refracto', source: undefined },
      { id: 2, name: 'NewCo', original: 'NewCo' },
    ]);
  });

  it('removing one keeps the colors shown below it (the palette goes by position)', () => {
    const drafts: ResourceDraft[] = [
      { id: 0, name: 'A' },
      { id: 1, name: 'B' },
      { id: 2, name: 'C', color: '#000000' },
      { id: 3, name: 'D' },
    ];
    expect(withoutDraft(drafts, 0)).toEqual([
      { id: 1, name: 'B', color: RESOURCE_PALETTE[1] },
      { id: 2, name: 'C', color: '#000000' },
      { id: 3, name: 'D', color: RESOURCE_PALETTE[3] },
    ]);
    expect(withoutDraft(drafts, 3)).toEqual(drafts.slice(0, 3)); // nothing below it
  });

  it('a name is required, unique in any case and free of , and ;', () => {
    const drafts: ResourceDraft[] = [
      { id: 0, name: '  ' },
      { id: 1, name: 'ACME, Refracto' },
      { id: 2, name: 'ThermCo' },
      { id: 3, name: 'thermco ' },
      { id: 4, name: 'Valve;Co' },
    ];
    expect(drafts.map((_, i) => nameProblem(drafts, i))).toEqual([
      'Enter a name',
      'A name can’t contain , or ; (they separate names in Assigned)',
      null,
      'Another resource has this name',
      'A name can’t contain , or ; (they separate names in Assigned)',
    ]);
  });
});

describe('holiday drafts — SPEC §7.14', () => {
  const list = [{ date: '2026-12-31', description: 'New Year’s Eve' }];

  it('adds a date or every date of a range not listed yet, in date order', () => {
    expect(addHolidays(list, '2026-12-05', '', ' Father’s Day ')).toEqual({
      list: [
        { date: '2026-12-05', description: 'Father’s Day' },
        { date: '2026-12-31', description: 'New Year’s Eve' },
      ],
    });
    expect(addHolidays(list, '2026-12-30', '2027-01-01', 'Year end').list.map((h) => [h.date, h.description])).toEqual([
      ['2026-12-30', 'Year end'],
      ['2026-12-31', 'New Year’s Eve'],
      ['2027-01-01', 'Year end'],
    ]);
  });

  it('says why nothing was added', () => {
    expect(addHolidays(list, '2026-12-31', '', '').message).toBe('Already a holiday');
    expect(addHolidays(list, '2026-12-31', '2026-12-31', '').message).toBe('Already a holiday');
    expect(addHolidays([...list, { date: '2027-01-01', description: '' }], '2026-12-31', '2027-01-01', '').message).toBe('These dates are already holidays');
    expect(addHolidays(list, '2026-12-10', '2026-12-01', '').message).toBe('The end date is before the start date');
    expect(addHolidays(list, '2026-01-01', '2027-01-02', '').message).toBe('Add at most 366 days at a time');
    expect(addHolidays(list, '0026-12-01', '', '').message).toBe('Enter a date between 1950 and 2199');
  });

  it('sorts by date, one holiday per date', () => {
    expect(
      sortedHolidays([
        { date: '2026-12-31', description: 'b' },
        { date: '2026-12-05', description: 'a' },
        { date: '2026-12-31', description: 'again' },
      ]),
    ).toEqual([
      { date: '2026-12-05', description: 'a' },
      { date: '2026-12-31', description: 'b' },
    ]);
  });
});

describe('Apply — SPEC §7.14, §8', () => {
  beforeEach(() => load(small()));

  it('nothing changed: the dialog closes, no undo step, nothing unsaved', () => {
    useStore.setState({ dialog: { kind: 'projectSettings', tab: 'calendar' } });
    expect(apply()).toBe(true);
    expect(state()).toMatchObject({ dialog: null, undo: [], dirty: false });
  });

  it('a holiday list the file has out of date order is no change', () => {
    load({ ...small(), holidays: [{ date: '2026-12-31', description: '' }, { date: '2026-12-05', description: '' }] });
    const before = state().plan!.holidays;
    apply();
    expect(state().plan!.holidays).toBe(before);
    expect(state().undo).toEqual([]);
  });

  it('working days: the plan is recalculated, the moved tasks reported, all in one undo step', () => {
    // Task 1: Mon 2 – Fri 6 Nov; task 2 (2d) followed on Sat 7 – Sun 8, task 3 on Mon 9
    apply({ workingDays: [1, 2, 3, 4, 5] });
    expect([result(1).plannedFinish, result(2).plannedStart, result(2).plannedFinish, result(3).plannedStart]).toEqual(['2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11']);
    expect(state().plan!.project.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(state().toast?.message).toBe('Plan recalculated — 2 tasks moved');
    expect(state().changes.filter((c) => c.reason === 'Plan recalculated').map((c) => [c.taskId, c.field, c.from, c.to])).toEqual([
      [2, 'Planned Start', '2026-11-07', '2026-11-09'],
      [2, 'Planned Finish', '2026-11-08', '2026-11-10'],
      [3, 'Planned Start', '2026-11-09', '2026-11-11'],
      [3, 'Planned Finish', '2026-11-09', '2026-11-11'],
    ]);
    expect(state().undo).toHaveLength(1);
    undo();
    expect(result(2).plannedStart).toBe('2026-11-07');
    expect(state().plan!.project.workingDays).toBeUndefined();
  });

  it('a holiday added moves the plan too; every day ticked again stores no working days', () => {
    apply({ holidays: [{ date: '2026-11-04', description: 'Shutdown day' }] });
    expect(result(1).plannedFinish).toBe('2026-11-07');
    expect(state().plan!.holidays).toEqual([{ date: '2026-11-04', description: 'Shutdown day' }]);
    apply({ workingDays: [1, 2, 3, 4, 5, 6] });
    apply({ workingDays: [6, 5, 4, 3, 2, 1, 0] });
    expect(state().plan!.project.workingDays).toBeUndefined();
  });

  it('Track mode keeps the baseline: no planned date moves', () => {
    setMode('Track');
    const planned = state().result!.tasks.map((r) => [r.plannedStart, r.plannedFinish]);
    useStore.setState({ toast: null });
    apply({ workingDays: [1, 2, 3, 4, 5] });
    expect(state().result!.tasks.map((r) => [r.plannedStart, r.plannedFinish])).toEqual(planned);
    expect(state().toast).toBeNull();
  });

  it('the file’s Working Days text stays until the days are changed here', () => {
    load({ ...small(), project: { ...small().project, workingDaysText: 'weekdays' } });
    apply({ name: 'Renamed' });
    expect(state().plan!.project).toMatchObject({ name: 'Renamed', workingDaysText: 'weekdays' });
    apply({ workingDays: [1, 2, 3, 4, 5] });
    expect(state().plan!.project.workingDaysText).toBeUndefined();
  });

  it('a new Project Start takes the root tasks on the old one along', () => {
    apply({ projectStart: '2026-11-09' });
    expect([result(1).plannedStart, result(4).plannedStart, state().plan!.project.projectStart]).toEqual(['2026-11-09', '2026-11-09', '2026-11-09']);
    apply({ projectStart: '2026-11-16', moveRoots: false });
    expect(result(1).plannedStart).toBe('2026-11-09');
  });

  it('refused, with the dialog open: a Project Start outside 1950–2199, a resource name that can’t be used', () => {
    useStore.setState({ dialog: { kind: 'projectSettings' } });
    expect(apply({ projectStart: '0026-11-09', name: 'Renamed' })).toBe(false);
    expect(state()).toMatchObject({ dialog: { kind: 'projectSettings' }, toast: { message: 'Enter a date between 1950 and 2199' } });
    expect(apply({ resources: [{ id: 0, name: '' }] })).toBe(false);
    expect(state().plan!.project.name).toBe('Test');
    expect(state().undo).toEqual([]);
  });
});

describe('Apply: resources — SPEC §7.14, §8', () => {
  beforeEach(() => load(withResources()));

  it('a rename follows on every task that has the name, in any case; one undo step', () => {
    const drafts = resourceDrafts(state().plan!);
    apply({ initialResources: drafts, resources: drafts.map((d) => (d.name === 'ACME' ? { ...d, name: 'ACME Corp' } : d)) });
    expect([task(1).assigned, task(2).assigned]).toEqual([['ACME Corp', 'NewCo'], ['ACME Corp']]);
    expect(state().plan!.resources).toEqual([
      { name: 'ACME Corp', type: 'Contractor', color: '#0D9488', source: { row: 2, key: 'acme' } },
      { name: 'Refracto' },
      { name: 'NewCo' },
    ]);
    expect(state().undo).toHaveLength(1);
    undo();
    expect(task(1).assigned).toEqual(['acme', 'NewCo']);
  });

  it('type, color, a new resource and a removed one; tasks unchanged', () => {
    const drafts = resourceDrafts(state().plan!);
    const edited = withoutDraft(drafts, 1).map((d) => (d.name === 'NewCo' ? { ...d, type: 'Team' as const, color: '#7c3aed' } : d));
    apply({ initialResources: drafts, resources: [...edited, { id: 9, name: ' Spare  crew ' }] });
    expect(state().plan!.resources).toEqual([
      { name: 'ACME', type: 'Contractor', color: '#0D9488', source: { row: 2, key: 'acme' } },
      { name: 'NewCo', type: 'Team', color: '#7C3AED' },
      { name: 'Spare crew' },
    ]);
    expect(state().plan!.tasks.map((t) => t.assigned)).toEqual(withResources().tasks.map((t) => t.assigned));
  });
});

describe('a task added to a plan with working days — SPEC §8', () => {
  it('Track mode starts it on the first working day after the status date', async () => {
    const { addTask } = await import('../../src/store/edit');
    load({ ...small('Track'), project: { ...small('Track').project, workingDays: [1, 2, 3, 4, 5] }, tasks: [makeTask(1, { plannedDuration: 1 })] });
    addTask(); // status date Fri 13 Nov: R = Mon 16 Nov
    expect(state().plan!.tasks.at(-1)!.plannedStart).toBe('2026-11-16');
  });
});
