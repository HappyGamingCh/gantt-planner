import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import { sampleData } from '../../src/sample/sampleData';
import { rowsOf } from '../../src/store/selectors';
import { arrowHead, LINK_GAP } from '../../src/ui/gantt/arrows';
import { handleSpan, LABEL_DX, Links, MarkLabel, PlanMark, span, TrackMark } from '../../src/ui/gantt/bars';
import { linkFocus } from '../../src/ui/gantt/Gantt';
import { fillScale, makeScale } from '../../src/ui/gantt/scale';

// The sample (SPEC §13): status date Wed 30 Sep 2026; #7 is late, #24 follows it (7FS) and #7 follows #5 (5FS).
const rows = rowsOf(sampleData, computePlan(sampleData));
const row = (id: number) => rows.find((r) => r.task.id === id)!;
const scale = makeScale('2026-09-25', '2026-10-22', 'day', 1000);
const ROW_H = 36;
const linksMarkup = (mode: 'Plan' | 'Track', focus: number | null) => renderToStaticMarkup(createElement(Links, { rows, mode, rowHeight: ROW_H, scale, focus, critical: false }));
const count = (html: string, part: string) => html.split(part).length - 1;

describe('dependency arrows by mode — SPEC §6, §7.8', () => {
  it('Plan mode draws every arrow; the focused task’s are highlighted and the rest dimmed', () => {
    const all = rows.reduce((n, r) => n + r.r.links.length, 0);
    expect(count(linksMarkup('Plan', null), 'class="link"')).toBe(all);
    const focused = linksMarkup('Plan', 7);
    expect(count(focused, 'class="link link-on"')).toBe(2); // 5 → 7 and 7 → 24
    expect(count(focused, 'class="link link-dim"')).toBe(all - 2);
  });

  it('Track mode draws no arrows until a task is hovered or selected', () => {
    expect(linksMarkup('Track', null)).toBe('');
  });

  it('Track mode draws only the focused task’s arrows, highlighted, between the forecast/actual bars', () => {
    const html = linksMarkup('Track', 7);
    expect(count(html, '<g class="link ')).toBe(2);
    expect(count(html, 'class="link link-on"')).toBe(2);
    expect(html).not.toContain('link-dim');
    // 7 → 24 ends at #24's forecast start (16 Oct, not its planned 14 Oct), level with the 14 px Track bar.
    const to = { x: span(row(24).r, 'Track', scale).x0, y: 23.5 * ROW_H - 4 };
    expect(to.x).toBe(scale.x('2026-10-16'));
    expect(html).toContain(`d="${arrowHead(to)}"`);
  });

  it('the critical path still colours arrows between two critical tasks in Track mode', () => {
    const critical = rows.map((r) => ({ ...r, r: { ...r.r, critical: r.task.id === 7 || r.task.id === 24 } }));
    const html = renderToStaticMarkup(createElement(Links, { rows: critical, mode: 'Track', rowHeight: ROW_H, scale, focus: 24, critical: true }));
    expect(count(html, 'link-critical')).toBe(1); // 7 → 24, not 23 → 24
  });
});

describe('arrow focus after the hovered task goes — SPEC §7.8', () => {
  const without14 = rows.filter((r) => r.task.id !== 14);

  it('a hovered task that is still shown has the focus, ahead of the selection', () => {
    expect(linkFocus(7, rows, [3])).toBe(7);
    expect(linkFocus(null, rows, [3, 5])).toBe(5);
  });

  it('a hovered task that was deleted or filtered out no longer dims every arrow', () => {
    expect(linkFocus(14, without14, [])).toBeNull();
    expect(linkFocus(14, without14, [3])).toBe(3);
  });
});

describe('bar labels clear of the arrows — SPEC §7.8', () => {
  it('labels start past the FS elbow, so its vertical never crosses their first letter', () => {
    expect(LABEL_DX).toBeGreaterThanOrEqual(LINK_GAP + 4);
    const x1 = span(row(7).r, 'Plan', scale).x1;
    const html = renderToStaticMarkup(createElement('svg', null, createElement(MarkLabel, { row: row(7), mode: 'Plan', top: 0, rowHeight: ROW_H, scale, dx: LABEL_DX })));
    expect(html).toContain(`x="${x1 + LABEL_DX}"`);
  });

  it('a chart without arrows (the report appendix) keeps its labels close', () => {
    const x1 = span(row(7).r, 'Track', scale).x1;
    const html = renderToStaticMarkup(createElement('svg', null, createElement(MarkLabel, { row: row(7), mode: 'Track', top: 0, rowHeight: ROW_H, scale })));
    expect(html).toContain(`x="${x1 + 6}"`);
  });
});

