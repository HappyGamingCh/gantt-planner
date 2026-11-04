import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import type { Change, Task } from '../../src/engine/types';
import { problems, type Problems } from '../../src/store/selectors';
import { CLOSED, useStore, type State } from '../../src/store/store';
import { undo } from '../../src/store/undo';
import { ProblemsBadge } from '../../src/ui/issues/IssuesBadge';
import { IssuesSheet } from '../../src/ui/issues/IssuesPanel';
import { afterFixTarget, applyQuickFix, fixDone, keysOf, onTabKey } from '../../src/ui/issues/logic';
import { fixture, read } from '../excel/helpers';

// Issues panel and badge (SPEC §7.4, §7.11, §10) on tests/fixtures/messy.xlsx: markup, quick fixes, focus, tab keys.
let found: Problems;
let tasks: Task[];
let changes: Change[];

beforeAll(async () => {
  const r = read(await fixture('messy.xlsx'));
  useStore.setState({ ...CLOSED, plan: r.plan, result: computePlan(r.plan), readIssues: r.issues });
  found = problems(useStore.getState());
  [tasks, changes] = [r.plan.tasks, r.changes];
});

/** The sheet's markup; React warns that its layout effect (focus after a quick fix) does nothing on the server. */
function sheet(tab: State['issuesTab']): string {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    return renderToStaticMarkup(createElement(IssuesSheet, { tab, found, changes, tasks }));
  } finally {
    quiet.mockRestore();
  }
}

describe('Issues panel — SPEC §7.4, §7.11', () => {
  it('the Problems tab count is the badge number: errors and warnings', () => {
    const errors = found.list.filter((i) => i.severity === 'error').length;
    expect(sheet('problems')).toContain(`Problems <span class="tab-count">${found.list.length}</span>`);
    const badge = renderToStaticMarkup(createElement(ProblemsBadge, { list: found.list }));
    expect(badge).toContain(`>! ${found.list.length}</button>`);
    expect(badge).toContain(`aria-label="${errors} errors, ${found.list.length - errors} warnings — show issues"`);
    expect(renderToStaticMarkup(createElement(ProblemsBadge, { list: [] }))).toBe('');
  });

  it('errors, then warnings, under headings; an icon and the task ID and name under each message; notes closed', () => {
    const html = sheet('problems');
    expect(html).toMatch(/<h3 class="problem-heading" id="problems-errors">Errors <span aria-hidden="true">·<\/span> \d+<\/h3>/);
    expect(html.indexOf('id="problems-errors"')).toBeLessThan(html.indexOf('id="problems-warnings"'));
    const name = tasks.find((t) => t.id === 27)!.name;
    expect(html).toContain(`Task 27: predecessor 8 does not exist</span><span class="problem-task" title="${name}">#27 · ${name}</span>`);
    expect(html).toContain('problem-icon-error');
    expect(html).toContain('problem-icon-warning');
    expect(html).toMatch(/<details class="problem-group problem-notes"><summary class="problem-heading">Notes/);
  });

  it('tabs: one tab stop; the selected tab labels the panel it controls', () => {
    let html = sheet('problems');
    expect(html).toContain('role="tablist" aria-label="Issues"');
    expect(html).toContain('id="issues-tab-problems" aria-selected="true" aria-controls="issues-tabpanel" tabindex="0"');
    expect(html).toContain('id="issues-tab-changes" aria-selected="false" aria-controls="issues-tabpanel" tabindex="-1"');
    expect(html).toContain('role="tabpanel" id="issues-tabpanel" aria-labelledby="issues-tab-problems"');
    html = sheet('changes');
    expect(html).toContain('role="tabpanel" id="issues-tabpanel" aria-labelledby="issues-tab-changes"');
  });

  it('a Changes row shows its task only while a task has that ID', () => {
    const gone: Change = { taskId: 999, field: 'Status', from: undefined, to: 'Late', kind: 'filled', reason: 'Calculated' };
    const kept: Change = { taskId: 27, field: 'Status', from: undefined, to: 'Late', kind: 'filled', reason: 'Calculated' };
    const html = renderToStaticMarkup(createElement(IssuesSheet, { tab: 'changes', found, changes: [kept, gone], tasks }));
    expect(html).toContain(`title="${tasks.find((t) => t.id === 27)!.name}">#27</button>`);
    expect(html).toContain('<span>#999</span>');
  });
});

