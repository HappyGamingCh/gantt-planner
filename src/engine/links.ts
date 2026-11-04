// Predecessor notation and the task graph (SPEC §5.2, §5.3 step 3, step 8).
import { MAX_DAYS } from '../config';
import { makeIssue } from './issues';
import type { Change, Issue, Link, LinkType, Task } from './types';

export interface ParsedToken {
  raw: string;
  link?: Link;
  error?: 'bad' | 'unsupported';
}

const TOKEN_RE = /^(\d+)(FS|SS|FF|SF)?(?:([+-])(\d+)D?)?$/;

/**
 * Splits on `,`, `;` and line breaks, ignores whitespace inside an item and empty items, and parses each token.
 * Whitespace between two numbers (`3 4`) is invalid rather than read as `34`, and so is a lag beyond MAX_DAYS.
 */
export function parsePredecessors(text: string): ParsedToken[] {
  const tokens: ParsedToken[] = [];
  for (const part of text.split(/[,;\r\n]/)) {
    const raw = part.trim();
    if (raw === '') continue;
    const m = /\d\s+\d/.test(raw) ? null : TOKEN_RE.exec(raw.replace(/\s+/g, '').toUpperCase());
    const lag = m?.[4] === undefined ? 0 : Number(m[4]) * (m[3] === '-' ? -1 : 1);
    if (!m || Math.abs(lag) > MAX_DAYS) {
      tokens.push({ raw, error: 'bad' });
    } else if (m[2] === 'FF' || m[2] === 'SF') {
      tokens.push({ raw, error: 'unsupported' });
    } else {
      tokens.push({ raw, link: { predId: Number(m[1]), type: (m[2] ?? 'FS') as LinkType, lag: lag || 0 } });
    }
  }
  return tokens;
}

/** Canonical form: `3` · `3FS+2` · `5SS` · `5SS-1`. */
export function formatLink(link: Link): string {
  const lag = link.lag === 0 ? '' : `${link.lag > 0 ? '+' : '-'}${Math.abs(link.lag)}`;
  if (link.type === 'FS') return lag === '' ? String(link.predId) : `${link.predId}FS${lag}`;
  return `${link.predId}SS${lag}`;
}

export function formatLinks(links: readonly Link[]): string {
  return links.map(formatLink).join(', ');
}

export interface Graph {
  /** Valid links per task, in the user's order (cycle links included). */
  links: Map<number, Link[]>;
  /** Links used for calculation: valid and not inside a cycle. */
  calcLinks: Map<number, Link[]>;
  /** Tasks in topological order of calcLinks; ties keep row order. */
  order: Task[];
  /** Predecessors text to write back: canonical, or unchanged if any token has an issue. */
  predecessorsText: Map<number, string>;
  successorsText: Map<number, string>;
}