describe('resize handle on short bars — SPEC §7.8 drag', () => {
  const inside = (x: number, h: { x: number; width: number }) => x >= h.x && x <= h.x + h.width;

  it('a bar under 16 px wide keeps its whole body as a move target: the handle sits just past its end', () => {
    // Month zoom (4 px/day) and a small Fit (≈ 6.3 px/day): 1- and 2-day bars.
    for (const width of [4, 6.3, 8, 12.6]) {
      const x0 = 100;
      const h = handleSpan(x0 + width, width);
      expect(h).toEqual({ x: x0 + width, width: 6 });
      expect(inside(x0 + width / 2, h)).toBe(false); // the bar's centre moves the task
    }
  });

  it('a wider bar keeps the 8 px handle centred on its end', () => {
    expect(handleSpan(200, 16)).toEqual({ x: 196, width: 8 });
    expect(handleSpan(200, 64)).toEqual({ x: 196, width: 8 });
  });

  it('the 1-day root task at Month zoom: its bar is drawn under the press, the handle after it', () => {
    const month = makeScale('2026-09-25', '2026-10-22', 'month', 1000);
    const html = renderToStaticMarkup(createElement('svg', null, createElement(PlanMark, { row: row(14), top: 0, rowHeight: ROW_H, scale: month, critical: false, onDragStart: () => {} })));
    const { x0, x1 } = span(row(14).r, 'Plan', month);
    expect(x1 - x0).toBe(4);
    expect(html).toContain(`class="bar-handle" x="${x1}" y="8" width="6"`);
  });
});

describe('critical ring 2 px clear of the mark — SPEC §7.8', () => {
  const mark = (type: typeof PlanMark, id: number) => renderToStaticMarkup(createElement('svg', null, createElement(type, { row: row(id), top: 0, rowHeight: ROW_H, scale, critical: true })));

  it('Plan bar: the 2 px ring’s centre line runs 3 px outside the 16 px bar, corners following its radius', () => {
    const { x0, x1 } = span(row(7).r, 'Plan', scale);
    expect(mark(PlanMark, 7)).toContain(`<rect class="crit-ring" x="${x0 - 3}" y="7" width="${x1 - x0 + 6}" height="22" rx="7">`);
  });

  it('Track bar: the same ring around the 14 px bar, whose outlined and done parts share 4 px corners', () => {
    const { x0, x1 } = span(row(7).r, 'Track', scale);
    const html = mark(TrackMark, 7);
    expect(html).toContain(`<rect class="crit-ring" x="${x0 - 3}" y="4" width="${x1 - x0 + 6}" height="20" rx="7">`);
    expect(html).toMatch(/class="bar-rest st-late"[^>]* rx="3.5"/);
    expect(html).toMatch(/class="bar-done st-late"[^>]* rx="4"/);
  });

  it('milestone: the ring diamond is 4.5 px further out than the 12 px diamond', () => {
    const cx = (span(row(1).r, 'Plan', scale).x0 + span(row(1).r, 'Plan', scale).x1) / 2;
    expect(mark(PlanMark, 1)).toContain(`<path class="crit-ring" d="M${cx},${18 - 10.5} L${cx + 10.5},18 L${cx},${18 + 10.5} L${cx - 10.5},18 Z">`);
  });
});

describe('chart narrower than the pane — SPEC §7.8', () => {
  const week = makeScale('2026-09-25', '2026-10-22', 'week', 1000); // 28 days × 12 px = 336 px

  it('the calendar goes on to the pane edge; dates keep their position', () => {
    const drawn = fillScale(week, 700);
    expect(drawn.days).toBe(59);
    expect(drawn.width).toBe(708);
    expect(drawn.x('2026-10-05')).toBe(week.x('2026-10-05'));
    expect(drawn.start).toBe(week.start);
  });

  it('a chart already wider than the pane is unchanged (the same object)', () => {
    expect(fillScale(week, 300)).toBe(week);
  });
});
