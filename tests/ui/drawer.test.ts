import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_DAYS } from '../../src/config';
import { computePlan } from '../../src/engine/compute';
import { PLAN_DATE_MAX, PLAN_DATE_MIN } from '../../src/engine/dates';
import { sampleData } from '../../src/sample/sampleData';
import { DATE_RANGE_MESSAGE } from '../../src/store/edit';
import { CLOSED, openDrawer, revealTask, select, useStore } from '../../src/store/store';
import { DateField, DaysField, ProgressField } from '../../src/ui/drawer/fields';
import { PredecessorEditor } from '../../src/ui/drawer/PredecessorEditor';
import { StepButtons } from '../../src/ui/drawer/TaskDrawer';
import { dateProblem, drawerChips, durationProblem, leaveField, neighbours, parseLag, pickerMatches, pickerStart, pickerStep, settledText } from '../../src/ui/drawer/logic';
import { makeTask } from '../engine/helpers';

const state = () => useStore.getState();
const noop = () => {};

describe('drawer follows the selection — SPEC §7.9', () => {
  beforeEach(() => useStore.setState({ ...CLOSED, plan: sampleData, result: computePlan(sampleData) }));

  it('a plain click (grid, ↑/↓, Gantt) moves the open drawer to the task', () => {
    openDrawer(11);
    select(12);
    expect(state()).toMatchObject({ drawerId: 12, selection: [12] });
    revealTask(13); // successors, previous / next
    expect(state()).toMatchObject({ drawerId: 13, selection: [13] });
  });

  it('Ctrl and Shift build a multi-selection without moving the drawer', () => {
    openDrawer(11);
    select(12, 'toggle');
    expect(state()).toMatchObject({ drawerId: 11, selection: [11, 12] });
    select(14, 'range', [11, 12, 13, 14]); // from the anchor, the last Ctrl+click
    expect(state()).toMatchObject({ drawerId: 11, selection: [12, 13, 14] });
  });

  it('a closed drawer stays closed', () => {
    select(12);
    revealTask(13);
    expect(state().drawerId).toBeNull();
  });
});

describe('drawer fields — leaving a field', () => {
  it('saves a changed draft, says why a refused one is not saved, and does nothing for an unchanged one', () => {
    expect(leaveField('5', '3', null)).toEqual({ save: '5' });
    expect(leaveField('3', '3', null)).toEqual({});
    expect(leaveField('', '3', "Duration can't be empty — 0 makes a milestone")).toEqual({ message: "Duration can't be empty — 0 makes a milestone" });
  });

  it('dates: a half-typed date is never saved; out-of-range years are refused; a blank clears unless required', () => {
    expect(dateProblem('', true)).toBe('Incomplete date — not saved'); // Chrome reports '' while a segment is empty
    expect(dateProblem('0026-10-05', false)).toBe(DATE_RANGE_MESSAGE); // a 2-digit year
    expect(dateProblem('2200-01-01', false)).toBe(DATE_RANGE_MESSAGE);
    expect(dateProblem('2026-10-05', false)).toBeNull();
    expect(dateProblem('', false)).toBeNull(); // Actual Start, Planned Start: blank clears
    expect(dateProblem('', false, 'Finish needed')).toBe('Finish needed');
  });

  it('a date half-typed into an empty input (no draft: the browser sent no change) still says why it is not saved', () => {
    expect(settledText(null, true)).toBe('');
    const text = settledText(null, true)!;
    expect(leaveField(text, '', dateProblem(text, true))).toEqual({ message: 'Incomplete date — not saved' });
    expect(settledText(null, false)).toBeNull(); // focused and left untouched: nothing to settle
    expect(settledText('2026-10-05', false)).toBe('2026-10-05');
    expect(settledText('', true)).toBe(''); // a stored date with one segment cleared
  });

  it(`duration: whole days 0–${MAX_DAYS}; a blank is refused, not read as 0 (a milestone)`, () => {
    expect(durationProblem('')).toBe("Duration can't be empty — 0 makes a milestone");
    expect(durationProblem('0')).toBeNull();
    expect(durationProblem(String(MAX_DAYS))).toBeNull();
    expect(durationProblem(String(MAX_DAYS + 1))).toBe(`Duration must be 0–${MAX_DAYS} days`);
    expect(durationProblem('  ')).toBe("Duration can't be empty — 0 makes a milestone");
  });

  it('duration keeps the decimal point (#93): 1.5 is rounded to 2, never read as 15; text and negatives are refused', () => {
    expect(durationProblem('1.5')).toBeNull(); // saved as 2 days, with a toast (parseDuration's note)
    expect(durationProblem('0,5')).toBeNull();
    expect(durationProblem('-1')).toBe("Duration can't be negative");
    expect(durationProblem('5d')).toBe('Enter whole working days, e.g. 5');
    expect(durationProblem('1.5.2')).toBe('Enter whole working days, e.g. 5');
  });

  it(`lag: whole working days within ±${MAX_DAYS}; blank = 0`, () => {
    expect(parseLag('3')).toEqual({ lag: 3 });
    expect(parseLag('-2')).toEqual({ lag: -2 });
    expect(parseLag('')).toEqual({ lag: 0 });
    const zero = parseLag('-0');
    expect('lag' in zero && Object.is(zero.lag, 0)).toBe(true); // never written as "-0"
    expect(parseLag(String(-MAX_DAYS))).toEqual({ lag: -MAX_DAYS });
    expect(parseLag(String(MAX_DAYS + 1))).toEqual({ message: `Lag must be between −${MAX_DAYS} and ${MAX_DAYS} working days` });
    expect(parseLag('1-')).toEqual({ message: 'Lag must be a whole number of working days' });
    expect(parseLag('-')).toEqual({ message: 'Lag must be a whole number of working days' });
  });
});

