import { describe, expect, it } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import { findSheet } from '../../src/excel/schema';
import { fixture, read, save, taskCell, tasksSheet } from './helpers';

// tests/fixtures/messy.xlsx (npm run sample): the sample with the mistakes people make in Excel (scripts/fixtures.ts).
const wb = await fixture('messy.xlsx');
const first = read(wb);
const result = computePlan(first.plan);
const issues = [...first.issues, ...result.issues];

describe('messy workbook — SPEC §12', () => {
  it('reports every problem', () => {
    expect(issues.map((i) => i.message)).toEqual([
      'ID 11 is used more than once; row 13 got ID 28',
      'Task 17: "next week" in Actual Start is not a date',
      'Task 19: "two" in Planned Duration is not a valid number',
      'Row 28 has data but no task name',
      'Formulas in Tasks will be saved as values: Planned Duration G10',
      'Holidays row 4: "TBC" is not a date',
      'Task 27: predecessor 8 does not exist', // row 10 (old task 9) lost its ID; task 8 got 26
      'Task 13: predecessor 12 does not exist',
      'Task 13: "abc" is not valid predecessor notation',
      'Task 20: predecessor 9 does not exist',
      'Task 22: FF/SF links are not supported yet',
      'Circular dependency: 21, 23',
      'Task 29: no duration, set to 1 day',
      'Task 18: 100% but no actual finish',
    ]);
  });

  it('reads text dates, a %-formatted progress, a formula and a row with only a remark', () => {
    const task = (id: number) => first.plan.tasks.find((t) => t.id === id)!;
    expect(task(6)).toMatchObject({ actualStart: '2026-09-30', actualFinish: '2026-09-30' });
    expect(task(16).progress).toBe(50);
    expect(task(27).plannedDuration).toBe(2);
    expect(task(29)).toMatchObject({ name: '(Untitled)', remarks: 'Check scaffold permit', extra: { Area: 'Close out' } });
    expect(first.plan.tasks.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 26, 27, 10, 11, 28, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 29]);
  });

  it('after Save: user text kept, IDs fixed, formula and blank row gone, other sheets untouched', async () => {
    const saved = await save(wb, first);
    expect(taskCell(saved, 18, 'actualStart').value).toBe('next week');
    expect(taskCell(saved, 20, 'plannedDuration').value).toBe('two');
    expect(taskCell(saved, 14, 'predecessors').value).toBe('12, abc');
    expect(taskCell(saved, 23, 'predecessors').value).toBe('20FF');
    expect(taskCell(saved, 10, 'plannedDuration').value).toBe(2);
    expect(taskCell(saved, 17, 'progress')).toMatchObject({ value: 0.5, numFmt: '0%' });
    expect(tasksSheet(saved).actualRowCount).toBe(27); // header + 26 tasks; the blank row 27 is gone
    expect(findSheet(saved, 'Holidays')!.getCell('A4').value).toBe('TBC');
    expect(findSheet(saved, 'Site notes')!.getSheetValues()).toEqual(findSheet(wb, 'Site notes')!.getSheetValues());

    const again = read(saved);
    expect(again.plan.tasks.map((t) => t.id)).toEqual(first.plan.tasks.map((t) => t.id));
    expect(again.issues.map((i) => i.code)).toEqual(['W_BAD_DATE', 'W_BAD_NUMBER', 'W_BAD_HOLIDAY']);
    expect(again.changes).toEqual([]);
  });
});
