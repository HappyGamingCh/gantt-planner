import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import type { Plan } from '../../src/engine/types';
import { SAMPLE_STATUS_DATE, sampleData } from '../../src/sample/sampleData';
import { matches, rowsOf } from '../../src/store/selectors';
import { CLOSED, NO_FILTERS, setFilters, toggleKpis, useStore } from '../../src/store/store';
import { formatPct, pctInt } from '../../src/ui/common/format';
import { trackHints } from '../../src/ui/kpi/hints';
import { isLateFilter, TrackCards, toggleLateFilter } from '../../src/ui/kpi/KpiStrip';
import { EmptyPlan } from '../../src/ui/main/EmptyPlan';
import { keyMessages } from '../../src/ui/report/reportData';
import { ActiveFilters, statusChipDetail, Toolbar } from '../../src/ui/toolbar/Toolbar';

// The sample (SPEC §13): status date Wed 30 Sep 2026.
const result = computePlan(sampleData);
const empty: Plan = { ...sampleData, tasks: [] };
const emptyResult = computePlan(empty);
const html = (result: Parameters<typeof TrackCards>[0]) => renderToStaticMarkup(createElement(TrackCards, result));

describe('percent — SPEC §7.2', () => {
  it('rounds half up, but shows 100% only when complete and 0% only when nothing is reported', () => {
    expect([pctInt(36.59), pctInt(40.5), pctInt(99.4), pctInt(99.5), pctInt(99.97), pctInt(100)]).toEqual([37, 41, 99, 99, 99, 100]);
    expect([pctInt(0), pctInt(0.3), pctInt(0.5), pctInt(1.4)]).toEqual([0, 1, 1, 1]);
    // 149 tasks done and one at 50 %: the mean is 99.67 — not "100%" next to "149/150 done".
    expect(formatPct((149 * 100 + 50) / 150)).toBe('99%');
    expect(formatPct(100)).toBe('100%');
  });
});

describe('KPI cards — SPEC §7.5', () => {
  it('tooltips explain the figures with the inputs, the state bands from config and SPI', () => {
    const hints = trackHints(result.summary);
    expect(hints.progress).toBe('Actual 36.59% vs planned 40.04% at the end of the status date. Every task counts equally; milestones are not counted.');
    expect(hints.schedule.split('\n')).toEqual([
      'Variance = actual − planned = 36.59 − 40.04 = −3.45, shown as −3.5 pts (percentage points).',
      'Ahead ≥ +2 pts · On track > −2 pts · Slightly behind > −5 pts · otherwise Behind.',
      'SPI (schedule performance index) = actual ÷ planned = 0.91; below 1 means behind plan.',
    ]);
    expect(hints.finish).toBe('Forecast finish 17 Oct 2026 vs planned finish 15 Oct 2026: 2 working days late.');
    expect(hints.tasks).toBe('7 completed · 3 in progress · 3 late · 9 not started (milestones are not counted).');
  });

  it('show the sample figures; "3 late" is plain text unless the main view makes it a filter button', () => {
    const report = html({ result });
    expect(report).toContain('37%');
    expect(report).toContain('Slightly behind');
    expect(report).toContain('<span class="kpi-state kpi-bad">3 late</span>');
    expect(report).not.toContain('<button');
    const main = html({ result, onShowLate: () => undefined, lateOn: true });
    // Pressed, it clears only the Status filter, so it doesn't promise "all tasks" (search and assignees stay).
    expect(main).toMatch(/<button type="button" class="kpi-state kpi-bad kpi-link" aria-pressed="true" title="Remove the Late filter">3 late<\/button>/);
    expect(html({ result, onShowLate: () => undefined })).toContain('aria-pressed="false" title="Show late tasks and milestones"');
  });

  it('a plan without tasks shows "—" and "No tasks yet", never "On track" or "on time"', () => {
    const out = html({ result: emptyResult });
    expect(out).toContain('No tasks yet');
    expect(out).toContain('0 tasks');
    expect(out).not.toContain('On track');
    expect(out).not.toContain('on time');
    expect(out).not.toContain('kpi-bar');
    expect(keyMessages(emptyResult, [], SAMPLE_STATUS_DATE, 14)).toEqual(['No tasks yet.']);
  });

  it('Tasks has a milestones caption and Time a working-days-left caption; neither without tasks (§7.5)', () => {
    const { milestones, durationDays, elapsedDays } = result.summary;
    expect(milestones).toEqual({ done: 1, total: 3 });
    expect([elapsedDays, durationDays]).toEqual([3, 17]);
    const out = html({ result });
    expect(out).toContain('<div class="kpi-caption">milestones 1/3</div>');
    expect(out).toContain('<div class="kpi-caption">14 working days left</div>');
    const none = html({ result: emptyResult });
    expect(none).not.toContain('kpi-caption">milestones');
    expect(none).not.toContain('working days left');
    expect(none).not.toContain('working day left');
  });

  it('the Time caption never goes below 0 and says "1 working day left" in the singular', () => {
    const at = (elapsedDays: number) => html({ result: { ...result, summary: { ...result.summary, elapsedDays, durationDays: 17 } } });
    expect(at(16)).toContain('<div class="kpi-caption">1 working day left</div>');
    expect(at(20)).toContain('<div class="kpi-caption">0 working days left</div>');
  });

  it('a plan with no milestones gets no Tasks caption', () => {
    const out = html({ result: { ...result, summary: { ...result.summary, milestones: { done: 0, total: 0 } } } });
    expect(out).not.toContain('kpi-caption">milestones');
    expect(out).toContain('working days left');
  });
});

