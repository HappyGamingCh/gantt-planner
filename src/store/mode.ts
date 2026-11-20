// Plan ↔ Track (SPEC §6): one undo step, saved to Project › Mode. Track freezes the baseline; dates that move when
// the plan is recalculated are listed in Changes (§7.11).
import { withHalf } from '../engine/schedule';
import type { Change, Project, TaskResult } from '../engine/types';
import { openIssues, showToast, useStore } from './store';
import { commit } from './undo';

const { getState: get, setState: set } = useStore;

/** Plan ↔ Track (§6). Track → Plan asks once per opened plan when tasks have actuals. Saved to Project › Mode. */
export function setMode(mode: Project['mode']): void {
  const { plan, planModeConfirmed } = get();
  if (!plan || plan.project.mode === mode) return;
  if (mode === 'Plan' && !planModeConfirmed && plan.tasks.some((t) => t.actualStart || t.actualFinish)) {
    set({ dialog: { kind: 'planMode' } });
    return;
  }
  applyMode(mode);
}

export function confirmPlanMode(): void {
  set({ dialog: null, planModeConfirmed: true });
  applyMode('Plan');
}

function applyMode(mode: Project['mode']) {
  const { plan, result } = get();
  if (!plan || !result) return;
  const before = new Map(result.tasks.map((r) => [r.id, r]));
  // Track freezes the baseline: keep the planned values just shown, which are what Save writes (§5.4).
  const tasks =
    mode === 'Track'
      ? plan.tasks.map((t) => {
          const r = before.get(t.id);
          if (!r) return t;
          // With its half days (§5.1): an afternoon start and a midday finish stay in the baseline.
          const { plannedStartPM: _s, plannedFinishMidday: _f, ...rest } = t;
          return {
            ...rest,
            plannedStart: r.plannedStart,
            plannedDuration: r.plannedDuration,
            plannedFinish: r.plannedFinish,
            ...(r.plannedStartPM ? { plannedStartPM: true } : {}),
            ...(r.plannedFinishMidday ? { plannedFinishMidday: true } : {}),
          };
        })
      : plan.tasks;
  commit((p) => ({ ...p, tasks, project: { ...p.project, mode } }));
  reportMoved(before);
}

/**
 * After a recalculation (a switch to Plan mode, a calendar change): planned dates that moved from `before` go to the
 * Changes list, and a toast says how many tasks moved, with Review (§6, §7.11, §7.14).
 */
export function reportMoved(before: ReadonlyMap<number, TaskResult>): void {
  const moved: Change[] = [];
  for (const r of get().result?.tasks ?? []) {
    const b = before.get(r.id);
    if (!b) continue;
    const change = (field: string, from: string, to: string) =>
      from !== to && moved.push({ taskId: r.id, field, from, to, kind: 'corrected', reason: 'Plan recalculated' });
    // A move by half a day counts too (§5.1): "3 Nov → 3 Nov afternoon".
    change('Planned Start', withHalf(b.plannedStart, b.plannedStartPM, 'afternoon'), withHalf(r.plannedStart, r.plannedStartPM, 'afternoon'));
    change('Planned Finish', withHalf(b.plannedFinish, b.plannedFinishMidday, 'midday'), withHalf(r.plannedFinish, r.plannedFinishMidday, 'midday'));
  }
  if (moved.length === 0) return;
  // A date recalculated again keeps one entry, from its value before the first recalculation (§7.11).
  const key = (c: Change) => `${c.taskId}|${c.field}`;
  const earlier = new Map(get().changes.filter((c) => c.reason === 'Plan recalculated').map((c) => [key(c), c.from]));
  const latest = moved.map((c) => ({ ...c, from: earlier.has(key(c)) ? earlier.get(key(c)) : c.from })).filter((c) => c.from !== c.to);
  const replaced = new Set(moved.map(key));
  set({ changes: [...get().changes.filter((c) => c.reason !== 'Plan recalculated' || !replaced.has(key(c))), ...latest] });
  const count = new Set(moved.map((c) => c.taskId)).size;
  showToast(`Plan recalculated — ${count} task${count === 1 ? '' : 's'} moved`, { label: 'Review', run: () => openIssues('changes') });
}
