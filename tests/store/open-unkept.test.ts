import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workbookBytes } from '../../src/excel/exceljs';
import { openRecent } from '../../src/store/files';
import { CLOSED, useStore } from '../../src/store/store';
import { tasksSheet, templateWith } from '../excel/helpers';
import { patchZip } from '../excel/zip';

// Open (SPEC §3.5): what Save removes or converts is reported at load and asked about before the first Save.
vi.mock('../../src/io/recent', () => ({ loadRecent: async () => null, saveRecent: vi.fn(async () => undefined), forgetRecent: vi.fn(async () => undefined) }));

const state = () => useStore.getState();

/** Tasks 1–3 with Assigned merged on C2:C3, Tasks and Resources saved filtered by Excel, with a chart part. */
async function file(): Promise<File> {
  const wb = templateWith([1, 2, 3].map((id) => ({ ID: id, Task: `T${id}`, Assigned: id < 3 ? 'ACME' : 'NDT2', 'Planned Duration': 1 })));
  tasksSheet(wb).mergeCells('C2:C3');
  const bytes = patchZip(await workbookBytes(wb), {
    'xl/worksheets/sheet2.xml': (xml) =>
      xml.replace(/<autoFilter ref="([^"]+)"\/>/, '<autoFilter ref="$1"><filterColumn colId="2"><filters><filter val="NDT2"/></filters></filterColumn></autoFilter>'),
    'xl/worksheets/sheet3.xml': (xml) => xml.replace('<dimension', '<sheetPr filterMode="1"/><dimension'),
    'xl/charts/chart1.xml': () => '<c:chartSpace/>',
  });
  return new File([bytes], 'plan.xlsx', { lastModified: 100 });
}

beforeEach(() => {
  useStore.setState({ ...CLOSED, recent: null, view: 'main' });
});

describe('content Save removes or converts — SPEC §3.5', () => {
  it('is reported at load, and the first Save asks about all of it', async () => {
    const opened = await file();
    const handle = { name: 'plan.xlsx', getFile: async () => opened, queryPermission: async () => 'granted' } as unknown as FileSystemFileHandle;
    useStore.setState({ recent: handle });
    openRecent();
    await vi.waitFor(() => expect(state().plan).not.toBeNull());
    expect(state().readIssues.map((i) => i.message)).toEqual(
      expect.arrayContaining([
        `This file contains charts and the filter on sheet "Resources" (rows it hid stay hidden); Gantt Planner can't keep them, so saving will remove them`,
        'Merged cells in Tasks (C2:C3) will be split when you save; each task keeps its own value',
        "The Tasks sheet is filtered in Excel; Gantt Planner can't keep Excel filters, so saving shows every task row",
      ]),
    );
    expect(state().file).toMatchObject({
      unsupported: ['charts', 'the filter on sheet "Resources" (rows it hid stay hidden)', 'merged cells in Tasks (each task keeps its value)'],
      layout: { filtered: true },
    });
    expect(state().plan!.tasks.map((t) => t.assigned)).toEqual([['ACME'], ['ACME'], ['NDT2']]);
  });
});
