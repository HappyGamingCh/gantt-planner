// Planned text Excel had that the app couldn't read survives the values the app derives after every edit (SPEC §4.8).
import { beforeEach, describe, expect, it } from 'vitest';
import { toArrayBuffer } from '../../scripts/fixtures';
import { loadWorkbook } from '../../src/excel/exceljs';
import { readPlan } from '../../src/excel/read';
import { editTask, setMode, setStatusDate } from '../../src/store/edit';
import { build } from '../../src/store/files';
import { useStore } from '../../src/store/store';
import { reload, taskCell, templateWith } from '../excel/helpers';
import { load, task } from './editHelpers';

const TODAY = '2026-10-30';

/** Plan mode: Planned Duration "สองวัน" on task 1, Planned Start "TBC" on task 2, task 3 untouched. */
beforeEach(async () => {
  const wb = await reload(
    templateWith([
      { ID: 1, Task: 'Erect scaffold', 'Planned Duration': 'สองวัน' },
      { ID: 2, Task: 'Open manhole', 'Planned Start': 'TBC', 'Planned Duration': 1 },
      { ID: 3, Task: 'Inspect', 'Planned Duration': 2 },
    ]),
  );
  const read = readPlan(wb, TODAY);
  load(read.plan);
  useStore.setState({ file: { name: 'plan.xlsx', workbook: wb, layout: read.layout, unsupported: [] } });
});

/** Save, reopen: what the cells hold. */
async function saved() {
  const wb = await loadWorkbook(toArrayBuffer(await build()));
  return { duration: taskCell(wb, 2, 'plannedDuration').value, start: taskCell(wb, 3, 'plannedStart').value };
}

describe('unparsed planned text', () => {
  it('is kept after an edit of another task, a status date change or a switch to Track', async () => {
    editTask(3, 'name', 'Inspect coil');
    setStatusDate('2026-11-06');
    expect(task(1).plannedDuration).toBeDefined(); // settle() stored the derived value…
    expect(await saved()).toEqual({ duration: 'สองวัน', start: 'TBC' }); // …but Save keeps the text
    setMode('Track');
    expect(await saved()).toEqual({ duration: 'สองวัน', start: 'TBC' });
  });

  it('is replaced by a value the user sets: the cell, Planned Finish, a bar drag', async () => {
    editTask(1, 'plannedFinish', '2026-11-04');
    expect(task(1).unparsed).toBeUndefined();
    editTask(2, 'plannedStart', '2026-11-05'); // a drag or a typed date
    const cells = await saved();
    expect(typeof cells.duration).toBe('number');
    expect(cells.start).toEqual(new Date(Date.UTC(2026, 10, 5)));
  });
});
