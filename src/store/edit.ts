// Plan edits (SPEC §6, §8). Each exported action is one undo step (undo.ts) and recomputes the plan. The rules of
// a single field edit are in rules.ts; Plan ↔ Track in mode.ts.
import { createCalendar } from '../engine/calendar';
import { isPlanDate } from '../engine/dates';
import type { ComputeResult, ISODate, Plan, Project, QuickFix, Task } from '../engine/types';
import { cleanName } from '../excel/cells';
import { blockEnd, hasOutline, isSummaryAt, levelsOf, moveAmongSiblings, withLevels, withTheirTasks } from './outlineOps';
import { linksOf, renumberBlockers, renumberLinks, withLink, withoutLinks, wouldCycle } from './predecessors';
import { DATE_RANGE_MESSAGE, editRules, readOnlyReason, type EditField, type EditValue } from './rules';
import { rowsOf, shownRows, shownSelection } from './selectors';
import { openIssues, showToast, useStore } from './store';
import { commit, undo } from './undo';

export { DATE_RANGE_MESSAGE, readOnlyReason, type EditField, type EditValue } from './rules';
export { confirmPlanMode, setMode } from './mode';

const { getState: get, setState: set } = useStore;

/** The selected tasks the search and filters show: actions on the selection leave hidden rows alone (§7.6). */
const picked = () => shownSelection(get());

/** Edits one field of a task, applying the rules of §8. */
export function editTask(id: number, field: EditField, value: EditValue): void {
  const { plan, result } = get();
  const task = plan?.tasks.find((t) => t.id === id);
  if (!plan || !result || !task) return;
  const r = result.tasks.find((t) => t.id === id);
  const reason = readOnlyReason(field, task, r, plan.project.mode);
  if (reason) return showToast(reason);
  const { patch, message } = editRules(task, r, field, value, plan);
  if (!patch) return message ? showToast(message) : undefined; // refused: the message says why
  if (commit((p) => ({ ...p, tasks: p.tasks.map((t) => (t.id === id ? { ...t, ...patch, ...setByUser(t, patch) } : t)) })) && message) showToast(message);
}

/**
 * A planned field the user sets (cell, drawer, bar drag) stops keeping the text Excel had there (§4.8); a Planned
 * Finish edit sets the duration. The values settle() derives after every edit don't count.
 */
function setByUser(task: Task, patch: Partial<Task>): Partial<Task> {
  if (!task.unparsed?.some((f) => f in patch)) return {};
  const unparsed = task.unparsed.filter((f) => !(f in patch));
  return { unparsed: unparsed.length > 0 ? unparsed : undefined };
}

/**
 * §8 Add task: below the focused task, else at the end; opens the drawer on the name. The new row shows and
 * scrolls into view even when the search or filters would hide it (pinned until they change, §7.6).
 */
export function addTask(): void {
  const { plan, result, maxIdEver, reveal, pinned, collapsed } = get();
  if (!plan || !result) return;
  const after = picked().at(-1);
  const found = plan.tasks.findIndex((t) => t.id === after);
  // §8 with major tasks: an expanded one gets it as its first task; after a collapsed one it goes past its tasks.
  const levels = levelsOf(plan.tasks);
  const outlined = levels.some((l) => l > 1);
  const summary = found >= 0 && isSummaryAt(levels, found);
  const index = found < 0 ? plan.tasks.length : summary && collapsed.includes(after!) ? blockEnd(levels, found) : found + 1;
  const level = found < 0 ? 1 : levels[found]! + (summary && !collapsed.includes(after!) ? 1 : 0);
  const id = Math.max(maxIdEver, ...plan.tasks.map((t) => t.id)) + 1;
  const base = (found < 0 ? undefined : result.tasks.find((r) => r.id === after)?.plannedStart) ?? plan.project.projectStart;
  // §8 Track mode: new work starts no earlier than the first day after the status date (R, §5.6), else it is Late at once.
  const earliest = createCalendar(plan.holidays.map((h) => h.date)).nextWorkday(plan.project.statusDate);
  const plannedStart = plan.project.mode === 'Track' && base < earliest ? earliest : base;
  const task: Task = { id, name: 'New task', assigned: [], predecessorsText: '', plannedStart, plannedDuration: 1, progress: 0, remarks: '', extra: {} };
  if (plan.project.mode === 'Track') task.isNewThisSession = true;
  const add = (tasks: Task[]): Task[] => {
    const list = [...tasks.slice(0, index), task, ...tasks.slice(index)];
    return outlined ? withLevels(list, [...levels.slice(0, index), level, ...levels.slice(index)]) : list;
  };
  commit((p) => ({ ...p, tasks: add(p.tasks) }), {
    selection: [id],
    anchor: id,
    drawerId: id,
    panel: null,
    maxIdEver: id,
    nameFocus: id,
    reveal: reveal + 1,
    pinned: [...pinned, id],
  });
}

