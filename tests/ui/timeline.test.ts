import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import { SAMPLE_STATUS_DATE, sampleData, sampleHolidays } from '../../src/sample/sampleData';
import { rowsOf } from '../../src/store/selectors';
import { MarkLabel, TrackMark } from '../../src/ui/gantt/bars';
import { CORNER_RESERVE } from '../../src/ui/gantt/GanttCorner';
import { chipWidth, fillScale, fittedScale, gridColumns, layoutChips, makeScale, monthLabelOffset, monthSegments, showsHolidays, showsWeekends, weekendDays } from '../../src/ui/gantt/scale';
import { Timeline } from '../../src/ui/gantt/Timeline';
import { quarterIn } from '../../src/ui/main/scroll';

// The sample (SPEC §13): range Fri 25 Sep → Thu 22 Oct 2026 (28 days), status date Wed 30 Sep, holidays 13 and 23 Oct.
const START = '2026-09-25';
const END = '2026-10-22';
const STATUS = 'Status · 30 Sep';
const count = (html: string, s: string) => html.split(s).length - 1;

describe('grid lines — SPEC §7.8', () => {
  it('day detail: a line at every day boundary, Mondays apart so weeks still read', () => {
    // Wed 30 Sep → Tue 13 Oct: Mondays 5 and 12 Oct.
    expect(gridColumns(makeScale('2026-09-30', '2026-10-13', 'day', 1000))).toEqual({ weeks: [5, 12], days: [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13] });
    expect(gridColumns(makeScale('2026-09-30', '2026-10-13', 'fit', 280)).days).toHaveLength(11); // Fit at 20 px/day shows days
  });

  it('week and month detail: Mondays only', () => {
    expect(gridColumns(makeScale('2026-09-30', '2026-10-13', 'week', 1000))).toEqual({ weeks: [5, 12], days: [] });
    expect(gridColumns(makeScale('2026-09-30', '2026-10-13', 'month', 1000)).days).toEqual([]);
  });
});

describe('weekends — SPEC §7.8', () => {
  it('Saturdays and Sundays of the range; columns whenever a day is at least Week-wide', () => {
    // Fri 25 Sep → Thu 22 Oct 2026: weekends 26/27 Sep, 3/4, 10/11, 17/18 Oct.
    expect(weekendDays(makeScale(START, END, 'day', 1000))).toEqual([1, 2, 8, 9, 15, 16, 22, 23]);
    expect(showsWeekends(makeScale(START, END, 'day', 1000))).toBe(true);
    expect(showsWeekends(makeScale(START, END, 'week', 1000))).toBe(true);
    expect(showsWeekends(makeScale(START, END, 'month', 1000))).toBe(false);
  });

  it('the Day timeline marks weekend cells and numbers; a holiday keeps its own grey', () => {
    const html = renderToStaticMarkup(createElement(Timeline, { scale: makeScale(START, END, 'day', 1000), width: 900, holidays: [{ date: '2026-10-03', description: 'Test' }] }));
    expect(count(html, 'class="tl-weekend"')).toBe(7); // 8 weekend days, 3 Oct is a holiday
    expect(count(html, 'tl-day tl-day-weekend')).toBe(7);
    expect(count(html, 'tl-day tl-day-off')).toBe(1);
    const week = renderToStaticMarkup(createElement(Timeline, { scale: makeScale(START, END, 'week', 1000), width: 900, holidays: [] }));
    expect(week).not.toContain('tl-weekend'); // week labels, no day numbers
  });
});

