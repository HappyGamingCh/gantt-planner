import { describe, expect, it } from 'vitest';
import { RESOURCE_PALETTE } from '../../src/config';
import { computePlan } from '../../src/engine/compute';
import type { Worksheet } from '../../src/excel/exceljs';
import { HOLIDAYS_NOTE } from '../../src/excel/readme';
import { findSheet } from '../../src/excel/schema';
import { createTemplate } from '../../src/excel/template';
import { formatWorkingDays, parseWorkingDays } from '../../src/excel/workingDays';
import { writePlan } from '../../src/excel/write';
import { bareTasks, NOW, read, reload, save, templateWith } from './helpers';

/** Every cell with a value, by address: what Excel shows, whatever rows ExcelJS keeps empty. */
const values = (ws: Worksheet) => {
  const out: [string, unknown][] = [];
  ws.eachRow((row) =>
    row.eachCell((cell) => {
      if (cell.value !== null && cell.value !== undefined) out.push([cell.address, cell.value]);
    }),
  );
  return out;
};
const projectValue = (ws: Worksheet, field: string) => {
  let value: unknown;
  ws.eachRow((row) => {
    if (row.getCell(1).value === field) value = row.getCell(2).value;
  });
  return value;
};

describe('Working Days text — SPEC §4.7', () => {
  it('reads English and Thai names, lists and ranges', () => {
    const cases: [string, number[]][] = [
      ['Mon-Fri', [1, 2, 3, 4, 5]],
      ['Mon, Tue, Wed, Thu, Fri, Sat', [1, 2, 3, 4, 5, 6]],
      ['mon – sat', [1, 2, 3, 4, 5, 6]],
      ['Monday; Wednesday / Friday', [1, 3, 5]],
      ['Mon. - Fri.', [1, 2, 3, 4, 5]],
      ['Sat-Tue', [0, 1, 2, 6]],
      ['Tues Thurs', [2, 4]],
      ['Mon-Sun', [0, 1, 2, 3, 4, 5, 6]],
      ['All', [0, 1, 2, 3, 4, 5, 6]],
      ['every day', [0, 1, 2, 3, 4, 5, 6]],
      ['จ.-ศ.', [1, 2, 3, 4, 5]],
      ['จันทร์-เสาร์', [1, 2, 3, 4, 5, 6]],
      ['วันจันทร์ - วันศุกร์', [1, 2, 3, 4, 5]],
      ['จ.อ.พ.พฤ.ศ.', [1, 2, 3, 4, 5]],
      ['ส, อา', [0, 6]],
      ['ทุกวัน', [0, 1, 2, 3, 4, 5, 6]],
    ];
    for (const [text, days] of cases) expect([text, parseWorkingDays(text)]).toEqual([text, days]);
  });

  it('anything else is not a list of days', () => {
    for (const text of ['weekdays', '6', 'Mon-Fri-Sat', 'Mon-', 'Funday', 'Monday to Friday', '-']) expect([text, parseWorkingDays(text)]).toEqual([text, null]);
  });

  it('the app writes the days Monday first', () => {
    expect(formatWorkingDays(undefined)).toBe('Mon, Tue, Wed, Thu, Fri, Sat, Sun');
    expect(formatWorkingDays([0, 6])).toBe('Sat, Sun');
    expect(formatWorkingDays([1, 2, 3, 4, 5])).toBe('Mon, Tue, Wed, Thu, Fri');
  });
});