describe('drawer fields — rendering', () => {
  const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

  it('date inputs accept the plan dates (1950–2199) and mark an empty date', () => {
    const empty = html(createElement(DateField, { label: 'Finish', onSave: noop }));
    expect(empty).toContain(`min="${PLAN_DATE_MIN}"`);
    expect(empty).toContain(`max="${PLAN_DATE_MAX}"`);
    expect(empty).toContain('data-empty=""');
    expect(html(createElement(DateField, { label: 'Start', value: '2026-09-30', onSave: noop }))).not.toContain('data-empty');
  });

  it('read-only values sit in a static box with the reason as tooltip; a linked start shows the link icon', () => {
    const linked = html(createElement(DateField, { label: 'Start', value: '2026-10-03', onSave: noop, readOnly: true, hint: 'Set by predecessors — add lag to delay.', linked: true }));
    expect(linked).toContain('class="drawer-static"');
    expect(linked).toContain('03 Oct 26');
    expect(linked).toContain('<svg');
    expect(linked).toContain('title="Set by predecessors — add lag to delay."');
    const days = html(createElement(DaysField, { label: 'Duration', value: 5, onSave: noop, readOnly: true, hint: 'Switch to Plan mode to change the baseline.' }));
    expect(days).toContain('<span class="drawer-static">5d</span>');
    expect(days).toContain('title="Switch to Plan mode to change the baseline."');
  });

  it('lag boxes show each link’s own lag from the plan (#24: 23SS+1, 7)', () => {
    const task = sampleData.tasks.find((t) => t.id === 24)!;
    const editor = html(createElement(PredecessorEditor, { task, tasks: sampleData.tasks, editable: true }));
    expect([...editor.matchAll(/class="lag-input"[^>]*value="(-?\d+)"/g)].map((m) => m[1])).toEqual(['1', '0']);
    expect(editor).toContain('Add predecessor'); // the picker starts closed
  });

  it('progress shows the plan value and no hint until the slider is moved', () => {
    const progress = html(createElement(ProgressField, { value: 40, onSave: noop }));
    expect(progress).toContain('value="40"');
    expect(progress).toContain('40%');
    expect(progress).not.toContain('Enter saves');
  });
});