describe('holiday columns — SPEC §7.8', () => {
  it('shown whenever a day is at least Month-wide, at every zoom', () => {
    expect(showsHolidays(makeScale(START, END, 'month', 1000))).toBe(true);
    expect(showsHolidays(makeScale(START, END, 'day', 1000))).toBe(true);
    const fit = makeScale('2026-09-01', '2026-11-29', 'fit', 540); // 90 days, 6 px/day: 'month' detail
    expect(fit.detail).toBe('month');
    expect(showsHolidays(fit)).toBe(true);
  });

  it('left out of the printed Gantt only when a day gets less than 4 px', () => {
    expect(showsHolidays(fittedScale('2026-01-01', '2026-10-27', 740))).toBe(false); // 300 days
    expect(showsHolidays(fittedScale(START, END, 740))).toBe(true);
  });
});

describe('timeline chips — SPEC §7.8', () => {
  const S = chipWidth(STATUS);
  const T = chipWidth('Today');
  const apart = (a: { cx: number; w: number }, b: { cx: number; w: number }) => Math.abs(a.cx - b.cx) >= (a.w + b.w) / 2;

  it('chip widths come from the text', () => {
    expect([S, T]).toEqual([105, 43]);
  });

  it('centred on the line when there is room', () => {
    expect(layoutChips(900, { x: 300, text: STATUS }, { x: 600, text: 'Today' })).toEqual({
      status: { x: 300, cx: 300, w: S, text: STATUS },
      today: { x: 600, cx: 600, w: T, text: 'Today' },
    });
    expect(layoutChips(900, undefined, { x: 600, text: 'Today' }).status).toBeUndefined(); // Plan mode: Today only
  });

  it('kept inside the chart at the left and right edges', () => {
    // SD = range start + 3 days (day 1 of a turnaround) at Month and Week zoom: the line is at 16 or 48 px.
    for (const px of [4, 12]) expect(layoutChips(500, { x: 4 * px, text: STATUS }).status!.cx - S / 2).toBe(2);
    expect(layoutChips(500, { x: 495, text: STATUS }).status!.cx + S / 2).toBe(498);
  });

  it('today a day after the status date: the Today chip moves beside the Status chip, to its right', () => {
    for (const px of [32, 12, 4]) {
      const sdX = 300;
      const { status, today } = layoutChips(900, { x: sdX, text: STATUS }, { x: sdX + px / 2, text: 'Today' });
      expect(status!.cx).toBe(sdX);
      expect(today!.x).toBe(sdX + px / 2); // the line stays put
      expect(today!.cx).toBeGreaterThan(status!.cx);
      expect(apart(status!, today!)).toBe(true);
    }
  });

  it('today before the status date: the Today chip moves to the left', () => {
    const { status, today } = layoutChips(900, { x: 300, text: STATUS }, { x: 284, text: 'Today' });
    expect(today!.cx).toBeLessThan(status!.cx);
    expect(apart(status!, today!)).toBe(true);
  });

  it('no room beside the Status chip: the Today chip is left out', () => {
    expect(layoutChips(200, { x: 150, text: STATUS }, { x: 166, text: 'Today' }).today).toBeUndefined();
  });

  it('kept clear of the Gantt corner at the right end (rightInset), the line staying put', () => {
    // Fit at 1280 px: the Today line falls under the Color by / Critical corner.
    const { today } = layoutChips(492, undefined, { x: 470, text: 'Today' }, CORNER_RESERVE);
    expect(today!.x).toBe(470);
    expect(today!.cx).toBeLessThanOrEqual(492 - CORNER_RESERVE - T / 2);
    expect(layoutChips(492, undefined, { x: 300, text: 'Today' }, CORNER_RESERVE).today!.cx).toBe(300); // clear of it already
    // A chart narrower than the chip plus the inset: the chip stays inside the left edge.
    expect(layoutChips(150, { x: 140, text: STATUS }, undefined, CORNER_RESERVE).status!.cx - S / 2).toBe(2);
  });
});

