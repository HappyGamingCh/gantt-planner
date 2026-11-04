import { describe, expect, it } from 'vitest';
import { RESOURCE_PALETTE } from '../../src/config';
import { computePlan } from '../../src/engine/compute';
import { makeIssue } from '../../src/engine/issues';
import { sampleData } from '../../src/sample/sampleData';
import { assigneeCount, assigneeInfo, problems, rowsOf } from '../../src/store/selectors';
import { formatDate, formatDayMonth, formatDays, formatPct, formatVariance } from '../../src/ui/common/format';

describe('formats — SPEC §7.2', () => {
  it('dates, durations, variance, percent', () => {
    expect([formatDate('2026-10-22'), formatDate('2026-10-05')]).toEqual(['22 Oct 26', '05 Oct 26']);
    expect(formatDayMonth('2026-11-03')).toBe('3 Nov');
    expect(formatDays(5)).toBe('5d');
    expect([formatVariance(3), formatVariance(-1), formatVariance(0)]).toEqual(['+3d', '−1d', '—']);
    expect([formatPct(36.59), formatPct(40.04)]).toEqual(['37%', '40%']);
  });
});

describe('selectors', () => {
  const result = computePlan(sampleData);

  it('rows pair each task with its result, in row order', () => {
    const rows = rowsOf(sampleData, result);
    expect(rows.map((row) => row.task.id)).toEqual(sampleData.tasks.map((t) => t.id));
    expect(rows.every((row) => row.r.id === row.task.id)).toBe(true);
  });

  it('assignee colours: own colour, else the palette by position; unknown names come after the resources', () => {
    const plan = {
      ...sampleData,
      resources: [{ name: 'ACME', type: 'Contractor' as const, color: '#123456' }, { name: 'NDT', type: 'Team' as const }],
      tasks: [...sampleData.tasks.slice(0, 3), { ...sampleData.tasks[3]!, assigned: ['newco', 'ACME'] }],
    };
    const info = assigneeInfo(plan);
    expect(info.get('acme')).toEqual({ type: 'Contractor', color: '#123456' });
    expect(info.get('ndt')).toEqual({ type: 'Team', color: RESOURCE_PALETTE[1] });
    expect(info.get('newco')).toEqual({ type: undefined, color: RESOURCE_PALETTE[2] });
  });

  it('counts the assignees named on tasks', () => {
    expect(assigneeCount(sampleData)).toBe(9);
  });

  it('problems: errors first, then warnings; information apart as notes', () => {
    const { list, notes } = problems({
      readIssues: [makeIssue('W_FORMULA'), makeIssue('W_BAD_HOLIDAY', { n: 4, text: 'x' })],
      plan: sampleData,
      result: { ...result, issues: [makeIssue('E_CYCLE', { ids: '1, 2' })] },
      file: null,
      savedAt: null,
    });
    expect(list.map((i) => i.code)).toEqual(['E_CYCLE', 'W_BAD_HOLIDAY']);
    expect(notes.map((i) => i.code)).toEqual(['W_FORMULA']);
  });
});