/** §8 Delete: asks first when other tasks depend on the ones going; their links are removed. */
export function deleteTasks(ids: readonly number[], confirmed = false): void {
  const { plan, result } = get();
  if (!plan || ids.length === 0) return;
  // A major task goes with its tasks and always asks first (§8).
  const going = new Set(withTheirTasks(plan.tasks, ids));
  const dependents = plan.tasks.filter((t) => !going.has(t.id) && linksOf(t).some((l) => going.has(l.predId))).length;
  const groups = ids.map((id) => result?.tasks.find((r) => r.id === id)).filter((r) => r?.summary);
  if ((dependents > 0 || groups.length > 0) && !confirmed) {
    const only = groups.length === 1 && ids.length === 1 ? groups[0]! : undefined;
    const group = only && { name: plan.tasks.find((t) => t.id === only.id)!.name, tasks: going.size - 1 };
    return set({ dialog: { kind: 'delete', ids: [...going], dependents, ...(group ? { group } : {}) } });
  }
  const count = plan.tasks.filter((t) => going.has(t.id)).length;
  const done = commit(
    (p) => ({
      ...p,
      tasks: p.tasks
        .filter((t) => !going.has(t.id))
        .map((t) => {
          const text = withoutLinks(t.predecessorsText, going);
          return text === t.predecessorsText ? t : { ...t, predecessorsText: text };
        }),
    }),
    { selection: [], anchor: null, drawerId: null, dialog: null },
  );
  if (!done) return;
  const deleted = get().plan; // the toast's Undo undoes this delete only, never a later action
  showToast(count === 1 ? 'Task deleted' : `${count} tasks deleted`, { label: 'Undo', run: () => get().plan === deleted && undo() });
}

export function deleteSelected(): void {
  deleteTasks(picked());
}

/** §8 Move up/down: row order only; IDs stay. Rows hidden by the search or filters are moved past, not swapped with. */
export function moveSelected(direction: -1 | 1): void {
  const { plan, result, filters, pinned } = get();
  const chosen = new Set(picked());
  if (!plan || !result || chosen.size === 0) return;
  if (hasOutline(plan.tasks)) {
    // §8 with major tasks: among the tasks of its own major task only; dragging moves a row to another group.
    const tasks = moveAmongSiblings(plan.tasks, [...chosen], direction);
    if (!tasks) return showToast('Drag the row to move it to another group');
    commit((p) => ({ ...p, tasks }));
    return;
  }
  const shown = new Set(shownRows(rowsOf(plan, result), filters, pinned).map((row) => row.task.id));
  const visible = plan.tasks.filter((t) => shown.has(t.id));
  const edge = direction < 0 ? visible[0] : visible.at(-1);
  if (!edge || chosen.has(edge.id)) return;
  const tasks = [...plan.tasks];
  const moving = tasks.filter((t) => chosen.has(t.id));
  for (const task of direction < 0 ? moving : moving.reverse()) {
    // Next to the nearest shown row above (below), as the rows stand now: earlier moves have already gone past it.
    const i = tasks.indexOf(task);
    let j = i + direction;
    while (!shown.has(tasks[j]!.id)) j += direction;
    tasks.splice(i, 1);
    tasks.splice(j, 0, task);
  }
  commit((p) => ({ ...p, tasks }));
}