/** `summaries`: major tasks (§5.12), left out of `tasks`; naming one as a predecessor is E_SUMMARY_LINK. */
export function buildGraph(tasks: readonly Task[], issues: Issue[], changes: Change[], summaries: ReadonlySet<number> = new Set()): Graph {
  const ids = new Set(tasks.map((t) => t.id));
  const links = new Map<number, Link[]>();
  const predecessorsText = new Map<number, string>();

  for (const task of tasks) {
    const valid: Link[] = [];
    let hasIssue = false;
    for (const token of parsePredecessors(task.predecessorsText)) {
      const link = token.link;
      if (!link) {
        hasIssue = true;
        issues.push(
          token.error === 'unsupported'
            ? makeIssue('E_UNSUPPORTED_LINK', { id: task.id })
            : makeIssue('E_BAD_LINK', { id: task.id, token: token.raw }),
        );
      } else if (link.predId === task.id) {
        hasIssue = true;
        issues.push(makeIssue('E_SELF_LINK', { id: task.id }, { kind: 'removeLink', taskId: task.id, predId: link.predId }));
      } else if (!ids.has(link.predId)) {
        hasIssue = true;
        const code = summaries.has(link.predId) ? 'E_SUMMARY_LINK' : 'E_MISSING_PRED';
        issues.push(makeIssue(code, { id: task.id, pid: link.predId }, { kind: 'removeLink', taskId: task.id, predId: link.predId }));
      } else if (valid.some((l) => l.predId === link.predId)) {
        hasIssue = true;
        issues.push(makeIssue('W_DUP_LINK', { id: task.id, pid: link.predId }));
      } else {
        valid.push(link);
      }
    }
    links.set(task.id, valid);
    const text = hasIssue ? task.predecessorsText : formatLinks(valid);
    predecessorsText.set(task.id, text);
    if (text !== task.predecessorsText) {
      changes.push({
        taskId: task.id,
        field: 'Predecessors',
        from: task.predecessorsText,
        to: text,
        kind: 'corrected',
        reason: 'Rewritten in standard notation',
      });
    }
  }

  const cycleOf = findCycles(tasks, links);
  for (const members of new Set(cycleOf.values())) {
    const issue = makeIssue('E_CYCLE', { ids: members.join(', ') });
    issue.taskId = members[0];
    issues.push(issue);
  }
  const calcLinks = new Map<number, Link[]>();
  for (const task of tasks) {
    const cycle = cycleOf.get(task.id);
    calcLinks.set(task.id, (links.get(task.id) ?? []).filter((l) => !cycle || cycleOf.get(l.predId) !== cycle));
  }

  return {
    links,
    calcLinks,
    order: topologicalOrder(tasks, calcLinks),
    predecessorsText,
    successorsText: successors(tasks, links),
  };
}

/** Tarjan's SCC. Maps each task in a cycle to its cycle's member IDs (row order); other tasks are absent. */
function findCycles(tasks: readonly Task[], links: Map<number, Link[]>): Map<number, number[]> {
  const rowOf = new Map(tasks.map((t, i) => [t.id, i]));
  const succ = new Map<number, number[]>(tasks.map((t) => [t.id, []]));
  for (const t of tasks) for (const l of links.get(t.id) ?? []) succ.get(l.predId)?.push(t.id);

  const index = new Map<number, number>();
  const low = new Map<number, number>();
  const stack: number[] = [];
  const onStack = new Set<number>();
  const result = new Map<number, number[]>();
  let next = 0;

  const visit = (v: number) => {
    index.set(v, next);
    low.set(v, next);
    next++;
    stack.push(v);
    onStack.add(v);
    for (const w of succ.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const members: number[] = [];
      let w: number;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        members.push(w);
      } while (w !== v);
      if (members.length > 1) {
        members.sort((a, b) => rowOf.get(a)! - rowOf.get(b)!);
        for (const m of members) result.set(m, members);
      }
    }
  };
  for (const t of tasks) if (!index.has(t.id)) visit(t.id);
  return result;
}

/** Kahn's algorithm; among ready tasks the earliest row goes first. */
function topologicalOrder(tasks: readonly Task[], calcLinks: Map<number, Link[]>): Task[] {
  const remaining = new Map(tasks.map((t) => [t.id, (calcLinks.get(t.id) ?? []).length]));
  const succ = new Map<number, number[]>(tasks.map((t) => [t.id, []]));
  for (const t of tasks) for (const l of calcLinks.get(t.id) ?? []) succ.get(l.predId)?.push(t.id);

  const order: Task[] = [];
  const done = new Set<number>();
  while (order.length < tasks.length) {
    const next = tasks.find((t) => !done.has(t.id) && remaining.get(t.id) === 0);
    if (!next) break; // unreachable: calcLinks has no cycles
    order.push(next);
    done.add(next.id);
    for (const s of succ.get(next.id) ?? []) remaining.set(s, remaining.get(s)! - 1);
  }
  return order;
}

/** For task T: every task S linking to T, formatted from S's link, in S's row order. */
function successors(tasks: readonly Task[], links: Map<number, Link[]>): Map<number, string> {
  const lists = new Map<number, Link[]>(tasks.map((t) => [t.id, []]));
  for (const s of tasks) {
    for (const l of links.get(s.id) ?? []) lists.get(l.predId)?.push({ predId: s.id, type: l.type, lag: l.lag });
  }
  return new Map([...lists].map(([id, list]) => [id, formatLinks(list)]));
}
