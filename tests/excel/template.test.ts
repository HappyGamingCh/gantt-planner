import { describe, expect, it } from 'vitest';
import { validationsOf } from '../../src/excel/exceljs';
import { HOLIDAYS_NOTE, README_LINES } from '../../src/excel/readme';
import { CALC_NOTE, PROJECT_FIELDS, TASK_COLUMNS, findSheet } from '../../src/excel/schema';
import { createTemplate } from '../../src/excel/template';
import { read, reload } from './helpers';

// Checked after a save and reopen, so these are properties of the file, not of the in-memory workbook.
const template = await reload(createTemplate([{ date: '2026-12-31', description: 'New Year' }]));
const tasks = findSheet(template, 'Tasks')!;

describe('template workbook — SPEC §4', () => {
  it('has the five sheets, Tasks active', () => {
    expect(template.worksheets.map((ws) => ws.name)).toEqual(['Project', 'Tasks', 'Resources', 'Holidays', 'Read Me']);
    expect(template.views[0]?.activeTab).toBe(1);
  });

  it('Tasks: headers in order, dark for input and grey italic with a note for calculated', () => {
    expect(tasks.getRow(1).values).toEqual([undefined, ...TASK_COLUMNS.map((c) => c.header)]);
    for (const [i, column] of TASK_COLUMNS.entries()) {
      const cell = tasks.getCell(1, i + 1);
      expect(cell.fill).toMatchObject({ pattern: 'solid', fgColor: { argb: column.calc ? 'FFE2E8F0' : 'FF1E293B' } });
      expect(cell.font).toMatchObject(column.calc ? { italic: true, color: { argb: 'FF475569' } } : { bold: true, color: { argb: 'FFFFFFFF' } });
      expect(cell.note).toBe(column.calc ? CALC_NOTE : undefined);
      expect(tasks.getColumn(i + 1).width).toBe(column.width);
    }
  });

  it('Tasks: frozen header row and ID/Level/Task columns, autofilter', () => {
    expect(tasks.views[0]).toMatchObject({ state: 'frozen', xSplit: 3, ySplit: 1 });
    expect(tasks.autoFilter).toBe('A1:S1');
  });

  it('Tasks: validation on Level, Progress, Planned Duration and the date columns', () => {
    const rules = validationsOf(tasks).model;
    expect(rules.B2).toMatchObject({ type: 'whole', operator: 'between', formulae: [1, 8] }); // Level
    expect(rules.I2).toMatchObject({ type: 'decimal', operator: 'between', formulae: [0, 100] }); // 50% is 0.5
    expect(rules.G1000).toMatchObject({ type: 'whole', operator: 'greaterThanOrEqual', formulae: [0] });
    for (const col of ['F', 'H', 'J', 'K']) expect(rules[`${col}2`]?.type).toBe('date');
    expect(rules.C2).toBeUndefined();
  });

  it('Project, Resources, Holidays and Read Me', () => {
    const project = findSheet(template, 'Project')!;
    expect(project.getColumn(1).values.slice(1)).toEqual(['Field', ...PROJECT_FIELDS]);
    expect(project.getCell('B6').value).toBe('Plan');
    expect(findSheet(template, 'Resources')!.getRow(1).values).toEqual([undefined, 'Name', 'Type', 'Color']);
    const holidays = findSheet(template, 'Holidays')!;
    expect(holidays.getRow(1).values).toEqual([undefined, 'Date', 'Description']);
    expect(holidays.getCell('D2').value).toBe(HOLIDAYS_NOTE);
    const readMe = findSheet(template, 'Read Me')!;
    expect(README_LINES.map((_, i) => readMe.getCell(i + 3, 1).value)).toEqual(README_LINES);
  });

  it('opens as an empty plan with defaults', () => {
    const r = read(template);
    expect(r.plan.tasks).toEqual([]);
    expect(r.plan.project).toEqual({ name: 'Untitled project', owner: '', projectStart: '2026-10-30', statusDate: '2026-10-30', mode: 'Plan' });
    expect(r.plan.holidays).toEqual([{ date: '2026-12-31', description: 'New Year' }]);
    expect(r.issues).toEqual([]);
  });
});
