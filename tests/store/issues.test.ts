import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { toArrayBuffer } from '../../scripts/fixtures';
import { makeIssue } from '../../src/engine/issues';
import type { Issue } from '../../src/engine/types';
import { loadWorkbook, newWorkbook, workbookBytes } from '../../src/excel/exceljs';
import { emptyLayout } from '../../src/excel/read';
import { deleteTasks, editTask, renumber } from '../../src/store/edit';
import { reload, save, saveAnyway } from '../../src/store/files';
import { changesUnsaved, problems } from '../../src/store/selectors';
import { CLOSED, useStore } from '../../src/store/store';
import { redo, undo } from '../../src/store/undo';
import { severityText } from '../../src/ui/issues/useProblems';
import { read, taskCell, templateWith } from '../excel/helpers';

// The Problems list (SPEC §7.11): reader problems stay only while they apply; the badge and the tab count the same.
const state = () => useStore.getState();
const shown = () => problems(state());
const find = (code: Issue['code']) => [...shown().list, ...shown().notes].find((i) => i.code === code);
/** What the reader finds in the file as the last Save left it. */
const savedCodes = async () => {
  const file = await state().file!.handle!.getFile();
  return read(await loadWorkbook(await file.arrayBuffer())).issues.map((i) => i.code);
};

/** A file handle over `bytes`, as the File System Access API gives one: Open reads it, Save writes into it (§3.5). */
function handleOver(name: string, bytes: ArrayBuffer): FileSystemFileHandle {
  let data = bytes;
  let lastModified = 100;
  const handle = {
    name,
    getFile: async () => new File([data], name, { lastModified }),
    createWritable: async () => ({
      write: async (written: Uint8Array<ArrayBuffer>) => {
        data = toArrayBuffer(written);
      },
      close: async () => {
        lastModified += 1;
      },
      abort: async () => undefined,
    }),
    queryPermission: async () => 'granted' as const,
  };
  return handle as unknown as FileSystemFileHandle;
}

/** Opens a workbook through the app's own open path (Reload uses it). */
async function open(name: string, bytes: ArrayBuffer) {
  useStore.setState({ ...CLOSED, file: { name, handle: handleOver(name, bytes), workbook: newWorkbook(), layout: emptyLayout(), unsupported: [] } });
  await reload();
  expect(state().plan).not.toBeNull();
}

const fixture = (name: string) => toArrayBuffer(readFileSync(join(import.meta.dirname, '../fixtures', name)));

describe('problems — counts (§7.4, §7.11)', () => {
  beforeEach(() => open('messy.xlsx', fixture('messy.xlsx')));

  it('the badge and the Problems tab count errors and warnings; information is listed apart as notes', () => {
    const { list, notes } = shown();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((i) => i.severity !== 'info')).toBe(true);
    expect(list.findIndex((i) => i.severity === 'warning')).toBe(list.filter((i) => i.severity === 'error').length); // errors first
    expect(notes.map((i) => i.code)).toContain('W_FORMULA');
    expect(notes.every((i) => i.severity === 'info')).toBe(true);
    // The load report counts the same problems.
    const errors = list.filter((i) => i.severity === 'error').length;
    expect(state().toast?.message).toContain(`${list.length - errors} warnings · ${errors} errors`);
  });

  it('the badge names the severities in words', () => {
    expect(severityText([makeIssue('E_CYCLE', { ids: '1, 2' }), makeIssue('W_NO_DURATION', { id: 3 }), makeIssue('W_100_NO_AF', { id: 4 })])).toBe(
      '1 error, 2 warnings',
    );
    expect(severityText([makeIssue('W_NO_DURATION', { id: 3 })])).toBe('1 warning');
  });
});

describe('problems the reader found stay only while they apply (§17)', () => {
  beforeEach(() => open('messy.xlsx', fixture('messy.xlsx')));

  it('the reader names the field it could not parse', () => {
    expect(find('W_BAD_DATE')).toMatchObject({ taskId: 17, field: 'actualStart' });
    expect(find('W_BAD_NUMBER')).toMatchObject({ taskId: 19, field: 'plannedDuration' });
  });

  it('go with their task when it is deleted; undo brings them back', () => {
    expect(find('W_UNTITLED')).toMatchObject({ taskId: 29 });
    deleteTasks([29], true);
    expect(find('W_UNTITLED')).toBeUndefined();
    undo();
    expect(find('W_UNTITLED')).toMatchObject({ taskId: 29 });
    redo();
    expect(find('W_UNTITLED')).toBeUndefined();
  });

  it('go when the user gives the field a value or names the task', () => {
    editTask(17, 'actualStart', '2026-09-28');
    expect(find('W_BAD_DATE')).toBeUndefined();
    editTask(29, 'name', 'Scaffold permit');
    expect(find('W_UNTITLED')).toBeUndefined();
    undo();
    expect(find('W_UNTITLED')).toBeDefined();
  });

  it('after Save: the duplicate ID, the untitled row and the formulas are fixed in the file; text the file keeps stays', async () => {
    expect(find('E_DUP_ID')).toBeDefined();
    expect(find('W_FORMULA')).toBeDefined();
    await save();
    expect(state().savedAt).not.toBeNull();
    expect(find('E_DUP_ID')).toBeUndefined();
    expect(find('W_UNTITLED')).toBeUndefined(); // saved as "(Untitled)"
    expect(find('W_FORMULA')).toBeUndefined(); // saved as values
    expect(find('W_BAD_DATE')).toMatchObject({ taskId: 17 }); // "next week" is written back
    expect(find('W_BAD_HOLIDAY')).toBeDefined(); // the app doesn't write Holidays
    expect(changesUnsaved(state())).toBe(false); // the file chip stops linking to Changes
  });
});