describe('Project › Working Days — SPEC §4.2, §4.8', () => {
  const withDays = (text: string | null) => {
    const wb = createTemplate();
    const ws = findSheet(wb, 'Project')!;
    ws.eachRow((row) => {
      if (row.getCell(1).value === 'Working Days') row.getCell(2).value = text;
    });
    return wb;
  };

  it('the template lists every day, which reads as no working days set', () => {
    const wb = createTemplate();
    expect(projectValue(findSheet(wb, 'Project')!, 'Working Days')).toBe('Mon, Tue, Wed, Thu, Fri, Sat, Sun');
    const r = read(wb);
    expect(r.plan.project.workingDays).toBeUndefined();
    expect(r.plan.project.workingDaysText).toBeUndefined();
    expect([r.issues, r.changes.filter((c) => c.field === 'Working Days')]).toEqual([[], []]);
  });

  it('text the app reads is used, and written back as typed', async () => {
    const r = read(withDays('mon-sat'));
    expect(r.plan.project).toMatchObject({ workingDays: [1, 2, 3, 4, 5, 6], workingDaysText: 'mon-sat' });
    expect([r.issues, r.changes.filter((c) => c.field === 'Working Days')]).toEqual([[], []]);
    const saved = await save(withDays('mon-sat'));
    expect(projectValue(findSheet(saved, 'Project')!, 'Working Days')).toBe('mon-sat');
  });

  it('the app’s own form needs no text of its own', () => {
    const r = read(withDays('Mon, Tue, Wed, Thu, Fri'));
    expect(r.plan.project.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(r.plan.project.workingDaysText).toBeUndefined();
  });

  it('blank is every day, with nothing recorded', () => {
    const r = read(withDays(null));
    expect(r.plan.project.workingDays).toBeUndefined();
    expect([r.issues, r.changes.filter((c) => c.field === 'Working Days')]).toEqual([[], []]);
  });

  it('unreadable text: a warning, every day counts, and Save keeps the text until the days are set in the app', async () => {
    const wb = withDays('weekdays');
    const r = read(wb);
    expect(r.plan.project.workingDays).toBeUndefined();
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'W_BAD_WORKING_DAYS',
        severity: 'warning',
        message:
          'Project sheet: Working Days "weekdays" is not a list of days such as Mon-Sat or Mon, Tue, Wed, so every day counts as a working day. Set the working days in Settings › Calendar',
      }),
    ]);
    const kept = await save(wb, r);
    expect(projectValue(findSheet(kept, 'Project')!, 'Working Days')).toBe('weekdays');
    const set = read(kept);
    set.plan.project = { ...set.plan.project, workingDays: [1, 2, 3, 4, 5] };
    delete set.plan.project.workingDaysText;
    const saved = await save(kept, set);
    expect(projectValue(findSheet(saved, 'Project')!, 'Working Days')).toBe('Mon, Tue, Wed, Thu, Fri');
    expect(read(saved).plan.project.workingDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('a file without the field opens unchanged and gets it on save', async () => {
    const wb = bareTasks(['ID', 'Task', 'Planned Duration'], [[1, 'A', 2]]);
    const r = read(wb);
    expect(r.plan.project.workingDays).toBeUndefined();
    expect(r.changes.filter((c) => c.field === 'Working Days')).toEqual([]);
    const saved = await save(wb, r);
    expect(projectValue(findSheet(saved, 'Project')!, 'Working Days')).toBe('Mon, Tue, Wed, Thu, Fri, Sat, Sun');
  });
});

