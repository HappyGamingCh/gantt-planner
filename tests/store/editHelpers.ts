// Shared set-up for the store edit tests: a plan loaded as if just opened, and the small reference plan.
import { computePlan } from '../../src/engine/compute';
import type { Plan } from '../../src/engine/types';
import { CLOSED, useStore } from '../../src/store/store';
import { makeProject, makeTask } from '../engine/helpers';

export const state = () => useStore.getState();
export const task = (id: number) => state().plan!.tasks.find((t) => t.id === id)!;
export const result = (id: number) => state().result!.tasks.find((t) => t.id === id)!;
export const ids = () => state().plan!.tasks.map((t) => t.id);

/** Loads `plan` as if just opened: clean, no history, no selection. */
export function load(plan: Plan) {
  useStore.setState({ ...CLOSED, plan, result: computePlan(plan), cleanPlan: plan, maxIdEver: Math.max(0, ...plan.tasks.map((t) => t.id)), toast: null });
}

/** Plan mode, Project Start Mon 2 Nov, status date Fri 13 Nov: 1 (5d) → 2 (2d) → 3 (1d), and 4 (3d) on its own. */
export const small = (mode: 'Plan' | 'Track' = 'Plan'): Plan => ({
  project: makeProject({ mode }),
  tasks: [
    makeTask(1, { plannedDuration: 5 }),
    makeTask(2, { plannedDuration: 2, predecessorsText: '1' }),
    makeTask(3, { plannedDuration: 1, predecessorsText: '2' }),
    makeTask(4, { plannedDuration: 3 }),
  ],
  resources: [],
  holidays: [],
});