describe('Problems tab — quick fixes and focus (§5.11, §10)', () => {
  const missing = () => problems(useStore.getState()).list.find((i) => i.code === 'E_MISSING_PRED' && i.taskId === 27)!;

  it('a quick fix is one undo step and says what it did in a toast with Undo', () => {
    const fix = missing().fix!;
    expect(fixDone(fix)).toBe('Task 27: predecessor 8 removed');
    const before = useStore.getState().plan;
    expect(applyQuickFix(fix)).toBe(true);
    expect(useStore.getState().plan).not.toBe(before);
    expect(missing()).toBeUndefined();
    const toast = useStore.getState().toast!;
    expect(toast).toMatchObject({ message: 'Task 27: predecessor 8 removed', action: { label: 'Undo' } });
    toast.action!.run();
    expect(useStore.getState().plan).toBe(before);
    expect(missing()).toBeDefined();
    // A fix that changes nothing (the link is already gone) neither toasts nor moves the focus.
    expect(applyQuickFix(fix)).toBe(true);
    useStore.setState({ toast: null });
    expect(applyQuickFix(fix)).toBe(false);
    expect(useStore.getState().toast).toBeNull();
    undo();
  });

  it('keys stay with their issue when the ones before it go, and are unique', () => {
    const list = found.list;
    const keys = keysOf(list);
    expect(new Set(keys).size).toBe(list.length);
    expect(keysOf(list.slice(1))).toEqual(keys.slice(1));
    const twice = [list[0]!, list[0]!];
    expect(keysOf(twice)).toEqual([keys[0], `${keys[0]}#2`]);
  });

  it('after a fix the focus goes to the row now in its place, else the last, else the empty message', () => {
    const el = (name: string, inner: Record<string, unknown> = {}) => ({ name, querySelector: (s: string) => inner[s] ?? null });
    const rows = [el('row 0', { 'button.problem-text': el('button 0') }), el('row 1')];
    const empty = el('empty');
    const root = (list: unknown[]) =>
      ({ querySelectorAll: () => list, querySelector: (s: string) => (s === '.sheet-empty' ? empty : null) }) as unknown as ParentNode;
    expect(afterFixTarget(root(rows), 0)).toMatchObject({ name: 'button 0' });
    expect(afterFixTarget(root(rows), 1)).toMatchObject({ name: 'row 1' }); // a row without a task: the row itself
    expect(afterFixTarget(root(rows), 5)).toMatchObject({ name: 'row 1' }); // the last one was fixed
    expect(afterFixTarget(root([]), 0)).toMatchObject({ name: 'empty' });
  });

  it('tabs: ←/→ move to the other tab (wrapping), Home/End to the first/last, and take the focus', () => {
    const focused: string[] = [];
    vi.stubGlobal('document', { getElementById: (id: string) => ({ focus: () => focused.push(id) }) });
    try {
      const key = (k: string, tab: State['issuesTab']) => {
        const e = { key: k, preventDefault: vi.fn() };
        onTabKey(e, tab);
        return e.preventDefault.mock.calls.length > 0;
      };
      expect(key('ArrowRight', 'problems')).toBe(true);
      expect(useStore.getState().issuesTab).toBe('changes');
      expect(key('ArrowRight', 'changes')).toBe(true);
      expect(useStore.getState().issuesTab).toBe('problems');
      expect(key('ArrowLeft', 'problems')).toBe(true);
      expect(useStore.getState().issuesTab).toBe('changes');
      expect(key('Home', 'changes')).toBe(true);
      expect(useStore.getState().issuesTab).toBe('problems');
      expect(key('End', 'problems')).toBe(true);
      expect(useStore.getState().issuesTab).toBe('changes');
      expect(focused).toEqual(['issues-tab-changes', 'issues-tab-problems', 'issues-tab-changes', 'issues-tab-problems', 'issues-tab-changes']);
      expect(key('ArrowDown', 'changes')).toBe(false);
      expect(key('Enter', 'changes')).toBe(false);
      expect(focused).toHaveLength(5);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
