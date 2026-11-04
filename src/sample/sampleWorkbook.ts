// The sample as a workbook (SPEC §13): the template filled with the sample plan, written the way Save writes
// any plan. Used by "Try with sample data" and scripts/make-sample.ts.
import { computePlan } from '../engine/compute';
import type { Workbook } from '../excel/exceljs';
import { emptyLayout } from '../excel/read';
import { createTemplate } from '../excel/template';
import { writePlan } from '../excel/write';
import { sampleData } from './sampleData';

export const SAMPLE_FILE_NAME = 'sample-project.xlsx';

export function buildSampleWorkbook(now: Date): Workbook {
  const wb = createTemplate(sampleData.holidays);
  wb.created = now;
  writePlan(wb, sampleData, computePlan(sampleData), emptyLayout(), now);
  return wb;
}
