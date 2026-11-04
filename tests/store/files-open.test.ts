import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import { newWorkbook, workbookBytes } from '../../src/excel/exceljs';
import { emptyLayout } from '../../src/excel/read';
import { createTemplate } from '../../src/excel/template';
import { forgetRecent } from '../../src/io/recent';
import { sampleData } from '../../src/sample/sampleData';
import { notXlsxText, openDropped, openPicked, openRecent, openSample } from '../../src/store/files';
import { CLOSED, useStore } from '../../src/store/store';
import { downloadHint } from '../../src/ui/header/Header';

// Opening files (SPEC §3.5, §7.10, §7.11): Reopen, drop, and the "Opening…" state.
vi.mock('../../src/io/recent', () => ({ loadRecent: async () => null, saveRecent: vi.fn(async () => undefined), forgetRecent: vi.fn(async () => undefined) }));

const state = () => useStore.getState();
const template = async () => new File([await workbookBytes(createTemplate())], 'plan.xlsx', { lastModified: 100 });

/** A remembered handle: `permission` after the prompt, `read` = what getFile does. */
function recentHandle(read: () => Promise<File>, permission: PermissionState = 'granted') {
  return {
    name: 'plan.xlsx',
    getFile: read,
    queryPermission: async () => 'prompt',
    requestPermission: async () => permission,
  } as unknown as FileSystemFileHandle;
}

const fail = (name: string) => async (): Promise<File> => {
  throw new DOMException('', name);
};

beforeEach(() => {
  useStore.setState({ ...CLOSED, recent: null, view: 'main' });
  vi.mocked(forgetRecent).mockClear();
});

describe('Reopen <file> — SPEC §3.5', () => {
  it('file moved, renamed or deleted (NotFoundError) → forgotten, and the message says so', async () => {
    useStore.setState({ recent: recentHandle(fail('NotFoundError')) });
    openRecent();
    await vi.waitFor(() => expect(state().dialog).not.toBeNull());
    expect(state().dialog).toMatchObject({ kind: 'error', title: "Couldn't find plan.xlsx" });
    expect(state()).toMatchObject({ recent: null, busy: null });
    expect(forgetRecent).toHaveBeenCalled();
  });

  it('a temporary read error (OneDrive offline or syncing) → the error, and the link stays', async () => {
    const recent = recentHandle(fail('NotReadableError'));
    useStore.setState({ recent });
    openRecent();
    await vi.waitFor(() => expect(state().dialog).not.toBeNull());
    expect(state().dialog).toMatchObject({ kind: 'error', title: "Couldn't reopen plan.xlsx" });
    expect(state().dialog).not.toMatchObject({ message: expect.stringContaining('moved') });
    expect(state()).toMatchObject({ recent, busy: null });
    expect(forgetRecent).not.toHaveBeenCalled();
  });

  it('permission refused → a toast says why nothing opened; the link stays', async () => {
    const recent = recentHandle(template, 'denied');
    useStore.setState({ recent });
    openRecent();
    await vi.waitFor(() => expect(state().toast).not.toBeNull());
    expect(state().toast).toMatchObject({ message: expect.stringContaining('needs your permission to open plan.xlsx'), action: { label: 'Open…' } });
    expect(state()).toMatchObject({ recent, dialog: null, busy: null, plan: null });
  });

  it('granted → "Opening plan.xlsx…" while the file is read, then the plan opens', async () => {
    let read!: (file: File) => void;
    useStore.setState({ recent: recentHandle(() => new Promise((resolve) => (read = resolve))) });
    openRecent();
    await vi.waitFor(() => expect(state().busy).toBe('opening'));
    expect(state().opening).toBe('plan.xlsx');
    read(await template());
    await vi.waitFor(() => expect(state().plan).not.toBeNull());
    expect(state()).toMatchObject({ busy: null, opening: null });
    expect(state().file?.name).toBe('plan.xlsx');
  });
});

