// Rules of the Issues panel (SPEC §7.11, §10), kept apart from the components so they can be tested.
import type { KeyboardEvent } from 'react';
import type { Issue, QuickFix } from '../../engine/types';
import { applyFix } from '../../store/edit';
import { setIssuesTab, showToast, useStore, type State } from '../../store/store';
import { undo } from '../../store/undo';
import { formatDayMonth } from '../common/format';

/** Quick fix buttons (§5.11). */
export function fixLabel(fix: QuickFix): string {
  if (fix.kind === 'removeLink') return 'Remove link';
  if (fix.kind === 'setActualFinish' && fix.actualStart !== undefined) {
    return `Set Actual Start = ${formatDayMonth(fix.actualStart)}, Finish = ${formatDayMonth(fix.value)}`;
  }
  return `Set Actual ${fix.kind === 'setActualStart' ? 'Start' : 'Finish'} = ${formatDayMonth(fix.value)}`;
}

/** What a quick fix did, for its toast (with Undo). */
export function fixDone(fix: QuickFix): string {
  if (fix.kind === 'removeLink') return `Task ${fix.taskId}: predecessor ${fix.predId} removed`;
  return `Task ${fix.taskId}: ${fixLabel(fix).replace(/^Set /, '')}`;
}

/** Applies a quick fix as one undo step and says so in a toast with Undo; false when it changed nothing. */
export function applyQuickFix(fix: QuickFix): boolean {
  const before = useStore.getState().plan;
  applyFix(fix);
  if (useStore.getState().plan === before) return false;
  showToast(fixDone(fix), { label: 'Undo', run: undo });
  return true;
}

/** React keys that stay with their issue when the ones before it go (a quick fix must not hand its focus on). */
export function keysOf(list: readonly Issue[]): string[] {
  const seen = new Map<string, number>();
  return list.map((issue) => {
    const key = `${issue.code}|${issue.taskId ?? ''}|${issue.message}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? key : `${key}#${n}`;
  });
}

/** Where the focus goes once the problem at index `i` is fixed: the one now in its place, else the last, else the
 * empty message. */
export function afterFixTarget(root: ParentNode, i: number): HTMLElement | null {
  const rows = root.querySelectorAll<HTMLElement>('.problem');
  const row = rows[Math.min(i, rows.length - 1)];
  return row?.querySelector<HTMLElement>('button.problem-text') ?? row ?? root.querySelector<HTMLElement>('.sheet-empty');
}

export const TABS: { tab: State['issuesTab']; label: string }[] = [
  { tab: 'problems', label: 'Problems' },
  { tab: 'changes', label: 'Changes' },
];

export const tabId = (tab: State['issuesTab']) => `issues-tab-${tab}`;

/** Tablist keys: ←/→ move to the other tab (and show it), Home/End to the first/last. */
export function onTabKey(e: Pick<KeyboardEvent, 'key' | 'preventDefault'>, tab: State['issuesTab']): void {
  const i = TABS.findIndex((t) => t.tab === tab);
  const moves: Record<string, number> = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: TABS.length - 1 };
  const to = moves[e.key];
  if (to === undefined) return;
  e.preventDefault();
  const next = TABS[(to + TABS.length) % TABS.length]!.tab;
  setIssuesTab(next);
  document.getElementById(tabId(next))?.focus();
}