describe('month labels — SPEC §7.8', () => {
  const px = 19.3; // Fit for the sample at 1280 px
  const [sep, oct] = monthSegments(START, 28) as [ReturnType<typeof monthSegments>[number], ReturnType<typeof monthSegments>[number]];
  const { status } = layoutChips(28 * px + 160, { x: 6 * px, text: STATUS });

  it('start 6 px into the month', () => {
    expect([monthLabelOffset(sep, px, []), monthLabelOffset(oct, px, [])]).toEqual([6, 6]);
  });

  it('step right of a chip they would run into', () => {
    expect(monthLabelOffset(sep, px, [status!])).toBe(6); // "Sep 2026" ends before the chip
    expect(monthLabelOffset(oct, px, [status!])).toBeCloseTo(status!.cx + status!.w / 2 + 6 - 6 * px); // SD on the month boundary
  });

  it('are left out when the month is too narrow, or the moved label no longer fits', () => {
    expect(monthLabelOffset({ label: 'Sep 2026', day: 0, days: 3 }, 12, [])).toBeNull();
    expect(monthLabelOffset(sep, px, [{ x: 40, cx: 40, w: chipWidth('Today'), text: 'Today' }])).toBeNull();
    expect(monthLabelOffset(oct, px, [], 6 * px + 50)).toBeNull(); // only 50 px of October before the chart's edge
  });

  it('the Status chip of a pane opened on the status date starts right of a month name stuck at the left edge', () => {
    const stuckEnd = 6 + 'Sep 2026'.length * 7;
    for (const zoom of ['day', 'week', 'month'] as const) {
      for (const pane of [300, 400, 960]) {
        const scale = makeScale('2026-05-01', '2026-12-31', zoom, 1000); // SD far enough in to scroll to
        const left = quarterIn(scale.x(SAMPLE_STATUS_DATE), pane);
        const chip = layoutChips(scale.width + 160, { x: scale.x(SAMPLE_STATUS_DATE) + scale.px, text: STATUS }).status!;
        expect(left).toBeGreaterThan(0);
        expect(chip.cx - chip.w / 2 - left).toBeGreaterThan(stuckEnd);
      }
    }
  });
});

