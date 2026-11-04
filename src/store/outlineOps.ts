// Outline edits (SPEC §5.12, §8): pure transforms of the task list. Rows keep their order and each has a Level; a row
// with deeper rows under it is a major task, and a "block" is a row with the rows under it (its tasks, at any depth).
// Every transform returns the new list with every Level written out, or null when it changes nothing.
import { MAX_LEVEL, normalizeLevels } from '../engine/outline';
import type { Task } from '../engine/types';

/** The plan's Levels as the engine reads them (§4.7). */
export const levelsOf = (tasks: readonly Task[]): number[] => normalizeLevels(tasks, []);

/** Whether the plan has a major task (some row below Level 1). */
export const hasOutline = (tasks: readonly Task[]): boolean => levelsOf(tasks).some((l) => l > 1);

/** End (exclusive) of the block that starts at row `i`. */
export function blockEnd(levels: readonly number[], i: number): number {
  let j = i + 1;
  while (j < levels.length && levels[j]! > levels[i]!) j++;
  return j;
}

/** Whether row `i` is a major task. */
export const isSummaryAt = (levels: readonly number[], i: number): boolean => (levels[i + 1] ?? 0) > levels[i]!;

/** The tasks with these Levels set: the app now owns them, so text Excel had in a Level cell goes (§4.8). */
export function withLevels(tasks: readonly Task[], levels: readonly number[]): Task[] {
  return tasks.map((task, i) => {
    const level = levels[i]!;
    const unparsed = task.unparsed?.filter((f) => f !== 'level');
    if (task.level === level && unparsed?.length === task.unparsed?.length) return task;
    return { ...task, level, unparsed: unparsed && unparsed.length > 0 ? unparsed : undefined };
  });
}

/** A valid outline: the first row at Level 1, none more than one deeper than the row above, none past MAX_LEVEL. */
export const validLevels = (levels: readonly number[]): boolean =>
  levels.every((l, i) => l >= 1 && l <= MAX_LEVEL && l <= (i === 0 ? 1 : levels[i - 1]! + 1));

/** Indexes of the chosen rows that aren't inside another chosen row's block, top to bottom. */
function roots(levels: readonly number[], indexes: readonly number[]): number[] {
  const sorted = [...new Set(indexes)].filter((i) => i >= 0).sort((a, b) => a - b);
  const out: number[] = [];
  for (const i of sorted) if (!out.some((r) => i < blockEnd(levels, r))) out.push(i);
  return out;
}

const indexesOf = (tasks: readonly Task[], ids: readonly number[]) => ids.map((id) => tasks.findIndex((t) => t.id === id));

export interface OutlineEdit {
  tasks: Task[];
  /** Major tasks the edit made out of tasks (Indent under a task): their own values stop counting (§8). */
  madeSummaries: number[];
}

/** §8 Indent: each chosen row (with its tasks) one Level deeper, at most one deeper than the row above it. */
export function indent(tasks: readonly Task[], ids: readonly number[]): OutlineEdit | null {
  const levels = levelsOf(tasks);
  const before = levels.map((_, i) => isSummaryAt(levels, i));
  let changed = false;
  for (const i of roots(levels, indexesOf(tasks, ids))) {
    if (i === 0 || levels[i]! > levels[i - 1]!) continue; // the first row, or already a task of the row above
    const end = blockEnd(levels, i);
    if (levels.slice(i, end).some((l) => l >= MAX_LEVEL)) continue;
    for (let k = i; k < end; k++) levels[k]!++;
    changed = true;
  }
  if (!changed) return null;
  const madeSummaries = tasks.filter((_, i) => !before[i] && isSummaryAt(levels, i)).map((t) => t.id);
  return { tasks: withLevels(tasks, levels), madeSummaries };
}

/** §8 Outdent: each chosen row below Level 1 (with its tasks) one Level up; following siblings become its tasks. */
export function outdent(tasks: readonly Task[], ids: readonly number[]): Task[] | null {
  const levels = levelsOf(tasks);
  let changed = false;
  for (const i of roots(levels, indexesOf(tasks, ids))) {
    if (levels[i] === 1) continue;
    const end = blockEnd(levels, i);
    for (let k = i; k < end; k++) levels[k]!--;
    changed = true;
  }
  return changed ? withLevels(tasks, levels) : null;
}

/**
 * §8 Group: `header` (a new major task) goes above the first chosen row at the chosen rows' shallowest Level, and the
 * chosen rows (each with its tasks) move under it in their order, one Level deeper.
 */
export function group(tasks: readonly Task[], ids: readonly number[], header: Task): Task[] | null {
  const levels = levelsOf(tasks);
  const chosen = roots(levels, indexesOf(tasks, ids));
  if (chosen.length === 0) return null;
  const top = Math.min(...chosen.map((i) => levels[i]!));
  const blocks = chosen.map((i) => ({ start: i, end: blockEnd(levels, i) }));
  const moved: { task: Task; level: number }[] = [];
  for (const b of blocks) {
    const delta = top + 1 - levels[b.start]!;
    for (let k = b.start; k < b.end; k++) moved.push({ task: tasks[k]!, level: levels[k]! + delta });
  }
  if (moved.some((m) => m.level > MAX_LEVEL)) return null;
  const inside = (k: number) => blocks.some((b) => k >= b.start && k < b.end);
  const out: { task: Task; level: number }[] = [];
  tasks.forEach((task, k) => {
    if (k === blocks[0]!.start) out.push({ task: header, level: top }, ...moved);
    if (!inside(k)) out.push({ task, level: levels[k]! });
  });
  const next = out.map((o) => o.level);
  return validLevels(next) ? withLevels(out.map((o) => o.task), next) : null;
}