describe('KPI strip state', () => {
  beforeEach(() => useStore.setState({ ...CLOSED, plan: sampleData, result, kpiCollapsed: false }));
  afterEach(() => vi.unstubAllGlobals());

  it('the chevron collapses the strip and the choice is saved with the preferences (§7.3, §7.13)', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    toggleKpis();
    expect(useStore.getState().kpiCollapsed).toBe(true);
    expect(JSON.parse(data.get('gantt-planner:prefs') ?? '{}')).toMatchObject({ kpiCollapsed: true });
    toggleKpis();
    expect(useStore.getState().kpiCollapsed).toBe(false);
  });

  it('"N late" toggles the Late status filter and keeps the search and assignees', () => {
    setFilters({ text: 'pump', assignees: ['acme'], statuses: ['Completed', 'Late'] });
    expect(isLateFilter(useStore.getState().filters)).toBe(false);
    toggleLateFilter();
    expect(useStore.getState().filters).toEqual({ ...NO_FILTERS, text: 'pump', assignees: ['acme'], statuses: ['Late'] });
    expect(isLateFilter(useStore.getState().filters)).toBe(true);
    toggleLateFilter();
    expect(useStore.getState().filters).toEqual({ ...NO_FILTERS, text: 'pump', assignees: ['acme'], statuses: [] });
  });
});

describe('filters — SPEC §7.6', () => {
  it('statuses are any-of: Late and Not started together show both', () => {
    const rows = rowsOf(sampleData, result);
    const shown = rows.filter((row) => matches(row, { ...NO_FILTERS, statuses: ['Late', 'Not Started'] }));
    const statuses = new Set(shown.map((row) => row.r.status));
    expect(statuses).toEqual(new Set(['Late', 'Not Started']));
    expect(shown.length).toBe(rows.filter((row) => row.r.status === 'Late' || row.r.status === 'Not Started').length);
  });
});

describe('toolbar and empty plan', () => {
  beforeEach(() => useStore.setState({ ...CLOSED, plan: sampleData, result }));

  it('Undo and Redo come first in the toolbar and are disabled with nothing to undo (§7.6)', () => {
    const out = renderToStaticMarkup(createElement(Toolbar, { plan: sampleData }));
    const buttons = out.match(/<button[^>]*>/g) ?? [];
    expect(buttons[0]).toMatch(/aria-label="Undo"/);
    // aria-disabled, not disabled: a disabled button would drop the keyboard focus after the last undo.
    expect(buttons[0]).toMatch(/aria-disabled="true"/);
    expect(buttons[0]).not.toMatch(/ disabled=""/);
    expect(buttons[0]).toMatch(/title="Undo \(Ctrl\+Z\)"/);
    expect(buttons[1]).toMatch(/aria-label="Redo"/);
    expect(buttons[1]).toMatch(/aria-disabled="true"/);
    expect(out).not.toContain('Late only');
  });

  it('Link, Unlink and Delete keep their names when a narrow Plan-mode window hides their labels', () => {
    const planMode: Plan = { ...sampleData, project: { ...sampleData.project, mode: 'Plan' } };
    const out = renderToStaticMarkup(createElement(Toolbar, { plan: planMode }));
    expect(out).toContain('class="toolbar toolbar-plan"');
    for (const name of ['Link', 'Unlink', 'Delete']) {
      expect(out).toMatch(new RegExp(`aria-label="${name}"[^>]*>(<svg.*?</svg>) <span class="toolbar-label">${name}</span>`));
    }
    expect(renderToStaticMarkup(createElement(Toolbar, { plan: sampleData }))).toContain('class="toolbar toolbar-track"');
  });

  it('the Late chip states its split, so "3 late" and the 4 rows it shows agree (§7.6)', () => {
    const rows = rowsOf(sampleData, result);
    const late = { ...NO_FILTERS, statuses: ['Late' as const] };
    expect(result.summary.counts.late).toBe(3);
    expect(rows.filter((row) => matches(row, late)).length).toBe(4);
    expect(statusChipDetail('Late', rows, late)).toBe('3 tasks, 1 milestone');
    // Counted over what every filter matches: the search narrows it; no milestone among them, no detail.
    expect(statusChipDetail('Late', rows, { ...late, text: '#25' })).toBe('1 milestone');
    expect(statusChipDetail('Late', rows, { ...late, text: '#24' })).toBeUndefined();
    expect(statusChipDetail('In Progress', rows, { ...NO_FILTERS, statuses: ['In Progress'] })).toBeUndefined();
    const out = renderToStaticMarkup(createElement(ActiveFilters, { plan: sampleData, result, filters: late }));
    expect(out).toContain('<span class="filter-chip">Late<span class="filter-chip-detail">· 3 tasks, 1 milestone</span>');
    expect(out).toContain('aria-label="Remove filter Late"');
    expect(renderToStaticMarkup(createElement(ActiveFilters, { plan: sampleData, result, filters: NO_FILTERS }))).toBe('');
  });

  it('with no tasks the grid offers Add task in Plan mode and the switch to Plan mode in Track mode', () => {
    const plan = renderToStaticMarkup(createElement(EmptyPlan, { mode: 'Plan' }));
    expect(plan).toContain('No tasks yet');
    expect(plan).toContain('Add task');
    expect(plan).toContain('Ctrl+Enter');
    const track = renderToStaticMarkup(createElement(EmptyPlan, { mode: 'Track' }));
    expect(track).toContain('Switch to Plan mode');
    expect(track).not.toContain('Add task');
  });
});
