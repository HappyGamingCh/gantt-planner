// Outline actions (SPEC §7.6, §7.7, §8): Indent, Outdent, Group, Ungroup, drag a row, collapse and expand. Each edit is
// one undo step; collapsing is the view's (§17), so it isn't one.
import type { Task } from '../engine/types';
import { group, indent, levelsOf, moveBlock, outdent, ungroup } from './outlineOps';
import { isFiltering, shownSelection } from './selectors';
import { showToast, useStore } from './store';
import { commit } from './undo';

const { getState: get, setState: set } = useStore;

/** The selected rows the search and filters show (§7.6). */
const picked = () => shownSelection(get());
const nameOf = (id: number) => get().plan?.tasks.find((t) => t.id === id)?.name ?? '';

/** §8 Indent (Alt+Shift+→). */
export function indentSelected(): void {
  const { plan } = get();
  if (!plan) return;
  const edit = indent(plan.tasks, picked());
  if (!edit) return showToast(picked().length === 0 ? 'Select a task to indent' : "Can't indent: a row goes at most one level deeper than the row above");
  if (!commit((p) => ({ ...p, tasks: edit.tasks }))) return;
  const made = edit.madeSummaries;
  if (made.length === 1) showToast(`"${nameOf(made[0]!)}" is now a major task: its dates and progress come from its tasks`);
  else if (made.length > 1) showToast(`${made.length} tasks are now major tasks: their dates and progress come from their tasks`);
}

/** §8 Outdent (Alt+Shift+←). */
export function outdentSelected(): void {
  const { plan } = get();
  if (!plan) return;
  const tasks = outdent(plan.tasks, picked());
  if (!tasks) return showToast(picked().length === 0 ? 'Select a task to outdent' : 'Already at the top level');
  commit((p) => ({ ...p, tasks }));
}

/** §8 Group: a new major task "New group" over the selected rows; the drawer opens on its name. */
export function groupSelected(): void {
  const { plan, maxIdEver } = get();
  const ids = picked();
  if (!plan) return;
  if (ids.length === 0) return showToast('Select the tasks to group');
  const id = Math.max(maxIdEver, ...plan.tasks.map((t) => t.id)) + 1;
  const header: Task = { id, name: 'New group', assigned: [], predecessorsText: '', progress: 0, remarks: '', extra: {} };
  const tasks = group(plan.tasks, ids, header);
  if (!tasks) return showToast(`Can't group: the outline goes at most 8 levels deep`);
  commit((p) => ({ ...p, tasks }), { selection: [id], anchor: id, drawerId: id, panel: null, maxIdEver: id, nameFocus: id });
}

/** §8 Ungroup: the selected major task's row goes; its tasks move up one Level. */
export function ungroupSelected(): void {
  const { plan, result, selection } = get();
  if (!plan || !result) return;
  const id = picked().find((s) => result.tasks.find((r) => r.id === s)?.summary);
  if (id === undefined) return showToast('Select a major task to ungroup');
  const tasks = ungroup(plan.tasks, id);
  if (tasks) commit((p) => ({ ...p, tasks }), { selection: selection.filter((s) => s !== id), drawerId: null });
}

/** §7.7 Drag: the row (with its tasks) goes before `beforeId` (null: the end) at `level`. */
export function dropRow(id: number, beforeId: number | null, level: number): void {
  const { plan, filters } = get();
  if (!plan) return;
  if (isFiltering(filters)) return showToast('Clear the search and filters to move rows by dragging');
  const tasks = moveBlock(plan.tasks, id, beforeId, level);
  if (tasks) commit((p) => ({ ...p, tasks }), { selection: [id], anchor: id });
}

/** §7.7 The chevron of a major task. */
export function toggleCollapsed(id: number): void {
  const { collapsed } = get();
  set({ collapsed: collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id] });
}

/** Alt+Shift+− / Alt+Shift+=: the active row's major task (the row itself when it is one, else its major task). */
export function setCollapsedOf(id: number, collapse: boolean): void {
  const { plan, result, collapsed } = get();
  if (!plan || !result) return;
  const levels = result.tasks.map((r) => r.level);
  const i = plan.tasks.findIndex((t) => t.id === id);
  let k = i;
  if (!result.tasks[i]?.summary) while (k > 0 && levels[k]! >= levels[i]!) k--; // its major task
  const target = result.tasks[k];
  if (!target?.summary || (k !== i && levels[k]! >= levels[i]!)) return;
  if (collapse && !collapsed.includes(target.id)) set({ collapsed: [...collapsed, target.id], selection: [target.id], anchor: target.id });
  if (!collapse && collapsed.includes(target.id)) set({ collapsed: collapsed.filter((c) => c !== target.id) });
}

/** Outline menu: Collapse all / Expand all. */
export function collapseAll(): void {
  const { result } = get();
  if (result) set({ collapsed: result.tasks.filter((r) => r.summary).map((r) => r.id) });
}

export function expandAll(): void {
  set({ collapsed: [] });
}

/** Whether the plan has major tasks (the Outline menu's Collapse all / Expand all apply). */
export const planHasOutline = (tasks: readonly Task[]): boolean => levelsOf(tasks).some((l) => l > 1);