describe('Holidays edited in the app — SPEC §4.5, §4.8', () => {
  /** Template holidays plus a user column, an unreadable date and a Buddhist-era date typed as text. */
  function holidaysBook() {
    const wb = createTemplate([
      { date: '2026-12-05', description: 'Father’s Day' },
      { date: '2026-12-31', description: 'New Year’s Eve' },
    ]);
    const ws = findSheet(wb, 'Holidays')!;
    ws.getCell('C1').value = 'Region';
    ws.getCell('C2').value = 'All';
    ws.getCell('C3').value = 'Bangkok';
    ws.getCell('A4').value = 'TBC';
    ws.getCell('B4').value = 'Company day';
    ws.getCell('A5').value = '13/4/2570';
    ws.getCell('B5').value = 'Songkran';
    return wb;
  }
  const sheet = (wb: Parameters<typeof findSheet>[0]) => findSheet(wb, 'Holidays')!;

  it('unchanged: the sheet is not touched, Buddhist-era text and the unreadable row included', async () => {
    const wb = holidaysBook();
    const r = read(wb);
    expect(r.plan.holidays.map((h) => h.date)).toEqual(['2026-12-05', '2026-12-31', '2027-04-13']);
    const before = values(sheet(await reload(holidaysBook())));
    expect(values(sheet(await save(wb, r)))).toEqual(before);
  });

  it('a changed description writes that cell only', async () => {
    const wb = holidaysBook();
    const r = read(wb);
    r.plan.holidays = r.plan.holidays.map((h) => (h.date === '2026-12-31' ? { ...h, description: 'Year end' } : h));
    const ws = sheet(await save(wb, r));
    expect(ws.getRow(3).values).toEqual([undefined, new Date(Date.UTC(2026, 11, 31)), 'Year end', 'Bangkok']);
    expect(ws.getCell('A5').value).toBe('13/4/2570');
  });

  it('a removed date empties its own cells only; a new one fills that row first, then goes below', async () => {
    const wb = holidaysBook();
    const r = read(wb);
    r.plan.holidays = [
      ...r.plan.holidays.filter((h) => h.date !== '2026-12-05'),
      { date: '2027-01-01', description: 'New Year' },
      { date: '2026-12-10', description: 'Constitution Day' },
    ];
    const ws = sheet(await save(wb, r));
    // Row 2 held 5 Dec: its Region stays; the earliest new date takes the row
    expect(ws.getRow(2).values).toEqual([undefined, new Date(Date.UTC(2026, 11, 10)), 'Constitution Day', 'All', HOLIDAYS_NOTE]);
    expect(ws.getRow(4).values).toEqual([undefined, 'TBC', 'Company day']); // unreadable: left alone
    expect(ws.getRow(6).values).toEqual([undefined, new Date(Date.UTC(2027, 0, 1)), 'New Year']);
    expect(ws.getCell('A6').numFmt).toBe('dd-mmm-yy');
    expect(read(await reload(ws.workbook)).plan.holidays.map((h) => h.date).sort()).toEqual(['2026-12-10', '2026-12-31', '2027-01-01', '2027-04-13']);
  });

  it('a removed date with nothing new leaves its row empty, and a second save writes nothing more', async () => {
    const wb = holidaysBook();
    const r = read(wb);
    r.plan.holidays = r.plan.holidays.filter((h) => h.date !== '2026-12-31');
    const once = await save(wb, r);
    expect(sheet(once).getRow(3).values).toEqual([undefined, undefined, undefined, 'Bangkok']);
    const twice = await save(once);
    expect(values(sheet(twice))).toEqual(values(sheet(once)));
  });

  it('a sheet with content but no Date header is left as it is, whatever the plan holds', async () => {
    const wb = templateWith([{ ID: 1, Task: 'A', 'Planned Duration': 1 }]);
    const ws = sheet(wb);
    ws.getCell('A1').value = 'Day off';
    ws.getCell('A2').value = new Date(Date.UTC(2026, 11, 5));
    const r = read(wb);
    expect(r.issues.map((i) => i.code)).toEqual(['W_HOLIDAYS_NO_HEADER']);
    const before = values(sheet(await reload(wb)));
    r.plan.holidays = [{ date: '2026-12-25', description: 'Christmas' }];
    expect(values(sheet(await save(wb, r)))).toEqual(before);
  });

  it('a missing sheet is created with its header and note, then the holidays', async () => {
    const wb = bareTasks(['ID', 'Task', 'Planned Duration'], [[1, 'A', 2]]);
    const r = read(wb);
    r.plan.holidays = [{ date: '2026-12-25', description: 'Christmas' }];
    const ws = sheet(await save(wb, r));
    expect(ws.getRow(1).values).toEqual([undefined, 'Date', 'Description']);
    expect(ws.getRow(2).values).toEqual([undefined, new Date(Date.UTC(2026, 11, 25)), 'Christmas', undefined, HOLIDAYS_NOTE]);
  });

  it('an empty sheet without headers gets them before the first holiday', async () => {
    const wb = bareTasks(['ID', 'Task', 'Planned Duration'], [[1, 'A', 2]]);
    wb.addWorksheet('Holidays');
    const r = read(wb);
    r.plan.holidays = [{ date: '2026-12-25', description: '' }];
    const saved = sheet(await save(wb, r));
    expect(saved.getRow(1).values).toEqual([undefined, 'Date']);
    expect(saved.getRow(2).values).toEqual([undefined, new Date(Date.UTC(2026, 11, 25))]);
  });
});

