import { describe, expect, it } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import { sampleData } from '../../src/sample/sampleData';
import { rowsOf } from '../../src/store/selectors';
import { placeTip } from '../../src/ui/gantt/GanttTooltip';
import { makeScale } from '../../src/ui/gantt/scale';
import { rowHoverCss } from '../../src/ui/main/RowHover';
import { keepCentre, quarterIn, revealLeft } from '../../src/ui/main/scroll';

// The sample (SPEC §13): status date Wed 30 Sep 2026. #14 was planned for 29 Sep, is late and forecast for 1 Oct.
const rows = rowsOf(sampleData, computePlan(sampleData));
const row = (id: number) => rows.find((r) => r.task.id === id)!;

describe('reveal a task — SPEC §7.8, §7.11', () => {
  const day = makeScale('2026-09-25', '2026-10-22', 'day', 1000);
  const early = makeScale('2026-09-11', '2026-10-22', 'day', 1000); // starts two weeks early: room to scroll to every bar

  it('Plan mode scrolls to the planned bar that is drawn, Track mode to the forecast/actual bar', () => {
    const { r } = row(14);
    expect(r.plannedStart).not.toBe(r.forecastStart);
    expect(revealLeft(r, 'Plan', early, 400)).toBe(early.x('2026-09-29') - 130); // a narrow pane keeps 130 px, not a quarter
    expect(revealLeft(r, 'Track', early, 400)).toBe(early.x('2026-10-01') - 130);
  });

  it('a milestone scrolls to its diamond; never before the chart start', () => {
    expect(revealLeft(row(20).r, 'Plan', early, 400)).toBe(early.x('2026-10-07') + 16 - 6 - 130);
    expect(revealLeft(row(1).r, 'Plan', day, 800)).toBe(0);
    expect(quarterIn(150, 400)).toBe(20);
    expect(quarterIn(500, 800)).toBe(300); // a quarter of a wider pane
  });
});

describe('zoom keeps the place — SPEC §7.8', () => {
  const week = makeScale('2026-09-25', '2026-12-31', 'week', 1000);
  const day = makeScale('2026-09-25', '2026-12-31', 'day', 1000);
  const month = makeScale('2026-09-25', '2026-12-31', 'month', 1000);
  const centreDay = (scale: typeof day, left: number, w: number) => (left + w / 2) / scale.px;

  it('Week → Day keeps the date at the centre of the pane', () => {
    const left = 360; // 2026-10-25 at the centre of a 600 px pane: (360 + 300) / 12 = 55 days in
    const next = keepCentre(week, day, left, 600);
    expect(centreDay(day, next, 600)).toBeCloseTo(centreDay(week, left, 600));
    expect(next).toBe(55 * 32 - 300);
  });

  it('Day → Month keeps it too, and stops at the chart start', () => {
    expect(centreDay(month, keepCentre(day, month, 2000, 200), 200)).toBeCloseTo(centreDay(day, 2000, 200));
    expect(keepCentre(day, month, 100, 200)).toBe(0);
  });
});

describe('Gantt tooltip placement — SPEC §7.8, §10', () => {
  it('below right of the pointer by default', () => {
    expect(placeTip({ x: 100, y: 100 }, 300, 150, 1280, 720)).toEqual({ left: 114, top: 116 });
  });

  it('kept inside the window at the right edge', () => {
    expect(placeTip({ x: 1200, y: 100 }, 300, 150, 1280, 720).left).toBe(972);
  });

  it('a tall card (a long Thai name) near the bottom sits wholly above the pointer', () => {
    const { top } = placeTip({ x: 600, y: 650 }, 300, 190, 1280, 720);
    expect(top).toBe(448);
    expect(top + 190).toBeLessThan(650);
  });

  it('never above the top of the window', () => {
    expect(placeTip({ x: 100, y: 100 }, 300, 700, 1280, 720).top).toBe(8);
  });
});

describe('row hover in both panes — SPEC §7.7', () => {
  it('highlights the grid row and its Gantt lane, leaving a selected row its own colour', () => {
    const css = rowHoverCss(7);
    expect(css).toContain('.pane-grid .grid-row[data-row="7"]:not(.selected){background:var(--surface-2)}');
    expect(css).toContain('.pane-gantt .lane[data-row="7"]:not(.lane-selected){fill:var(--surface-2)}');
    expect(css).toContain('.pane-gantt .labels [data-row="7"]:not(.label-selected) .bar-label{stroke:var(--surface-2)}'); // halo = lane colour
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