/** §8 Ungroup: the major task's row goes and its tasks move up one Level. */
export function ungroup(tasks: readonly Task[], id: number): Task[] | null {
  const levels = levelsOf(tasks);
  const i = tasks.findIndex((t) => t.id === id);
  if (i < 0 || !isSummaryAt(levels, i)) return null;
  const end = blockEnd(levels, i);
  for (let k = i + 1; k < end; k++) levels[k]!--;
  levels.splice(i, 1);
  return withLevels(
    tasks.filter((t) => t.id !== id),
    levels,
  );
}

/** Rows a major task's deletion takes along: each chosen row with its tasks (§8). */
export function withTheirTasks(tasks: readonly Task[], ids: readonly number[]): number[] {
  const levels = levelsOf(tasks);
  const out = new Set(ids);
  for (const i of roots(levels, indexesOf(tasks, ids))) for (let k = i; k < blockEnd(levels, i); k++) out.add(tasks[k]!.id);
  return [...out];
}

/**
 * §8 Move up/down with major tasks: each chosen row (with its tasks) swaps with the neighbouring block of the same
 * major task. Null when none can move (the first or last of its group).
 */
export function moveAmongSiblings(tasks: readonly Task[], ids: readonly number[], direction: -1 | 1): Task[] | null {
  let list = [...tasks];
  let levels = levelsOf(list);
  let changed = false;
  const order = roots(levels, indexesOf(list, ids)).map((i) => list[i]!.id);
  for (const id of direction < 0 ? order : order.reverse()) {
    const i = list.findIndex((t) => t.id === id);
    const end = blockEnd(levels, i);
    let a: number;
    let b: number;
    let c: number;
    if (direction < 0) {
      let k = i - 1;
      while (k >= 0 && levels[k]! > levels[i]!) k--;
      if (k < 0 || levels[k] !== levels[i] || ids.includes(list[k]!.id)) continue; // no sibling above (or it moves too)
      [a, b, c] = [k, i, end];
    } else {
      if (end >= list.length || levels[end] !== levels[i] || ids.includes(list[end]!.id)) continue;
      [a, b, c] = [i, end, blockEnd(levels, end)];
    }
    list = [...list.slice(0, a), ...list.slice(b, c), ...list.slice(a, b), ...list.slice(c)];
    levels = [...levels.slice(0, a), ...levels.slice(b, c), ...levels.slice(a, b), ...levels.slice(c)];
    changed = true;
  }
  return changed ? withLevels(list, levels) : null;
}

/**
 * §7.7 Drag: the Levels a block can take at a drop place, between the rows shown above and below it there (the block
 * itself left out). `above` collapsed: the block goes after its tasks, beside it. Null when nothing fits.
 */
export function dropLevels(
  above: { level: number; collapsed: boolean } | undefined,
  below: { level: number } | undefined,
  blockDepth: number,
): { min: number; max: number } | null {
  const min = below?.level ?? 1;
  let max = above ? (above.collapsed ? above.level : above.level + 1) : 1;
  max = Math.min(max, MAX_LEVEL - blockDepth);
  return min <= max ? { min, max } : null;
}

/**
 * §7.7 Drag: moves the block that starts with task `id` to just before the row with ID `beforeId` (null: the end), its
 * first row at `level` and its tasks keeping their depth below it. Null when it would change nothing or break the outline.
 */
export function moveBlock(tasks: readonly Task[], id: number, beforeId: number | null, level: number): Task[] | null {
  const levels = levelsOf(tasks);
  const start = tasks.findIndex((t) => t.id === id);
  if (start < 0) return null;
  const end = blockEnd(levels, start);
  const block = tasks.slice(start, end);
  if (beforeId !== null && block.some((t) => t.id === beforeId)) return null; // inside itself
  const delta = level - levels[start]!;
  const moved = levels.slice(start, end).map((l) => l + delta);
  const restTasks = [...tasks.slice(0, start), ...tasks.slice(end)];
  const restLevels = [...levels.slice(0, start), ...levels.slice(end)];
  const at = beforeId === null ? restTasks.length : restTasks.findIndex((t) => t.id === beforeId);
  if (at < 0) return null;
  const list = [...restTasks.slice(0, at), ...block, ...restTasks.slice(at)];
  const next = [...restLevels.slice(0, at), ...moved, ...restLevels.slice(at)];
  if (!validLevels(next)) return null;
  if (list.every((t, i) => t === tasks[i]) && next.every((l, i) => l === levels[i])) return null;
  return withLevels(list, next);
}