describe('Resources edited in the app — SPEC §4.4, §4.8', () => {
  /** Resources with a user column, an unreadable type and color, a repeated name and a row without a name. */
  function resourcesBook() {
    const wb = templateWith([
      { ID: 1, Task: 'A', 'Planned Duration': 1, Assigned: 'ACME' },
      { ID: 2, Task: 'B', 'Planned Duration': 1, Assigned: 'ThermCo' },
    ]);
    const ws = findSheet(wb, 'Resources')!;
    ws.getCell('D1').value = 'Contact';
    ws.addRow(['ACME', 'Contractor', '#2563EB', 'Khun A']);
    ws.addRow(['Refracto', null, null, 'Khun R']);
    ws.addRow(['ThermCo', 'Vendor', 'blue']);
    ws.addRow(['acme', 'Team', '#000000']);
    ws.addRow([null, 'Team', '#111111', 'spare']);
    return wb;
  }
  const sheet = (wb: Parameters<typeof findSheet>[0]) => findSheet(wb, 'Resources')!;

  it('unchanged: the sheet is not touched', async () => {
    const wb = resourcesBook();
    const before = values(sheet(await reload(resourcesBook())));
    expect(values(sheet(await save(wb)))).toEqual(before);
  });

  it('a renamed resource keeps its row, and so its other cells; the repeat of its old name is emptied', async () => {
    const wb = resourcesBook();
    const r = read(wb);
    // As Settings › Resources does: the resource and every task that has it (store/settings.ts)
    const rename = (from: string, to: string) => {
      r.plan.resources = r.plan.resources.map((res) => (res.name === from ? { ...res, name: to } : res));
      r.plan.tasks = r.plan.tasks.map((t) => ({ ...t, assigned: t.assigned.map((a) => (a === from ? to : a)) }));
    };
    rename('ACME', 'ACME Corp');
    const once = await save(wb, r);
    const ws = sheet(once);
    expect(ws.getRow(2).values).toEqual([undefined, 'ACME Corp', 'Contractor', '#2563EB', 'Khun A']);
    expect(ws.getRow(5).values).toEqual([]); // "acme" repeated the old name
    expect(ws.getRow(6).values).toEqual([undefined, undefined, 'Team', '#111111', 'spare']); // no name: left alone
    expect(read(once).plan.resources.map((res) => res.name)).toEqual(['ACME Corp', 'Refracto', 'ThermCo']);
    // Saved again in the same session (the row now holds the new name), and renamed once more
    expect(values(sheet(await save(once, r)))).toEqual(values(ws));
    rename('ACME Corp', 'ACME Group');
    expect(sheet(await save(once, r)).getRow(2).values).toEqual([undefined, 'ACME Group', 'Contractor', '#2563EB', 'Khun A']);
  });

  it('Type and Color: written when set in the app; text the app can’t read stays until then', async () => {
    const wb = resourcesBook();
    const r = read(wb);
    r.plan.resources = r.plan.resources.map((res) =>
      res.name === 'Refracto' ? { ...res, type: 'Team' as const } : res.name === 'ThermCo' ? { ...res, type: 'Person' as const } : res,
    );
    const ws = sheet(await save(wb, r));
    expect(ws.getRow(3).values).toEqual([undefined, 'Refracto', 'Team', undefined, 'Khun R']);
    expect(ws.getRow(4).values).toEqual([undefined, 'ThermCo', 'Person', 'blue']);
  });

  it('a removed resource’s row loses its name, type and color; a new one goes below the last row', async () => {
    const wb = resourcesBook();
    const r = read(wb);
    r.plan.resources = [...r.plan.resources.filter((res) => res.name !== 'Refracto'), { name: 'NewCo', color: '#0891B2' }, { name: 'Spare crew' }];
    const ws = sheet(await save(wb, r));
    expect(ws.getRow(3).values).toEqual([undefined, undefined, undefined, undefined, 'Khun R']);
    expect(ws.getRow(7).values).toEqual([undefined, 'NewCo', undefined, '#0891B2']);
    expect(ws.getRow(8).values).toEqual([undefined, 'Spare crew', undefined, RESOURCE_PALETTE[3]]); // 4th listed name
  });

  it('a removal saved, then undone and saved again, puts the resource back in its own row', async () => {
    const wb = resourcesBook();
    const r = read(wb);
    const all = r.plan.resources;
    r.plan.resources = all.filter((res) => res.name !== 'Refracto');
    const removed = await save(wb, r);
    expect(sheet(removed).getRow(3).values).toEqual([undefined, undefined, undefined, undefined, 'Khun R']);
    r.plan.resources = all; // Undo
    const back = await save(removed, r);
    expect(sheet(back).getRow(3).values).toEqual([undefined, 'Refracto', undefined, undefined, 'Khun R']);
    expect(read(back).plan.resources.map((res) => res.name)).toEqual(['ACME', 'Refracto', 'ThermCo']);
  });

  it('written into a blank template (recovery), resources keep their order without gaps', () => {
    const r = read(resourcesBook());
    const blank = createTemplate();
    writePlan(blank, r.plan, computePlan(r.plan), r.layout, NOW);
    expect(sheet(blank).getColumn(1).values.slice(2)).toEqual(['ACME', 'Refracto', 'ThermCo']);
  });
});
