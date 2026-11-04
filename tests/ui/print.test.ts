import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMNS, OPTIONAL_COLUMNS, RESOURCE_PALETTE } from '../../src/config';
import { computePlan } from '../../src/engine/compute';
import type { Plan } from '../../src/engine/types';
import { assigneeInfo, rowsOf, type Row } from '../../src/store/selectors';
import { cellText, cellTone, legendAssignees, paginate, PAPER, printColumns, rowsPerPage } from '../../src/ui/print/printLayout';
import { makeProject, makeTask } from '../engine/helpers';

// Print Gantt (SPEC §9.4).

describe('pages — §9.4', () => {
  it('the printable area of A4 and A3 landscape inside 10 mm margins, in CSS px', () => {
    expect(PAPER.A4).toEqual({ width: 1046, height: 718, size: 'A4 landscape' });
    expect(PAPER.A3).toEqual({ width: 1511, height: 1046, size: 'A3 landscape' });
  });

  it('26 px rows under the 45 px headers: 25 per A4 page and 37 per A3 page with a one-line legend', () => {
    expect(rowsPerPage('A4', 20)).toBe(25);
    expect(rowsPerPage('A3', 20)).toBe(37);
    expect(rowsPerPage('A4', 38)).toBe(24); // a legend on two lines
    expect(paginate([...Array(60).keys()], 25).map((p) => p.length)).toEqual([25, 25, 10]);
    expect(paginate([], 25)).toEqual([]);
  });
});

describe('columns — §9.4', () => {
  const keys = (shown: readonly (typeof OPTIONAL_COLUMNS)[number][], mode: 'Plan' | 'Track', paper: 'A4' | 'A3') => {
    const { columns, left, width } = printColumns(shown, mode, paper);
    return { keys: columns.map((c) => c.key), headers: columns.map((c) => c.header), left, width };
  };

  it("ID, Task and the grid's visible columns, in the grid's order, at print widths", () => {
    expect(keys(DEFAULT_COLUMNS.Plan, 'Plan', 'A4')).toEqual({
      keys: ['id', 'task', 'assigned', 'duration', 'start', 'finish', 'predecessors'],
      headers: ['ID', 'Task', 'Assigned', 'Duration', 'Start', 'Finish', 'Predecessors'],
      left: [],
      width: 32 + 180 + 96 + 54 + 60 + 60 + 78 + 1,
    });
    expect(keys(DEFAULT_COLUMNS.Track, 'Track', 'A4')).toMatchObject({
      headers: ['ID', 'Task', 'Assigned', 'Progress', 'Actual Start', 'Actual Finish', 'Forecast Finish', 'Variance', 'Status'],
      left: [],
    });
    expect(keys(['finish', 'assigned'], 'Track', 'A3')).toMatchObject({ headers: ['ID', 'Task', 'Assigned', 'Planned Finish'], width: 32 + 260 + 96 + 60 + 1 });
    expect(printColumns(['variance'], 'Track', 'A4').columns.map((c) => c.align)).toEqual(['right', undefined, 'right']);
  });

  it('the chart keeps 380 px: the columns that would not fit are left out from the right and named', () => {
    const a4 = keys(OPTIONAL_COLUMNS, 'Plan', 'A4');
    expect(a4.keys.at(-1)).toBe('successors');
    expect(a4.left).toEqual(['Progress', 'Actual Start', 'Actual Finish', 'Actual Duration', 'Forecast Start', 'Forecast Finish', 'Variance', 'Status', 'Critical', 'Remarks']);
    expect(a4.width).toBeLessThanOrEqual(PAPER.A4.width - 380);
    const a3 = keys(OPTIONAL_COLUMNS, 'Plan', 'A3');
    expect(a3.left).toEqual(['Status', 'Critical', 'Remarks']);
    expect(a3.width).toBe(1109);
  });
});

/** 1 ACME task (late in Track mode) · 2 milestone · 3 unassigned · 4 major task over 5 (ThermCo, NDT). */
function plan(mode: 'Plan' | 'Track' = 'Track'): Plan {
  return {
    project: makeProject({ mode }),
    tasks: [
      makeTask(1, { assigned: ['acme'], plannedDuration: 5, remarks: 'Two\nlines' }),
      makeTask(2, { assigned: ['ScaffCo'], plannedDuration: 0, predecessorsText: '1' }),
      makeTask(3, { plannedDuration: 2, progress: 100, actualStart: '2026-11-02', actualFinish: '2026-11-03' }),
      makeTask(4, { name: 'Group', level: 1 }),
      makeTask(5, { assigned: ['ThermCo', 'NDT'], plannedDuration: 3, level: 2, progress: 40, actualStart: '2026-11-02' }),
    ],
    resources: [{ name: 'ThermCo' }, { name: 'ACME' }],
    holidays: [],
  };
}
const rowsOfPlan = (p: Plan): Row[] => rowsOf(p, computePlan(p));

describe('cells — §9.4: the text the grid shows, on one line', () => {
  const rows = rowsOfPlan(plan());
  const row = (id: number) => rows.find((r) => r.task.id === id)!;

  it('dates dd MMM yy, durations, progress, names, links, status', () => {
    expect(['assigned', 'duration', 'start', 'finish', 'progress', 'status'].map((k) => cellText(k as 'assigned', row(5)))).toEqual(['ThermCo, NDT', '3d', '02 Nov 26', '04 Nov 26', '40%', 'Late']);
    expect(cellText('predecessors', row(2))).toBe('1');
    expect(cellText('successors', row(1))).toBe('2');
    expect([cellText('actualStart', row(1)), cellText('actualFinish', row(1)), cellText('actualDuration', row(1))]).toEqual(['', '', '']);
    expect(cellText('remarks', row(1))).toBe('Two lines');
    expect(cellText('progress', row(4))).toBe('40%'); // the major task's roll-up
  });

  it('colours as the grid: a later forecast and variance red, on time muted, Status in its colour', () => {
    expect([cellText('variance', row(5)), cellTone('variance', row(5)), cellTone('forecastFinish', row(5))]).toEqual([expect.stringMatching(/^\+\d+d$/), 'text-late', 'text-late']);
    expect([cellText('variance', row(3)), cellTone('variance', row(3)), cellTone('forecastFinish', row(3))]).toEqual(['—', 'text-muted', undefined]);
    expect(cellTone('status', row(5))).toBe('print-status st-late');
    expect(cellTone('duration', row(5))).toBeUndefined();
  });
});

describe('legend — §9.4', () => {
  it("colouring by assignee: each printed bar's colour (its first assignee), in the Resources order, and Unassigned", () => {
    const p = plan();
    const info = assigneeInfo(p);
    expect(legendAssignees(rowsOfPlan(p), info)).toEqual({
      names: [
        { name: 'ThermCo', color: RESOURCE_PALETTE[0] },
        { name: 'acme', color: RESOURCE_PALETTE[1] }, // as written on its task
      ],
      unassigned: true, // task 3; the milestone (ScaffCo) and the major task keep their own colours
    });
    expect(legendAssignees(rowsOfPlan(p).filter((r) => r.task.id === 5), info)).toEqual({ names: [{ name: 'ThermCo', color: RESOURCE_PALETTE[0] }], unassigned: false });
  });
});
