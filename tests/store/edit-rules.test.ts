import { beforeEach, describe, expect, it } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import { sampleData } from '../../src/sample/sampleData';
import { addTask, editTask, setStatusDate, unlinkSelected, updateProject } from '../../src/store/edit';
import { createPlan } from '../../src/store/files';
import { select, useStore } from '../../src/store/store';
import { settle, undo } from '../../src/store/undo';
import { makeTask } from '../engine/helpers';
import { load, result, small, state, task } from './editHelpers';

describe('edits that change nothing — SPEC §8 (one action = one undo step)', () => {
  it('Plan mode: a start, duration or finish left as it was is no undo step and keeps the plan saved', () => {
    load(settle(small()).plan);
    editTask(4, 'plannedStart', result(4).plannedStart);
    editTask(4, 'plannedDuration', 3);
    editTask(4, 'plannedFinish', result(4).plannedFinish);
    expect(state()).toMatchObject({ undo: [], dirty: false });
  });

  it('Plan mode: an edit the plan derives straight back is no undo step either (a cleared start, a holiday start)', () => {
    load(settle({ ...small(), holidays: [{ date: '2026-11-04', description: 'Holiday' }] }).plan);
    editTask(4, 'plannedStart', ''); // blank follows Project Start, where task 4 already is
    expect(task(4).plannedStart).toBe('2026-11-02');
    expect(state()).toMatchObject({ undo: [], dirty: false });
    editTask(4, 'plannedStart', '2026-11-05');
    useStore.setState({ undo: [], redo: [], cleanPlan: state().plan, dirty: false });
    editTask(4, 'plannedStart', '2026-11-04'); // the holiday: snaps forward to the 5th it is on
    expect(task(4).plannedStart).toBe('2026-11-05');
    expect(state()).toMatchObject({ undo: [], dirty: false });
  });

  it('Track mode: the same progress or actual dates, or a blank left blank, are no undo step', () => {
    load({ ...small('Track'), tasks: [makeTask(1, { plannedDuration: 5, progress: 40, actualStart: '2026-11-03' }), makeTask(2, { progress: 100, actualStart: '2026-11-02', actualFinish: '2026-11-02' })] });
    editTask(1, 'progress', 40);
    editTask(1, 'actualStart', '2026-11-03');
    editTask(1, 'actualFinish', '');
    editTask(2, 'actualFinish', '2026-11-02');
    editTask(2, 'progress', 100);
    expect(state()).toMatchObject({ undo: [], dirty: false });
  });

  it('keeps the redo history', () => {
    load(settle(small()).plan);
    editTask(1, 'name', 'Excavate');
    undo();
    editTask(1, 'plannedDuration', 5);
    expect(state().redo).toHaveLength(1);
    expect(state().undo).toHaveLength(0);
  });

  it('Unlink with no links among the selected tasks says so', () => {
    load(small());
    select(1);
    select(4, 'toggle');
    unlinkSelected();
    expect(state().undo).toHaveLength(0);
    expect(state().toast?.message).toBe('No links between the selected tasks');
  });

  it('Project settings applied unchanged (or a name differing only in spaces) closes the dialog, no undo step', () => {
    load(small());
    useStore.setState({ dialog: { kind: 'projectSettings' } });
    updateProject({ name: 'Test ', owner: '', projectStart: '2026-11-02' }, true);
    expect(state()).toMatchObject({ dialog: null, undo: [], dirty: false });
  });
});

