import { describe, expect, it } from 'vitest';
import { documentTitle, safeFileName } from '../../src/ui/common/documentTitle';

describe('browser tab title — the "Save as PDF" file name in the report (§17)', () => {
  it('no plan; the main view (• while unsaved); the report, dated', () => {
    const plan = { name: 'PM (3Y) F-101', statusDate: '2026-10-02' };
    expect(documentTitle({ name: null, statusDate: '', view: 'main', dirty: false })).toBe('Gantt Planner');
    expect(documentTitle({ ...plan, view: 'main', dirty: false })).toBe('PM (3Y) F-101 - Gantt Planner');
    expect(documentTitle({ ...plan, view: 'main', dirty: true })).toBe('• PM (3Y) F-101 - Gantt Planner');
    expect(documentTitle({ ...plan, view: 'report', dirty: true })).toBe('PM (3Y) F-101 - Progress report 2026-10-02');
    expect(documentTitle({ name: '  ', statusDate: '2026-10-02', view: 'main', dirty: false })).toBe('Gantt Planner');
  });

  it('Print Gantt (§9.4): the plan dated by the day it is printed, the Track Gantt by its status date', () => {
    const plan = { name: 'PM (3Y) F-102', statusDate: '2026-10-02', dirty: true, view: 'print' as const, today: '2026-11-02' };
    expect(documentTitle({ ...plan, mode: 'Plan' })).toBe('PM (3Y) F-102 - Gantt plan 2026-11-02');
    expect(documentTitle({ ...plan, mode: 'Track' })).toBe('PM (3Y) F-102 - Gantt 2026-10-02');
  });

  it('file names: characters Windows does not allow become "-"; Thai is kept', () => {
    expect(safeFileName('Unit 2/3: TA')).toBe('Unit 2-3- TA');
    expect(safeFileName('ซ่อมบำรุงเตา F-101')).toBe('ซ่อมบำรุงเตา F-101');
    expect(safeFileName(' a\nb   c ')).toBe('a-b c');
    expect(safeFileName('')).toBe('Project');
    expect(safeFileName('x'.repeat(100))).toHaveLength(80);
  });

  it('a long Thai name is cut between graphemes, never between a consonant and its vowel or tone mark', () => {
    const name = 'งานซ่อมบำรุงใหญ่ประจำปี หน่วยกลั่นน้ำมันดิบ หน่วยกลั่นสุญญากาศ และหน่วยแยกก๊าซ ปี 2569 ระยะที่ 2';
    expect(/\p{M}/u.test(name[80]!)).toBe(true); // a plain 80-unit cut would drop the ี of "ปี"
    const safe = safeFileName(name);
    expect(safe).toBe('งานซ่อมบำรุงใหญ่ประจำปี หน่วยกลั่นน้ำมันดิบ หน่วยกลั่นสุญญากาศ และหน่วยแยกก๊าซ');
    expect(safe.length).toBeLessThanOrEqual(80);
    expect(/\p{M}/u.test(name[safe.length]!)).toBe(false);
  });
});
