import { describe, expect, it } from 'vitest';
import { toArrayBuffer } from '../../scripts/fixtures';
import { computePlan } from '../../src/engine/compute';
import { loadWorkbook } from '../../src/excel/exceljs';
import { readPlan } from '../../src/excel/read';
import { sampleData } from '../../src/sample/sampleData';
import { recoveryBytes } from '../../src/store/files';
import { sampleWorkbook } from '../excel/helpers';

const reopen = async (bytes: Uint8Array<ArrayBuffer>) => loadWorkbook(toArrayBuffer(bytes));

describe('Download my data as .xlsx — SPEC §10', () => {
  it('without a workbook: a blank template with the whole plan, holidays and resources included', async () => {
    const plan = { ...sampleData, tasks: sampleData.tasks.map((t) => (t.id === 5 ? { ...t, name: 'ถอดเทอร์โมเวลล์' } : t)) };
    const back = readPlan(await reopen(await recoveryBytes(plan, null)), '2026-10-30').plan;
    expect(back.tasks.map((t) => [t.id, t.name, t.assigned])).toEqual(plan.tasks.map((t) => [t.id, t.name, t.assigned]));
    expect(back.holidays).toEqual(plan.holidays);
    expect(back.resources.map((r) => r.name)).toEqual(plan.resources.map((r) => r.name));
    expect(computePlan(back).tasks).toEqual(computePlan(plan).tasks);
  });

  it('with the opened workbook: written into it, so its other sheets come along', async () => {
    const wb = await sampleWorkbook();
    const read = readPlan(wb, '2026-10-30');
    wb.addWorksheet('My notes').getCell('A1').value = 'keep me';
    const plan = { ...read.plan, tasks: read.plan.tasks.slice(0, 20) };
    const back = await reopen(await recoveryBytes(plan, { name: 'plan.xlsx', workbook: wb, layout: read.layout, unsupported: [] }));
    expect(back.getWorksheet('My notes')?.getCell('A1').value).toBe('keep me');
    expect(readPlan(back, '2026-10-30').plan.tasks).toHaveLength(20);
  });
});