describe('values outside what the file can hold — SPEC §4.7, §8', () => {
  beforeEach(() => load(small()));

  it('Planned Duration over 3650 days is refused with a toast', () => {
    editTask(4, 'plannedDuration', 3651);
    expect(task(4).plannedDuration).toBe(3);
    expect(state().toast?.message).toBe('Duration must be 0–3650 days');
    editTask(4, 'plannedDuration', 3650);
    expect(task(4).plannedDuration).toBe(3650);
  });

  it('a Planned Finish that would make the duration too long is refused', () => {
    editTask(4, 'plannedFinish', '2199-12-31');
    expect(result(4).plannedDuration).toBe(3);
    expect(state().toast?.message).toBe('Duration must be 0–3650 days');
  });

  it('a date outside 1950–2199 (e.g. a 2-digit year) is refused with a toast', () => {
    editTask(4, 'plannedStart', '0026-11-20');
    expect(result(4).plannedStart).toBe('2026-11-02');
    expect(state().toast?.message).toBe('Enter a date between 1950 and 2199');
    load(small('Track'));
    editTask(1, 'actualStart', '0026-11-03');
    editTask(1, 'actualFinish', '2200-01-01');
    expect([task(1).actualStart, task(1).actualFinish, task(1).progress]).toEqual([undefined, undefined, 0]);
    expect(state().undo).toHaveLength(0);
  });

  it('the status date ignores a date outside 1950–2199', () => {
    setStatusDate('0026-11-13');
    setStatusDate('0002-11-13');
    expect(state().plan!.project.statusDate).toBe('2026-11-13');
    expect(state().undo).toHaveLength(0);
  });

  it('Project settings and New plan refuse such a Project Start and stay open', () => {
    useStore.setState({ dialog: { kind: 'projectSettings' } });
    updateProject({ name: 'Renamed', projectStart: '0026-11-09' });
    expect(state().plan!.project).toMatchObject({ name: 'Test', projectStart: '2026-11-02' });
    expect(state()).toMatchObject({ dialog: { kind: 'projectSettings' }, toast: { message: 'Enter a date between 1950 and 2199' } });
    const plan = state().plan;
    useStore.setState({ dialog: { kind: 'newPlan' }, toast: null });
    createPlan({ name: 'Pump', owner: '', projectStart: '0026-11-02' });
    expect(state().plan).toBe(plan);
    expect(state()).toMatchObject({ dialog: { kind: 'newPlan' }, toast: { message: 'Enter a date between 1950 and 2199' } });
  });
});

describe('Actual Finish on a task without Actual Start — SPEC §8', () => {
  beforeEach(() => load(small('Track')));

  it('fills Actual Start = Actual Finish, so no warning is raised and no number changes', () => {
    editTask(1, 'actualFinish', '2026-11-06');
    expect(task(1)).toMatchObject({ actualStart: '2026-11-06', actualFinish: '2026-11-06', progress: 100 });
    expect(state().toast?.message).toBe('Actual start set to 6 Nov — change if needed');
    expect(state().result!.issues.map((i) => i.code)).not.toContain('W_AF_NO_AS');
  });

  it('a one-day task whose finish moves earlier takes its start along', () => {
    editTask(1, 'actualFinish', '2026-11-06');
    editTask(1, 'actualFinish', '2026-11-04');
    expect(task(1)).toMatchObject({ actualStart: '2026-11-04', actualFinish: '2026-11-04' });
    expect(state().result!.issues.map((i) => i.code)).not.toContain('W_AF_BEFORE_AS');
  });

  it('leaves an Actual Start the task already has', () => {
    editTask(1, 'actualStart', '2026-11-02');
    editTask(1, 'actualFinish', '2026-11-06');
    expect(task(1)).toMatchObject({ actualStart: '2026-11-02', actualFinish: '2026-11-06' });
    expect(state().toast).toBeNull();
  });
});

describe('Add task in Track mode — SPEC §8', () => {
  it('starts no earlier than the first day after the status date, so it is not Late at once', () => {
    load(small('Track'));
    addTask();
    expect(task(5).plannedStart).toBe('2026-11-14');
    expect(result(5)).toMatchObject({ status: 'Not Started', variance: 0 });
  });

  it('keeps the selected task’s later start', () => {
    load({ ...small('Track'), tasks: [makeTask(1, { plannedStart: '2026-11-20', plannedDuration: 2 })] });
    select(1);
    addTask();
    expect(task(2).plannedStart).toBe('2026-11-20');
  });

  it('on the sample: adding below #2 leaves the late count and schedule state as they were', () => {
    load(sampleData);
    const before = computePlan(sampleData).summary;
    select(2);
    addTask();
    expect(result(26).status).toBe('Not Started');
    expect(state().result!.summary).toMatchObject({ state: before.state, counts: { late: before.counts.late } });
  });

  it('Plan mode keeps the selected task’s start', () => {
    load(small());
    select(4);
    addTask();
    expect(task(5).plannedStart).toBe('2026-11-02');
  });
});