describe('load report — SPEC §7.11', () => {
  it('no Tasks sheet → the toast says so instead of the counts, and Review opens Problems', async () => {
    const wb = newWorkbook();
    wb.addWorksheet('Schedule').getCell('A1').value = 'Task';
    const file = new File([await workbookBytes(wb)], 'schedule.xlsx', { lastModified: 100 });
    useStore.setState({ recent: recentHandle(async () => file) });
    openRecent();
    await vi.waitFor(() => expect(state().plan).not.toBeNull());
    const issue = state().readIssues.find((i) => i.code === 'W_NO_TASKS_SHEET');
    expect(state().toast?.message).toBe(issue?.message);
    state().toast?.action?.run();
    expect(state()).toMatchObject({ panel: 'issues', issuesTab: 'problems' });
  });
});

describe('while a file opens — SPEC §7.11', () => {
  it('other file actions wait, with a toast', () => {
    useStore.setState({ busy: 'opening', opening: 'big.xlsx' });
    openSample();
    expect(state().toast?.message).toBe('Wait for the file to open');
    expect(state()).toMatchObject({ busy: 'opening', opening: 'big.xlsx' });
  });
});

/** A drop of `names` (contents irrelevant: nothing is read until a single workbook is chosen). */
function drop(...names: string[]): DataTransfer {
  const files = names.map((name) => new File(['x'], name));
  return { items: files.map((file) => ({ kind: 'file', getAsFile: () => file })), files } as unknown as DataTransfer;
}

describe('drop to open — SPEC §3.5', () => {
  beforeEach(() => {
    useStore.setState({ plan: sampleData, result: computePlan(sampleData), dirty: true });
  });

  it('no workbook dropped → says so, without first asking to discard unsaved changes', () => {
    openDropped(drop('report.pdf'));
    expect(state().dialog).toEqual({ kind: 'error', title: "Can't open report.pdf", message: notXlsxText('report.pdf') });
    expect(state().plan).toBe(sampleData);
  });

  it('several workbooks → "Drop one workbook at a time"', () => {
    openDropped(drop('a.xlsx', 'b.xlsx'));
    expect(state().dialog).toMatchObject({ kind: 'error', title: 'Drop one workbook at a time' });
  });

  it('a workbook with its PDF report → the usual unsaved-changes prompt for the workbook', () => {
    openDropped(drop('plan.pdf', 'plan.xlsx'));
    expect(state().dialog?.kind).toBe('discard');
  });

  it('dropped while saving → waits, with a toast', () => {
    useStore.setState({ busy: 'saving' });
    openDropped(drop('plan.xlsx'));
    expect(state().toast?.message).toBe('Wait for the save to finish');
    expect(state()).toMatchObject({ busy: 'saving', dialog: null });
  });

  it('Excel’s other formats get a Save As hint', () => {
    expect(notXlsxText('old.xls')).toContain('Save As › Excel Workbook (.xlsx)');
    expect(notXlsxText('report.pdf')).toBe('Gantt Planner opens Excel workbooks (.xlsx) only.');
  });
});

// Last: a blocked picker leaves the module in fallback mode.
describe('the browser blocks the open picker (e.g. policy) — SPEC §3.5', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fallback mode from then on, so the start screen and the file chip say Save downloads; the error offers a new click', async () => {
    useStore.setState({ fallback: false });
    vi.stubGlobal('window', {
      showOpenFilePicker: async () => {
        throw new DOMException('blocked', 'NotAllowedError');
      },
    });
    openPicked();
    await vi.waitFor(() => expect(state().dialog).not.toBeNull());
    expect(state().dialog).toMatchObject({ kind: 'error', title: "Couldn't open the file", action: { label: 'Choose file…' } });
    expect(state().fallback).toBe(true);
    // A plan opened through <input type="file"> has no handle: until the first download, the chip says where Save goes.
    useStore.setState({ plan: sampleData, file: { name: 'plan.xlsx', workbook: newWorkbook(), layout: emptyLayout(), unsupported: [] }, dialog: null });
    expect(downloadHint(state())).toBe(true);
    useStore.setState({ savedAt: new Date() });
    expect(downloadHint(state())).toBe(false);
  });
});
