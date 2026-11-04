import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createCalendar } from '../../src/engine/calendar';
import { computePlan } from '../../src/engine/compute';
import { SAMPLE_STATUS_DATE, sampleData } from '../../src/sample/sampleData';
import { assigneeInfo, rowsOf } from '../../src/store/selectors';
import { Gantt, LABEL_ROOM } from '../../src/ui/gantt/Gantt';
import { makeScale } from '../../src/ui/gantt/scale';

// The sample (SPEC §13): status date Wed 30 Sep 2026, drawn 25 Sep → 22 Oct (28 days).
const rows = rowsOf(sampleData, computePlan(sampleData));
const calendar = createCalendar(sampleData.holidays.map((h) => h.date));
const chart = (mode: 'Plan' | 'Track', zoom: 'day' | 'week', paneWidth: number, selection: number[] = [], today = SAMPLE_STATUS_DATE) =>
  renderToStaticMarkup(
    createElement(Gantt, {
      rows,
      mode,
      scale: makeScale('2026-09-25', '2026-10-22', zoom, paneWidth - LABEL_ROOM),
      calendar,
      rowHeight: 36,
      statusDate: SAMPLE_STATUS_DATE,
      today,
      holidays: sampleData.holidays,
      selection,
      info: assigneeInfo(sampleData),
      colorBy: 'status',
      critical: false,
      paneWidth,
    }),
  );
const count = (html: string, part: string) => html.split(part).length - 1;

describe('Gantt chart — SPEC §7.8', () => {
  it('a range narrower than the pane: the chart, its lanes and row lines reach the pane edge', () => {
    const html = chart('Plan', 'week', 700); // 28 days × 12 px + 160 px of label room = 496 px
    expect(html).toContain('<svg class="gantt-chart gantt-plan" width="700"');
    expect(count(html, 'class="lane" x="0"')).toBe(rows.length);
    expect(html).toContain('width="700" height="36"');
    expect(html).toContain('H700');
  });

  it('a range wider than the pane keeps its own width', () => {
    expect(chart('Plan', 'day', 700)).toContain(`width="${28 * 32 + LABEL_ROOM}"`);
  });

  it('lanes, marks and labels carry their task ID (one click handler, row hover in both panes)', () => {
    const html = chart('Track', 'day', 1200);
    expect(count(html, 'data-row="7"')).toBe(3); // the lane, the mark and the label (its halo follows the row hover)
  });

  it('Track mode: no arrows until a task is selected, then only its own', () => {
    expect(chart('Track', 'day', 1200)).not.toContain('class="link');
    expect(count(chart('Track', 'day', 1200, [7]), '<g class="link ')).toBe(2);
  });
});

describe('Gantt chart look — SPEC §7.8 (visual refresh)', () => {
  it('Track mode: the status-date line has a white halo right under it, on the same coordinates', () => {
    const html = chart('Track', 'day', 1200);
    const x = 6 * 32; // end of 30 Sep at 32 px/day from 25 Sep
    const h = rows.length * 36;
    expect(html).toContain(`<line class="sd-halo" x1="${x}" x2="${x}" y1="0" y2="${h}"></line><line class="sd-line" x1="${x}" x2="${x}" y1="0" y2="${h}"></line>`);
    expect(count(html, 'class="sd-line"')).toBe(2); // the chart's and the timeline's (the timeline has no halo)
    expect(chart('Plan', 'day', 1200)).not.toContain('sd-halo');
  });

  it('a selected row’s mark is flagged, so its unfinished part is drawn white over the blue lane', () => {
    const html = chart('Track', 'day', 1200, [11]);
    expect(html).toContain('<g data-row="11" class="mark mark-selected">');
    expect(count(html, 'mark-selected')).toBe(1);
    expect(chart('Track', 'day', 1200)).not.toContain('mark-selected');
  });

  it('the today line and its chip only when the line, mid-day, falls inside the chart (the drawn scale runs a day past it)', () => {
    // Week zoom in a 700 px pane: 12 px/day from 25 Sep, so 21 Nov is at 684–696 px and 22 Nov at 696–708 px.
    expect(chart('Plan', 'week', 700, [], '2026-11-21')).toContain('<line class="today-line" x1="690"');
    const past = chart('Plan', 'week', 700, [], '2026-11-22');
    expect(past).not.toContain('today-line');
    expect(past).not.toContain('tl-today');
  });
});