describe('predecessor picker — SPEC §7.9', () => {
  const tasks = [makeTask(3, { name: 'Box up' }), makeTask(5, { name: 'TE-131, AT-132' }), makeTask(12, { name: 'Pump' }), makeTask(31, { name: 'Valve' }), makeTask(120, { name: 'Close' })];
  const ids = (query: string, self = 99) => pickerMatches(tasks, self, query).map((t) => t.id);

  it('"#12" and "12" find #12 first; an exact ID ranks before IDs that start with it and before names', () => {
    expect(ids('#12')).toEqual([12, 120]);
    expect(ids('12')).toEqual([12, 120]);
    expect(ids('31')).toEqual([31, 5]); // #5's name holds "131…"
    expect(ids('box')).toEqual([3]);
  });

  it('never offers the task itself; an empty query lists the others in row order', () => {
    expect(ids('', 12)).toEqual([3, 5, 31, 120]);
    expect(ids('12', 12)).toEqual([120]);
  });

  it('Enter picks the highlighted row: an exact ID even when it cannot be linked, else the first row that can', () => {
    expect(pickerStart([31, 5], [false, true], '31')).toBe(0); // #31 already linked: Enter must not pick #5
    expect(pickerStart([12, 120], [true, true], '#12')).toBe(0);
    expect(pickerStart([3, 5, 31], [false, true, true], 'o')).toBe(1);
    expect(pickerStart([3], [false], 'box')).toBe(-1);
  });

  it('nothing is highlighted before a query is typed, so Enter right after opening links nothing; ↓ goes to the first row', () => {
    expect(pickerStart([3, 5, 31], [true, true, true], '')).toBe(-1);
    expect(pickerStart([3, 5, 31], [true, true, true], ' # ')).toBe(-1);
    expect(pickerStep([false, true, true], -1, 1)).toBe(1);
    expect(pickerStep([true, true], -1, -1)).toBe(-1); // ↑ with nothing highlighted stays put
  });

  it('↑/↓ skip rows that cannot be picked and stop at the ends', () => {
    const enabled = [true, false, true, false];
    expect(pickerStep(enabled, 0, 1)).toBe(2);
    expect(pickerStep(enabled, 2, 1)).toBe(2);
    expect(pickerStep(enabled, 2, -1)).toBe(0);
    expect(pickerStep(enabled, -1, 1)).toBe(0);
  });
});

describe('drawer header', () => {
  it('chips: the work state, then how late — never "Late" twice (§7.9 mock-up)', () => {
    expect(drawerChips({ status: 'Late', variance: 2, actualStart: '2026-09-30', progress: 40 })).toEqual([
      { label: 'In progress', slug: 'progress' },
      { label: 'Late +2d', slug: 'late' },
    ]);
    expect(drawerChips({ status: 'Late', variance: 3, progress: 0 })).toEqual([
      { label: 'Not started', slug: 'idle' },
      { label: 'Late +3d', slug: 'late' },
    ]);
  });

  it('chips: a finished task shows its variance as a neutral note; on time or not late shows one chip', () => {
    expect(drawerChips({ status: 'Completed', variance: 2, actualStart: '2026-09-28', progress: 100 })).toEqual([
      { label: 'Completed', slug: 'completed' },
      { label: 'Finished 2d late', slug: 'idle' },
    ]);
    expect(drawerChips({ status: 'Completed', variance: -1, actualStart: '2026-09-28', progress: 100 })[1]).toEqual({ label: 'Finished 1d early', slug: 'idle' });
    expect(drawerChips({ status: 'Completed', variance: 0, actualStart: '2026-09-28', progress: 100 })).toHaveLength(1);
    expect(drawerChips({ status: 'In Progress', variance: -1, actualStart: '2026-09-28', progress: 50 })).toEqual([{ label: 'In progress', slug: 'progress' }]);
  });

  it('chips of the sample: every late task gets exactly one "Late" chip', () => {
    for (const r of computePlan(sampleData).tasks.filter((t) => t.status === 'Late')) {
      expect(drawerChips(r).filter((c) => c.label.startsWith('Late'))).toHaveLength(1);
    }
  });

  it('previous / next step through the shown rows in plan order, even after the task left a filter', () => {
    const tasks = [1, 2, 3, 4, 5].map((id) => makeTask(id));
    expect(neighbours(tasks, [1, 2, 3, 4, 5], 3)).toEqual({ prev: 2, next: 4 });
    expect(neighbours(tasks, [1, 2, 3, 4, 5], 1)).toEqual({ prev: undefined, next: 2 });
    expect(neighbours(tasks, [2, 4], 3)).toEqual({ prev: 2, next: 4 }); // "Late only": 3 was just updated and dropped out
    expect(neighbours(tasks, [2, 4], 5)).toEqual({ prev: 4, next: undefined });
  });

  it('at the last row Next stays focusable (aria-disabled, not disabled), so the keyboard focus is not dropped', () => {
    const nav = renderToStaticMarkup(createElement(StepButtons, { prev: 24, go: noop }));
    const button = (label: string) => nav.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';
    expect(button('Next task')).toContain('aria-disabled="true"');
    expect(button('Previous task')).toContain('aria-disabled="false"');
    expect(nav).not.toMatch(/\sdisabled=/);
  });
});