/** §7.6 Link (Plan mode): chains the selected tasks FS in row order, skipping links that would close a cycle. */
export function linkSelected(): void {
  const { plan } = get();
  if (!plan) return;
  if (plan.project.mode !== 'Plan') return showToast('Switch to Plan mode to link tasks.');
  const selection = picked();
  if (selection.length < 2) return showToast('Select two or more tasks to link (Shift+↑/↓ or Shift+click).'); // Ctrl+L is never silent
  const summaries = new Set(get().result?.tasks.filter((r) => r.summary).map((r) => r.id));
  const chain = plan.tasks.filter((t) => selection.includes(t.id) && !summaries.has(t.id)); // §5.12: no links on major tasks
  if (chain.length < 2) return showToast('Select two or more tasks to link: major tasks have no links of their own');
  let tasks = plan.tasks;
  let skipped = 0;
  for (let i = 1; i < chain.length; i++) {
    const [pred, succ] = [chain[i - 1]!.id, chain[i]!.id];
    if (linksOf(tasks.find((t) => t.id === succ)!).some((l) => l.predId === pred)) continue;
    if (wouldCycle(tasks, pred, succ)) {
      skipped++;
      continue;
    }
    tasks = tasks.map((t) => (t.id === succ ? { ...t, predecessorsText: withLink(t.predecessorsText, { predId: pred, type: 'FS', lag: 0 }) } : t));
  }
  if (tasks !== plan.tasks) commit((p) => ({ ...p, tasks }));
  if (skipped > 0) showToast(skipped === 1 ? 'A link was skipped: it would create a circular dependency.' : `${skipped} links were skipped: they would create circular dependencies.`);
}

/** §7.6 Unlink (Plan mode): removes the links among the selected tasks. */
export function unlinkSelected(): void {
  const { plan } = get();
  if (!plan) return;
  if (plan.project.mode !== 'Plan') return showToast('Switch to Plan mode to unlink tasks.');
  const chosen = new Set(picked());
  const unlinked = (t: Task) => (chosen.has(t.id) ? withoutLinks(t.predecessorsText, chosen) : t.predecessorsText);
  if (plan.tasks.every((t) => unlinked(t) === t.predecessorsText)) return showToast('No links between the selected tasks');
  commit((p) => ({
    ...p,
    tasks: p.tasks.map((t) => {
      const text = unlinked(t);
      return text === t.predecessorsText ? t : { ...t, predecessorsText: text };
    }),
  }));
}

export function askRenumber(): void {
  const { plan } = get();
  if (!plan || plan.project.mode !== 'Plan') return showToast('Switch to Plan mode to renumber IDs.');
  if (!renumberRefused(plan)) set({ dialog: { kind: 'renumber' } });
}

/**
 * §8 Renumber needs every predecessor reference to keep its meaning: a missing ID could become another task's
 * number. Says which tasks to fix first, and returns true, when one can't.
 */
function renumberRefused(plan: Plan): boolean {
  const blocked = renumberBlockers(plan.tasks);
  if (blocked.length === 0) return false;
  const list = blocked.length > 5 ? `${blocked.slice(0, 5).join(', ')}…` : blocked.join(', ');
  set({ dialog: null });
  showToast(`Fix the predecessors of task${blocked.length === 1 ? '' : 's'} ${list} first — Renumber would change what they point to`, {
    label: 'Review',
    run: () => openIssues('problems'),
  });
  return true;
}

