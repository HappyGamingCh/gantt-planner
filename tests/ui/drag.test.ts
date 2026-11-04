import { describe, expect, it } from 'vitest';
import { createCalendar } from '../../src/engine/calendar';
import { dragDates, dragDays, edgeStep, movable } from '../../src/ui/gantt/drag';
import { makeTask, run, taskOf } from '../engine/helpers';

// Wed 4 Nov 2026 is a holiday. Task 1: Mon 2 Nov, 3 days → 2, 3, 5 Nov.
const holidays = ['2026-11-04'];
const cal = createCalendar(holidays);
const result = run(
  [makeTask(1, { plannedStart: '2026-11-02', plannedDuration: 3 }), makeTask(2, { predecessorsText: '1', plannedDuration: 0 })],
  { statusDate: '2026-11-01' },
  holidays,
);
const bar = taskOf(result, 1);
const milestone = taskOf(result, 2);

describe('drag on the Gantt — SPEC §7.8', () => {
  it('moving keeps the duration and snaps the start forward to a working day', () => {
    expect(dragDates(bar, 'move', 2, cal)).toEqual({ start: '2026-11-05', duration: 3, finish: '2026-11-07' }); // 4 Nov is a holiday
    expect(dragDates(bar, 'move', -1, cal)).toEqual({ start: '2026-11-01', duration: 3, finish: '2026-11-03' });
    expect(dragDates(bar, 'move', 0, cal)).toEqual({ start: '2026-11-02', duration: 3, finish: '2026-11-05' });
  });

  it('resizing counts the working days to the new finish, at least 1', () => {
    expect(dragDates(bar, 'resize', 1, cal)).toEqual({ start: '2026-11-02', duration: 4, finish: '2026-11-06' });
    expect(dragDates(bar, 'resize', -1, cal)).toEqual({ start: '2026-11-02', duration: 2, finish: '2026-11-03' }); // onto the holiday
    expect(dragDates(bar, 'resize', -10, cal)).toEqual({ start: '2026-11-02', duration: 1, finish: '2026-11-02' });
  });

  it('a milestone moves as a point', () => {
    expect(milestone.plannedStart).toBe('2026-11-05');
    expect(dragDates(milestone, 'move', 3, cal)).toEqual({ start: '2026-11-08', duration: 0, finish: '2026-11-08' });
  });

  it('only tasks without predecessors move', () => {
    expect(movable(bar)).toBe(true);
    expect(movable(milestone)).toBe(false);
  });
});

describe('auto-scroll while dragging — SPEC §7.8', () => {
  // A Gantt pane from x = 500 to x = 1200; the edge zone is 24 px.
  it('the middle of the pane does not scroll', () => {
    expect(edgeStep(800, 700, 500, 1200)).toBe(0);
  });

  it('near or past an edge it scrolls that way, faster the deeper the pointer goes (at most 16 px a frame)', () => {
    expect(edgeStep(1190, 900, 500, 1200)).toBe(7);
    expect(edgeStep(1199, 900, 500, 1200)).toBe(12);
    expect(edgeStep(1250, 900, 500, 1200)).toBe(16);
    expect(edgeStep(510, 700, 500, 1200)).toBe(-7);
    expect(edgeStep(100, 700, 500, 1200)).toBe(-16); // over the grid
  });

  it('only towards the side the pointer moved to: shortening a bar that ends at the edge does not scroll it on', () => {
    expect(edgeStep(1190, 1195, 500, 1200)).toBe(0);
    expect(edgeStep(510, 505, 500, 1200)).toBe(0);
  });
});

describe('days dragged, measured over the chart — SPEC §7.8', () => {
  // Day zoom, 32 px a day; pressed at x = 900 with the pane scrolled to 0.
  it('counts the pointer travel', () => {
    expect(dragDays(964, 900, 0, 0, 32, false)).toBe(2);
    expect(dragDays(836, 900, 0, 0, 32, false)).toBe(-2);
  });

  it('counts the pane scrolling under a still pointer (the auto-scroll at the edges)', () => {
    expect(dragDays(900, 900, 320, 0, 32, false)).toBe(10);
    expect(dragDays(900, 900, 0, 320, 32, false)).toBe(-10);
    expect(dragDays(836, 900, 320, 0, 32, false)).toBe(8); // the pointer back 2 days, the chart on 10
  });

  it('a press becomes a drag after 4 px of pointer travel and scroll together', () => {
    expect(dragDays(902, 900, 1, 0, 32, false)).toBeNull();
    expect(dragDays(1000, 900, 0, 100, 32, false)).toBeNull(); // the pointer and the scroll cancel out
    expect(dragDays(902, 900, 2, 0, 32, false)).toBe(0);
    expect(dragDays(868, 900, 0, 0, 32, false)).toBe(-1);
  });

  it('once dragging, any travel counts, rounded to the nearest day', () => {
    expect(dragDays(902, 900, 0, 0, 32, true)).toBe(0);
    expect(dragDays(916, 900, 0, 0, 32, true)).toBe(1);
    expect(dragDays(915, 900, 0, 0, 32, true)).toBe(0);
  });
});
