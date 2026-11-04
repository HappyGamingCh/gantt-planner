import { beforeEach, describe, expect, it } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import { makeIssue } from '../../src/engine/issues';
import type { Plan } from '../../src/engine/types';
import { sampleData } from '../../src/sample/sampleData';
import { createPlan, loadSummary, nextMonday } from '../../src/store/files';
import { confirmPlanMode, setMode } from '../../src/store/edit';
import { CLOSED, useStore } from '../../src/store/store';

const state = () => useStore.getState();

function load(plan: Plan = sampleData) {
  useStore.setState({ ...CLOSED, plan, result: computePlan(plan), planModeConfirmed: false });
}

describe('mode switch — SPEC §6', () => {
  beforeEach(() => load());

  it('Track → Plan asks first when tasks have actuals, then not again this session', () => {
    setMode('Plan');
    expect(state().dialog).toEqual({ kind: 'planMode' });
    expect(state().plan?.project.mode).toBe('Track');
    confirmPlanMode();
    expect(state()).toMatchObject({ dialog: null, dirty: true, toast: null }); // nothing moved: no toast
    expect(state().plan?.project.mode).toBe('Plan');
    setMode('Track');
    setMode('Plan');
    expect(state().dialog).toBeNull();
    expect(state().plan?.project.mode).toBe('Plan');
  });

  it('asks again for the next plan opened or created: the confirmation belongs to one plan', () => {
    setMode('Plan');
    confirmPlanMode();
    createPlan({ name: 'Other', owner: '', projectStart: '2026-11-02' }); // resets like Open and Try sample (CLOSED)
    expect(state().planModeConfirmed).toBe(false);
    useStore.setState({ plan: sampleData, result: computePlan(sampleData) }); // a plan in Track mode with actuals
    setMode('Plan');
    expect(state().dialog).toEqual({ kind: 'planMode' });
  });

  it('Plan mode recalculates stored dates that no longer fit, and says how many tasks moved', () => {
    const stale = sampleData.tasks.map((t) => (t.id === 9 ? { ...t, plannedStart: '2026-10-05', plannedFinish: '2026-10-06' } : t));
    load({ ...sampleData, tasks: stale });
    useStore.setState({ planModeConfirmed: true });
    const derived = computePlan({ ...sampleData, project: { ...sampleData.project, mode: 'Plan' } }).tasks.find((t) => t.id === 9)!;
    setMode('Plan');
    expect(state().toast?.message).toBe('Plan recalculated — 1 task moved');
    expect(state().changes).toEqual([
      { taskId: 9, field: 'Planned Start', from: '2026-10-05', to: derived.plannedStart, kind: 'corrected', reason: 'Plan recalculated' },
      { taskId: 9, field: 'Planned Finish', from: '2026-10-06', to: derived.plannedFinish, kind: 'corrected', reason: 'Plan recalculated' },
    ]);
  });

  it('Plan → Track keeps the planned dates just shown as the baseline', () => {
    const stale = sampleData.tasks.map((t) => (t.id === 9 ? { ...t, plannedStart: '2026-10-05', plannedFinish: '2026-10-06' } : t));
    load({ ...sampleData, tasks: stale });
    useStore.setState({ planModeConfirmed: true });
    setMode('Plan');
    const planned = state().result!.tasks.find((t) => t.id === 9)!;
    setMode('Track');
    expect(state().plan?.tasks.find((t) => t.id === 9)).toMatchObject({ plannedStart: planned.plannedStart, plannedFinish: planned.plannedFinish });
    expect(state().result!.tasks.find((t) => t.id === 9)).toMatchObject({ plannedStart: planned.plannedStart, plannedFinish: planned.plannedFinish });
  });
});

describe('new plan — SPEC §7.10', () => {
  it('one task in Plan mode, not saved yet, file named after the project', () => {
    createPlan({ name: ' Pump / station ', owner: ' Somchai ', projectStart: '2026-11-02' });
    const s = state();
    expect(s.plan?.project).toMatchObject({ name: 'Pump / station', owner: 'Somchai', projectStart: '2026-11-02', mode: 'Plan' });
    expect(s.plan?.tasks).toEqual([expect.objectContaining({ id: 1, name: 'New task', plannedStart: '2026-11-02', plannedDuration: 1 })]);
    expect(s.file?.name).toBe('Pump station.xlsx');
    expect(s.file?.handle).toBeUndefined(); // the first Save asks where
    expect(s.dirty).toBe(true);
  });

  it('a blank name becomes "Untitled project"', () => {
    createPlan({ name: '  ', owner: '', projectStart: '2026-11-02' });
    expect(state().plan?.project.name).toBe('Untitled project');
    expect(state().file?.name).toBe('Untitled project.xlsx');
  });

  it('defaults Project Start to the next Monday', () => {
    expect(nextMonday('2026-10-30')).toBe('2026-11-02'); // Friday
    expect(nextMonday('2026-11-01')).toBe('2026-11-02'); // Sunday
    expect(nextMonday('2026-11-02')).toBe('2026-11-09'); // Monday → the one after
  });
});

describe('load report — SPEC §7.11', () => {
  it('counts filled and corrected values, warnings and errors', () => {
    const change = (kind: 'filled' | 'corrected') => ({ field: 'Status', from: undefined, to: 'Late', kind, reason: 'Calculated' });
    const issues = [makeIssue('W_FORMULA'), makeIssue('W_NO_DURATION', { id: 1 }), makeIssue('W_100_NO_AF', { id: 2 }), makeIssue('E_CYCLE', { ids: '1, 2' })];
    expect(loadSummary([change('filled'), change('corrected'), change('corrected')], issues)).toBe('Filled 1 value · corrected 2 · 2 warnings · 1 error');
    expect(loadSummary([change('filled'), change('filled')], [])).toBe('Filled 2 values · corrected 0 · 0 warnings');
  });
});