/** §8 Renumber IDs: 1…n in row order, predecessor references rewritten; every view of a task follows it. */
export function renumber(): void {
  const { plan, selection, anchor, drawerId, pinned, changes } = get();
  if (!plan || renumberRefused(plan)) return;
  const ids = new Map(plan.tasks.flatMap((t, i) => (t.id === i + 1 ? [] : [[t.id, i + 1] as const])));
  if (ids.size === 0) {
    set({ dialog: null });
    return showToast('IDs already run 1 to N in row order.');
  }
  const to = (id: number) => ids.get(id) ?? id;
  // A deleted task's number may now go to another task: its pin goes, and its Changes rows no longer name a task.
  const known = new Set(plan.tasks.map((t) => t.id));
  const remapped = changes.map((c) => {
    if (c.taskId === undefined) return c;
    return known.has(c.taskId) ? { ...c, taskId: to(c.taskId) } : { ...c, taskId: undefined };
  });
  commit(
    (p) => ({ ...p, tasks: p.tasks.map((t) => ({ ...t, id: to(t.id), predecessorsText: renumberLinks(t.predecessorsText, ids) })) }),
    {
      dialog: null,
      maxIdEver: plan.tasks.length,
      selection: selection.map(to),
      anchor: anchor === null ? null : to(anchor),
      drawerId: drawerId === null ? null : to(drawerId),
      pinned: pinned.filter((id) => known.has(id)).map(to),
      changes: remapped, // read issues follow Task.source
    },
    ids,
  );
}

/** Root tasks (no links) that start on Project Start: a new Project Start can take them along (§8). */
export function rootsOnProjectStart(plan: Plan, result: ComputeResult): Task[] {
  const linked = new Set(result.tasks.filter((r) => r.links.length > 0).map((r) => r.id));
  return plan.tasks.filter((t) => !linked.has(t.id) && t.plannedStart === plan.project.projectStart);
}

/**
 * Project settings and the header (§7.4). In Plan mode, `moveRoots` also moves the root tasks on the old Project
 * Start to the new one (§8), in the same undo step.
 */
export function updateProject(fields: Partial<Pick<Project, 'name' | 'owner' | 'projectStart'>>, moveRoots = false): void {
  const { plan, result } = get();
  if (!plan || !result) return;
  if (fields.projectStart !== undefined && !isPlanDate(fields.projectStart)) return showToast(DATE_RANGE_MESSAGE);
  const project = { ...plan.project, ...fields, name: cleanName(fields.name ?? plan.project.name) || plan.project.name };
  const moving = moveRoots && plan.project.mode === 'Plan' && project.projectStart !== plan.project.projectStart;
  const move = new Set(moving ? rootsOnProjectStart(plan, result).map((t) => t.id) : []);
  commit((p) => ({ ...p, project, tasks: move.size > 0 ? p.tasks.map((t) => (move.has(t.id) ? { ...t, plannedStart: project.projectStart } : t)) : p.tasks }), {
    dialog: null,
  });
}

/** §8 Status date: recompute everything; nothing is written to tasks. A date outside 1950–2199 is ignored. */
export function setStatusDate(statusDate: ISODate): void {
  if (isPlanDate(statusDate)) commit((p) => (p.project.statusDate === statusDate ? p : { ...p, project: { ...p.project, statusDate } }));
}

/** Quick fixes of the Issues panel (§5.11). */
export function applyFix(fix: QuickFix): void {
  commit((p) => ({
    ...p,
    tasks: p.tasks.map((t) => {
      if (t.id !== fix.taskId) return t;
      if (fix.kind === 'removeLink') return { ...t, predecessorsText: withoutLinks(t.predecessorsText, new Set([fix.predId])) };
      if (fix.kind === 'setActualStart') return { ...t, actualStart: fix.value };
      // The fix may also carry the start the engine already uses (100% with neither date), so no number changes.
      // A start outside 1950–2199 is blank to the engine (§5.5), which offered this one in its place.
      const fillStart = fix.actualStart !== undefined && (t.actualStart === undefined || !isPlanDate(t.actualStart));
      return { ...t, actualFinish: fix.value, ...(fillStart ? { actualStart: fix.actualStart } : {}) };
    }),
  }));
}