describe('Timeline header — SPEC §7.8', () => {
  const render = (zoom: 'day' | 'month', today?: string) => {
    const scale = makeScale(START, END, zoom, 1000);
    const holidays = sampleHolidays.filter((h) => h.date <= END); // the chart passes the holidays in range: 13 Oct
    return renderToStaticMarkup(createElement(Timeline, { scale, width: scale.width + 160, holidays, statusDate: SAMPLE_STATUS_DATE, today }));
  };

  it('Day zoom: a tick at every day, Mondays stronger; month names as sticky HTML labels', () => {
    const html = render('day');
    expect(count(html, 'class="tl-tick')).toBe(28);
    expect(count(html, 'class="tl-tick tl-week"')).toBe(4); // 28 Sep, 5, 12, 19 Oct
    expect(html).toContain('<span class="tl-month" style="margin-left:6px">Sep 2026</span>');
    expect(html).toContain('>Oct 2026</span>');
  });

  it('chips sit in the top tier with a line down through the bottom tier', () => {
    const html = render('day', '2026-10-01');
    expect(html).toMatch(/<g class="tl-status"><rect x="[\d.]+" y="3"/);
    expect(html).toMatch(/<g class="tl-today"><rect x="[\d.]+" y="3"/);
    expect(html).toContain('<line class="sd-line" x1="192" x2="192" y1="19" y2="44"></line>'); // end of 30 Sep at 32 px/day
    expect(html).toContain('<line class="today-line" x1="208" x2="208" y1="19" y2="44"></line>');
  });

  it('a Today chip moved off its line names its date; one on its line just says Today', () => {
    expect(render('day', '2026-10-01')).toContain('>Today · 1 Oct</text>'); // beside the Status chip
    expect(render('day', '2026-10-10')).toContain('>Today</text>');
    // Clear of the Gantt corner: Fit at 1280 px, today in the chart's last 126 px.
    const scale = fillScale(makeScale(START, END, 'fit', 332), 492);
    const html = renderToStaticMarkup(createElement(Timeline, { scale, width: 492, holidays: [], today: '2026-10-31', rightInset: CORNER_RESERVE }));
    expect(html).toContain('>Today · 31 Oct</text>');
    expect(html).toMatch(/<line class="today-line" x1="4[0-9.]+"/); // the line stays on the day
  });

  it('holidays are shaded at Month zoom too', () => {
    expect(count(render('month'), 'class="tl-holiday"')).toBe(1);
  });

  it('week and month detail: a holiday is a 4 px strip at the foot of the tier, the whole cell keeps the tooltip', () => {
    const html = render('month');
    expect(html).toMatch(/<g><title>[^<]+<\/title><rect class="tl-holiday-hit" x="[\d.]+" y="22" width="4" height="22"><\/rect><rect class="tl-holiday" x="[\d.]+" y="40" width="4" height="4"><\/rect><\/g>/);
    expect(html).not.toContain('tl-day-off');
  });

  it('day detail: the whole cell, and its day number takes the cell colour as its halo', () => {
    const html = render('day');
    expect(html).toMatch(/<rect class="tl-holiday" x="[\d.]+" y="22" width="32" height="22"><title>/);
    expect(count(html, 'class="tl-day tl-day-off"')).toBe(1);
    expect(html).toMatch(/class="tl-day tl-day-off"[^>]*>13<\/text>/); // Tue 13 Oct
  });

  it('the month cells end at the chart width, though the filled scale runs up to a day past it', () => {
    const drawn = fillScale(makeScale(START, END, 'fit', 555), 715); // Fit at 1280 px: 19.8 px/day, 37 days = 733 px
    expect(drawn.width).toBeGreaterThan(715);
    const html = renderToStaticMarkup(createElement(Timeline, { scale: drawn, width: 715, holidays: [], statusDate: SAMPLE_STATUS_DATE }));
    const cells = [...html.matchAll(/class="tl-month-cell" style="width:([\d.]+)px"/g)].map((m) => Number(m[1]));
    expect(cells).toHaveLength(2);
    expect(cells.reduce((a, b) => a + b, 0)).toBeCloseTo(715);
  });
});

describe('bar labels — SPEC §7.8', () => {
  const rows = rowsOf(sampleData, computePlan(sampleData));
  const scale = makeScale(START, END, 'day', 1000);
  const label = (mode: 'Plan' | 'Track', id: number) =>
    renderToStaticMarkup(createElement('svg', null, createElement(MarkLabel, { row: rows.find((row) => row.task.id === id)!, mode, top: 0, rowHeight: 36, scale })));

  it('are drawn apart from the marks, so they can sit above the status-date line', () => {
    const row = rows.find((r) => r.task.id === 7)!;
    expect(renderToStaticMarkup(createElement('svg', null, createElement(TrackMark, { row, top: 0, rowHeight: 36, scale, critical: false })))).not.toContain('bar-label');
  });

  it('Track: progress, with the variance when late; milestones show their date', () => {
    expect(label('Track', 7)).toMatch(/class="bar-label"[^>]*>\d+%<tspan class="label-late"> · \+2d<\/tspan><\/text>/);
    expect(label('Track', 1)).toContain('>28 Sep</text>');
  });

  it('Plan: assignees; milestones show their date; nothing for an unassigned bar', () => {
    const assigned = rows.find((r) => r.task.assigned.length > 0 && r.r.plannedDuration > 0)!;
    expect(label('Plan', assigned.task.id)).toContain(`>${assigned.task.assigned.join(', ')}</text>`);
    expect(label('Plan', 1)).toContain('>28 Sep</text>');
    const blank = { ...assigned, task: { ...assigned.task, assigned: [] } };
    expect(renderToStaticMarkup(createElement('svg', null, createElement(MarkLabel, { row: blank, mode: 'Plan', top: 0, rowHeight: 36, scale })))).toBe('<svg></svg>');
  });
});