describe('reader problems follow their task (§17)', () => {
  it('Renumber: the message and the jump use the new ID; undo puts them back; a duplicate ID goes', async () => {
    const wb = templateWith([
      { ID: 5, Task: 'A', 'Actual Start': 'soon' },
      { ID: 2, Task: 'B' },
      { ID: 2, Task: 'C' },
    ]);
    await open('renumber.xlsx', toArrayBuffer(await workbookBytes(wb)));
    expect(find('W_BAD_DATE')).toMatchObject({ taskId: 5, message: 'Task 5: "soon" in Actual Start is not a date' });
    expect(find('E_DUP_ID')).toMatchObject({ taskId: 6 });
    renumber();
    expect(state().plan!.tasks.map((t) => [t.id, t.name])).toEqual([
      [1, 'A'],
      [2, 'B'],
      [3, 'C'],
    ]);
    expect(find('W_BAD_DATE')).toMatchObject({ taskId: 1, message: 'Task 1: "soon" in Actual Start is not a date' });
    expect(find('E_DUP_ID')).toBeUndefined();
    undo();
    expect(find('W_BAD_DATE')).toMatchObject({ taskId: 5, message: 'Task 5: "soon" in Actual Start is not a date' });
    expect(find('E_DUP_ID')).toMatchObject({ taskId: 6 });
  });

  it('Predecessors Excel made a number: listed while Save writes the cell back; retyped, it goes and the file agrees', async () => {
    const wb = templateWith([
      { ID: 1, Task: 'A' },
      { ID: 2, Task: 'B', Predecessors: 5120 },
    ]);
    taskCell(wb, 3, 'predecessors').numFmt = '#,##0'; // "5,120" typed in a General cell
    await open('pred.xlsx', toArrayBuffer(await workbookBytes(wb)));
    expect(find('W_PRED_NOT_TEXT')).toMatchObject({ taskId: 2 });
    await save(); // the number is written back as it is
    expect(find('W_PRED_NOT_TEXT')).toMatchObject({ taskId: 2 });
    expect(await savedCodes()).toContain('W_PRED_NOT_TEXT');
    editTask(2, 'predecessorsText', '1');
    expect(find('W_PRED_NOT_TEXT')).toBeUndefined();
    undo();
    expect(find('W_PRED_NOT_TEXT')).toMatchObject({ taskId: 2 });
    redo();
    await save();
    expect(find('W_PRED_NOT_TEXT')).toBeUndefined();
    expect(await savedCodes()).not.toContain('W_PRED_NOT_TEXT');
  });

  it('a bad Planned Finish (always recalculated) is listed until Save overwrites it', async () => {
    const wb = templateWith([{ ID: 1, Task: 'A', 'Planned Start': new Date(Date.UTC(2026, 10, 2)), 'Planned Duration': 2, 'Planned Finish': 'TBC' }]);
    await open('finish.xlsx', toArrayBuffer(await workbookBytes(wb)));
    expect(find('W_BAD_DATE')).toMatchObject({ taskId: 1, field: 'plannedFinish' });
    await save();
    expect(find('W_BAD_DATE')).toBeUndefined();
  });
});

describe('content Save removes (§3.5)', () => {
  it('the warning goes once the user saves anyway', async () => {
    await open('excel-chart.xlsx', fixture('excel-chart.xlsx'));
    expect(find('W_UNSUPPORTED_CONTENT')).toBeDefined();
    await save();
    expect(state().dialog?.kind).toBe('unsupported');
    expect(find('W_UNSUPPORTED_CONTENT')).toBeDefined();
    await saveAnyway();
    expect(state().savedAt).not.toBeNull();
    expect(find('W_UNSUPPORTED_CONTENT')).toBeUndefined();
  });
});
