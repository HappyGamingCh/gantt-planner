// Edits of predecessor text (SPEC §5.2, §8). The text stays the single source of links: valid links are
// rewritten in canonical form, tokens the app can't read are kept as typed.
import { formatLink, parsePredecessors, type ParsedToken } from '../engine/links';
import type { Link, Task } from '../engine/types';

/** Predecessor text from tokens: valid links in canonical form, the rest as typed. */
export const textOf = (tokens: readonly ParsedToken[]) => tokens.map((t) => (t.link ? formatLink(t.link) : t.raw)).join(', ');

/** Adds `link`, replacing a link to the same predecessor. */
export function withLink(text: string, link: Link): string {
  return textOf([...parsePredecessors(text).filter((t) => t.link?.predId !== link.predId), { raw: '', link }]);
}

/** Drops every link to the given predecessors; returns `text` unchanged when it has none. */
export function withoutLinks(text: string, predIds: ReadonlySet<number>): string {
  const tokens = parsePredecessors(text);
  const kept = tokens.filter((t) => !(t.link && predIds.has(t.link.predId)));
  return kept.length === tokens.length ? text : textOf(kept);
}

/** The ID a token starts with (`20FF` → 20), if it starts with digits. */
function leadingId(raw: string): number | undefined {
  const digits = /^\d+/.exec(raw)?.[0];
  return digits === undefined ? undefined : Number(digits);
}

/**
 * Rewrites predecessor IDs (Renumber); returns `text` unchanged when nothing maps. FF/SF links can't be read but
 * name a task: their ID is rewritten too, the rest stays as typed.
 */
export function renumberLinks(text: string, ids: ReadonlyMap<number, number>): string {
  const tokens = parsePredecessors(text);
  const mapped = tokens.map((t) => {
    if (t.link) return ids.has(t.link.predId) ? { ...t, link: { ...t.link, predId: ids.get(t.link.predId)! } } : t;
    const id = t.error === 'unsupported' ? leadingId(t.raw) : undefined;
    return id !== undefined && ids.has(id) ? { ...t, raw: t.raw.replace(/^\d+/, String(ids.get(id))) } : t;
  });
  return mapped.some((t, i) => t !== tokens[i]) ? textOf(mapped) : text;
}

/**
 * Tasks whose predecessors Renumber would give another meaning: a reference to an ID no task has (it could become
 * another task's number), or unreadable text with a number in it.
 */
export function renumberBlockers(tasks: readonly Task[]): number[] {
  const known = new Set(tasks.map((t) => t.id));
  const blocks = (t: ParsedToken) => {
    if (t.error === 'bad') return /\d/.test(t.raw);
    const id = t.link?.predId ?? leadingId(t.raw);
    return id !== undefined && !known.has(id);
  };
  return tasks.filter((task) => parsePredecessors(task.predecessorsText).some(blocks)).map((task) => task.id);
}

/** Valid links of a task, in the user's order. */
export function linksOf(task: Task): Link[] {
  return parsePredecessors(task.predecessorsText).flatMap((t) => (t.link ? [t.link] : []));
}

/** Tasks that depend on `id`, directly or through others. Linking `id` after one of them would close a cycle. */
export function dependents(tasks: readonly Task[], id: number): Set<number> {
  const successors = new Map<number, number[]>();
  for (const task of tasks) {
    for (const link of linksOf(task)) successors.set(link.predId, [...(successors.get(link.predId) ?? []), task.id]);
  }
  const found = new Set<number>();
  const stack = [id];
  while (stack.length > 0) {
    for (const s of successors.get(stack.pop()!) ?? []) {
      if (!found.has(s)) {
        found.add(s);
        stack.push(s);
      }
    }
  }
  return found;
}

/** Would "`succ` depends on `pred`" create a circular dependency? */
export function wouldCycle(tasks: readonly Task[], pred: number, succ: number): boolean {
  return pred === succ || dependents(tasks, succ).has(pred);
}
