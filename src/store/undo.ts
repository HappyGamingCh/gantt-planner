// One user action = one undo step (SPEC §8): each step snapshots the whole plan (project, tasks, resources).
// Plans are never mutated, so a snapshot is the previous plan object itself.
import { UNDO_LIMIT } from '../config';
import { computePlan } from '../engine/compute';
import type { Change, ComputeResult, Plan } from '../engine/types';
import { useStore, type State } from './store';

const { getState: get, setState: set } = useStore;

/**
 * Stores the derived planned dates of tasks whose plan isn't frozen (Plan mode, or added this session in Track
 * mode), so the next recompute doesn't report the app's own edits as corrections. They are what Save writes.
 */
export function settle(plan: Plan): { plan: Plan; result: ComputeResult } {
  const result = computePlan(plan);
  const byId = new Map(result.tasks.map((r) => [r.id, r]));
  let changed = false;
  const tasks = plan.tasks.map((task) => {
    const r = byId.get(task.id);
    if (!r || (plan.project.mode === 'Track' && !task.isNewThisSession)) return task;
    if (task.plannedStart === r.plannedStart && task.plannedDuration === r.plannedDuration && task.plannedFinish === r.plannedFinish) return task;
    changed = true;
    return { ...task, plannedStart: r.plannedStart, plannedDuration: r.plannedDuration, plannedFinish: r.plannedFinish };
  });
  if (!changed) return { plan, result };
  const settled = { ...plan, tasks };
  return { plan: settled, result: computePlan(settled) };
}

/** Equal values: the same, or arrays with the same items (Assigned). */
const sameValue = (a: unknown, b: unknown) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]));

/** Shallow equality over both objects' keys; a missing key counts as undefined. */
function sameFields(a: object, b: object): boolean {
  const [ra, rb] = [a as Record<string, unknown>, b as Record<string, unknown>];
  return a === b || [...new Set([...Object.keys(ra), ...Object.keys(rb)])].every((k) => sameValue(ra[k], rb[k]));
}

/** Whether an edit left the plan as it was (e.g. a cell left with its own value): such an edit is no undo step. */
function samePlan(a: Plan, b: Plan): boolean {
  return (
    a === b ||
    (a.resources === b.resources &&
      a.holidays === b.holidays &&
      sameFields(a.project, b.project) &&
      a.tasks.length === b.tasks.length &&
      a.tasks.every((t, i) => sameFields(t, b.tasks[i]!)))
  );
}

/** Old → new task IDs of plans made by Renumber, so undo and redo can move the selection and the drawer along. */
const renumbered = new WeakMap<Plan, ReadonlyMap<number, number>>();
/** The Changes list shown with each plan in the history: undo and redo bring it back with the plan (§7.11). */
const changesOf = new WeakMap<Plan, Change[]>();

/** A toast with an action ("Task deleted · Undo") is about the plan it was shown for; any later plan change retires it. */
const retireActionToast = (): Partial<State> => (get().toast?.action ? { toast: null } : {});

/**
 * Applies one user action: undo snapshot, recompute, dirty flag. Returns false when it changed nothing; the UI
 * state in `extra` (e.g. closing a dialog) still applies then. `ids` maps old → new task IDs when the action
 * renumbers tasks.
 */
export function commit(update: (plan: Plan) => Plan, extra: Partial<State> = {}, ids?: ReadonlyMap<number, number>): boolean {
  const { plan, undo, cleanPlan, changes } = get();
  if (!plan) return false;
  const edited = update(plan);
  if (samePlan(edited, plan)) {
    if (Object.keys(extra).length > 0) set(extra);
    return false;
  }
  const next = settle(edited);
  // Plan mode can derive the very values the edit took away (a cleared Planned Start back on Project Start).
  if (samePlan(next.plan, plan)) {
    if (Object.keys(extra).length > 0) set(extra);
    return false;
  }
  changesOf.set(plan, changes);
  if (ids) renumbered.set(next.plan, ids);
  set({
    plan: next.plan,
    result: next.result,
    undo: [...undo, plan].slice(-UNDO_LIMIT),
    redo: [],
    dirty: next.plan !== cleanPlan,
    ...retireActionToast(),
    ...extra,
  });
  return true;
}

/** Shows `target` from the history. Task IDs in the view state follow `ids` (a Renumber undone or redone). */
function restore(target: Plan, undo: Plan[], redo: Plan[], ids?: ReadonlyMap<number, number>) {
  const { plan, changes, selection, anchor, drawerId, pinned, cleanPlan } = get();
  if (plan) changesOf.set(plan, changes);
  const known = new Set(target.tasks.map((t) => t.id));
  const to = (id: number) => ids?.get(id) ?? id;
  const kept = (list: readonly number[]) => list.map(to).filter((id) => known.has(id));
  const one = (id: number | null) => (id !== null && known.has(to(id)) ? to(id) : null);
  set({
    plan: target,
    result: computePlan(target),
    undo,
    redo,
    dirty: target !== cleanPlan,
    changes: changesOf.get(target) ?? changes,
    selection: kept(selection),
    anchor: one(anchor),
    drawerId: one(drawerId),
    pinned: kept(pinned),
    ...retireActionToast(),
  });
}

const inverse = (ids: ReadonlyMap<number, number> | undefined) => (ids ? new Map([...ids].map(([from, to]) => [to, from])) : undefined);

export function undo(): void {
  const { plan, undo: past, redo: future } = get();
  const previous = past.at(-1);
  if (plan && previous) restore(previous, past.slice(0, -1), [...future, plan], inverse(renumbered.get(plan)));
}

export function redo(): void {
  const { plan, undo: past, redo: future } = get();
  const next = future.at(-1);
  if (plan && next) restore(next, [...past, plan], future.slice(0, -1), renumbered.get(next));
}
