import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toArrayBuffer } from '../../scripts/fixtures';
import { computePlan } from '../../src/engine/compute';
import { loadWorkbook } from '../../src/excel/exceljs';
import { readPlan } from '../../src/excel/read';
import { download } from '../../src/io/download';
import { pickersBlocked } from '../../src/io/fileAccess';
import { editTask } from '../../src/store/edit';
import { askNewPlan, createPlan, openPicked, openSample, sameFileText, save, saveAs } from '../../src/store/files';
import { CLOSED, closeView, openIssues, openPrint, openReport, syncView, useStore, viewOfHash, type FileSession } from '../../src/store/store';
import { undo } from '../../src/store/undo';
import { sampleWorkbook } from '../excel/helpers';

// Save, Save as and their races (SPEC §3.4, §3.5, §7.11) against fake file handles.
const io = vi.hoisted(() => ({ canSaveInPlace: false }));
vi.mock('../../src/io/fileAccess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/io/fileAccess')>();
  return {
    ...actual,
    get canSaveInPlace() {
      return io.canSaveInPlace;
    },
  };
});
vi.mock('../../src/io/download', () => ({ download: vi.fn() }));
vi.mock('../../src/io/recent', () => ({ loadRecent: async () => null, saveRecent: async () => undefined, forgetRecent: async () => undefined }));

const state = () => useStore.getState();
const TODAY = '2026-10-30';

/** A file handle whose close() waits for `release()`, as a slow OneDrive write does. */
function fakeHandle(name = 'plan.xlsx', options: { lastModified?: number; getFile?: () => Promise<{ lastModified: number }> } = {}) {
  let lastModified = options.lastModified ?? 100;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const written: Uint8Array[] = [];
  const handle = {
    name,
    getFile: options.getFile ?? (async () => ({ name, lastModified })),
    createWritable: async () => ({
      write: async (data: Uint8Array) => void written.push(data),
      close: async () => {
        await gate;
        lastModified += 1;
      },
      abort: async () => undefined,
    }),
    queryPermission: async () => 'granted',
    isSameEntry: async (other: unknown) => other === handle,
  };
  /** What Chromium's save picker does to the file it returns: creates or empties it. */
  const truncate = () => {
    written.length = 0;
    lastModified += 1;
  };
  return { handle: handle as unknown as FileSystemFileHandle, written, release, truncate };
}

/** A save picker that returns `f`, emptied first as Chromium does. */
const pickerFor = (f: ReturnType<typeof fakeHandle>) =>
  vi.fn(async () => {
    f.truncate();
    return f.handle;
  });

/** The sample as an open file with `handle`, nothing to save. */
async function openWith(handle: FileSystemFileHandle | undefined, file: Partial<FileSession> = {}) {
  const workbook = await sampleWorkbook();
  const read = readPlan(workbook, TODAY);
  useStore.setState({
    ...CLOSED,
    plan: read.plan,
    result: computePlan(read.plan),
    file: { name: handle?.name ?? 'plan.xlsx', handle, lastModified: 100, workbook, layout: read.layout, unsupported: [], ...file },
    cleanPlan: read.plan,
    session: state().session + 1,
  });
}

const writtenPlan = async (bytes: Uint8Array) => readPlan(await loadWorkbook(toArrayBuffer(bytes)), TODAY).plan;

beforeEach(() => {
  io.canSaveInPlace = false;
  vi.mocked(download).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Save marks exactly the plan it wrote as saved — SPEC §3.4, §7.11', () => {
  it('an edit made while the file is being written stays unsaved', async () => {
    const f = fakeHandle();
    await openWith(f.handle);
    const written = state().plan!;
    const saving = save();
    await vi.waitFor(() => expect(f.written).toHaveLength(1));
    editTask(1, 'name', 'Edited during save');
    f.release();
    await saving;
    expect(state()).toMatchObject({ busy: null, dirty: true, cleanPlan: written });
    expect(state().savedAt).not.toBeNull();
    expect((await writtenPlan(f.written[0]!)).tasks[0]!.name).toBe(written.tasks[0]!.name);
    undo(); // back to the plan in the file
    expect(state().dirty).toBe(false);
  });

  it('nothing edited meanwhile → clean, with the new conflict baseline', async () => {
    const f = fakeHandle();
    await openWith(f.handle);
    editTask(1, 'name', 'Renamed');
    const saving = save();
    f.release();
    await saving;
    expect(state()).toMatchObject({ busy: null, dirty: false, cleanPlan: state().plan });
    expect(state().file?.lastModified).toBe(101);
  });
});

describe('a running save keeps its file — SPEC §3.5', () => {
  it('Open, Try sample and New plan wait for it, with a toast and no discard prompt', async () => {
    const f = fakeHandle();
    await openWith(f.handle);
    editTask(1, 'name', 'Edited');
    const saving = save();
    for (const action of [openSample, openPicked, askNewPlan]) {
      useStore.setState({ toast: null });
      action();
      expect(state().toast?.message).toBe('Wait for the save to finish');
      expect(state().dialog).toBeNull();
    }
    createPlan({ name: 'Other', owner: '', projectStart: '2026-11-02' });
    expect(state().file?.name).toBe('plan.xlsx');
    f.release();
    await saving;
    expect(state()).toMatchObject({ busy: null, dirty: false });
  });

  it('a save that ends after another plan was opened changes nothing on that plan', async () => {
    const a = fakeHandle('a.xlsx');
    await openWith(a.handle);
    const saving = save();
    await vi.waitFor(() => expect(a.written).toHaveLength(1));
    await openWith(fakeHandle('b.xlsx').handle, { lastModified: 5000, unsupported: ['charts'] });
    useStore.setState({ dirty: true, cleanPlan: null });
    a.release();
    await saving;
    expect(state().file).toMatchObject({ name: 'b.xlsx', lastModified: 5000, unsupported: ['charts'] });
    expect(state()).toMatchObject({ dirty: true, savedAt: null, dialog: null });
  });
});

describe('save failures say what happened — SPEC §3.5', () => {
  it('file moved, renamed or deleted → "missing" with the error; logged', async () => {
    const f = fakeHandle('plan.xlsx', {
      getFile: async () => {
        throw new DOMException('A requested file or directory could not be found.', 'NotFoundError');
      },
    });
    await openWith(f.handle);
    editTask(1, 'name', 'Edited');
    await save();
    expect(state().dialog).toEqual({ kind: 'missing', detail: 'NotFoundError: A requested file or directory could not be found.' });
    expect(state().busy).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it('the conflict check can’t read the file (OneDrive offline) → "unreadable", not the locked-file dialog; nothing written', async () => {
    const f = fakeHandle('plan.xlsx', {
      getFile: async () => {
        throw new DOMException('The file could not be read.', 'NotReadableError');
      },
    });
    await openWith(f.handle);
    editTask(1, 'name', 'Edited');
    await save();
    expect(state().dialog).toEqual({ kind: 'unreadable', detail: 'NotReadableError: The file could not be read.' });
    expect(state()).toMatchObject({ busy: null, dirty: true });
    expect(f.written).toEqual([]);
  });

  it('the workbook can’t be built → "buildFailed"; nothing written', async () => {
    const f = fakeHandle();
    await openWith(f.handle);
    vi.spyOn(state().file!.workbook.xlsx, 'writeBuffer').mockRejectedValue(new Error('zip broke'));
    await save();
    expect(state().dialog).toEqual({ kind: 'buildFailed', detail: 'zip broke' });
    expect(f.written).toEqual([]);
  });

  it('the write throws (file open in Excel) → the locked-file dialog, with the error as detail', async () => {
    const f = fakeHandle();
    f.handle.createWritable = async () => {
      throw new DOMException('The file is in use', 'NoModificationAllowedError');
    };
    await openWith(f.handle);
    await save();
    expect(state().dialog).toEqual({ kind: 'failed', detail: 'NoModificationAllowedError: The file is in use' });
  });
});

describe('Save a copy… — SPEC §3.5', () => {
  beforeEach(() => {
    io.canSaveInPlace = true;
  });

  it('suggests "<name> (copy).xlsx"; the open file picked anyway (already emptied) gets the plan, and a toast says so', async () => {
    const f = fakeHandle();
    await openWith(f.handle, { unsupported: ['charts'] });
    editTask(1, 'name', 'Edited');
    const plan = state().plan!;
    const showSaveFilePicker = pickerFor(f);
    vi.stubGlobal('window', { showSaveFilePicker });
    f.release();
    await saveAs({ copy: true });
    expect(showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'plan (copy).xlsx' }));
    expect(f.written).toHaveLength(1);
    expect((await writtenPlan(f.written[0]!)).tasks[0]!.name).toBe('Edited');
    expect(state()).toMatchObject({ busy: null, dirty: false, cleanPlan: plan, dialog: null });
    expect(state().file).toMatchObject({ name: 'plan.xlsx', handle: f.handle, unsupported: [] });
    expect(state().toast?.message).toBe(
      "You chose plan.xlsx itself, so your plan was saved there. Saving removed charts from it, which Gantt Planner can't keep.",
    );
  });

  it('the copy becomes the open file; "Saving…" only once a file is picked', async () => {
    const f = fakeHandle();
    const copy = fakeHandle('plan (copy).xlsx');
    await openWith(f.handle);
    let pick!: (h: FileSystemFileHandle) => void;
    vi.stubGlobal('window', { showSaveFilePicker: () => new Promise((resolve) => (pick = resolve)) });
    const saving = saveAs({ copy: true });
    expect(state().busy).toBeNull(); // still choosing a folder
    pick(copy.handle);
    await vi.waitFor(() => expect(copy.written).toHaveLength(1));
    expect(state().busy).toBe('saving');
    copy.release();
    await saving;
    expect(state().file).toMatchObject({ name: 'plan (copy).xlsx', handle: copy.handle, lastModified: 101 });
    expect(state()).toMatchObject({ busy: null, dirty: false, recent: copy.handle });
  });

  it('More › Save as… onto the open file (already emptied) writes the plan there; a toast says what was removed', async () => {
    const f = fakeHandle();
    await openWith(f.handle, { unsupported: ['charts', 'pivot tables'] });
    vi.stubGlobal('window', { showSaveFilePicker: pickerFor(f) });
    f.release();
    await saveAs();
    expect(f.written).toHaveLength(1);
    expect((await writtenPlan(f.written[0]!)).tasks).toHaveLength(state().plan!.tasks.length);
    expect(state()).toMatchObject({ busy: null, dirty: false, dialog: null });
    expect(state().toast?.message).toBe("Saving removed charts and pivot tables from plan.xlsx, which Gantt Planner can't keep.");
  });

  it('the toast: nothing to tell for a plain Save as… onto the open file; a copy onto it always says so', () => {
    expect(sameFileText('plan.xlsx', false, [])).toBeNull();
    expect(sameFileText('plan.xlsx', true, [])).toBe('You chose plan.xlsx itself, so your plan was saved there.');
  });
});

describe('fallback: Save downloads — SPEC §3.5', () => {
  it('downloads "<same name>.xlsx"; the download becomes the open file', async () => {
    createPlan({ name: 'Pump station', owner: '', projectStart: '2026-11-02' });
    await save();
    expect(download).toHaveBeenCalledWith('Pump station.xlsx', expect.any(Uint8Array));
    expect(state()).toMatchObject({ busy: null, dirty: false });
    expect(state().savedAt).not.toBeNull();
    expect(state().file?.handle).toBeUndefined();
  });

  it('a build error shows the error and clears "Saving…"', async () => {
    createPlan({ name: 'Pump station', owner: '', projectStart: '2026-11-02' });
    vi.spyOn(state().file!.workbook.xlsx, 'writeBuffer').mockRejectedValue(new Error('zip broke'));
    await save();
    expect(state()).toMatchObject({ busy: null, dirty: true, dialog: { kind: 'error', title: "Couldn't save the file", message: 'zip broke' } });
    expect(download).not.toHaveBeenCalled();
  });
});

describe('the report and Print Gantt are routes — SPEC §9.1, §9.4', () => {
  it('opening one sets its hash; the hash sets the view while a plan is open; Back leaves it', () => {
    const back = vi.fn();
    vi.stubGlobal('location', { hash: '' });
    vi.stubGlobal('history', { back });
    createPlan({ name: 'Pump station', owner: '', projectStart: '2026-11-02' });
    useStore.setState({ drawerId: 1, panel: 'issues' });
    openPrint();
    expect(location.hash).toBe('#print');
    expect(state()).toMatchObject({ drawerId: null, panel: null });
    syncView();
    expect(state().view).toBe('print');
    closeView();
    expect(back).toHaveBeenCalledTimes(1);
    expect(state().view).toBe('main');
    openReport();
    syncView();
    expect(state().view).toBe('report');
    location.hash = '#other';
    syncView();
    expect(state().view).toBe('main');
    expect([viewOfHash('#report'), viewOfHash('#print'), viewOfHash('')]).toEqual(['report', 'print', undefined]);
  });
});

describe('a new plan leaves the report — SPEC §9.1', () => {
  it('New plan from the report shows the main view; Review from the report goes back to it too', () => {
    const back = vi.fn();
    vi.stubGlobal('location', { hash: '#report' });
    vi.stubGlobal('history', { back });
    useStore.setState({ view: 'report' });
    createPlan({ name: 'Next', owner: '', projectStart: '2026-11-02' });
    expect(state().view).toBe('main');
    expect(back).toHaveBeenCalledTimes(1);
    useStore.setState({ view: 'report' });
    openIssues('problems');
    expect(state()).toMatchObject({ view: 'main', panel: 'issues' });
  });
});

// Last: a blocked picker leaves the module in download mode.
describe('the browser blocks the save picker (e.g. policy) — SPEC §3.5', () => {
  it('Save as… falls back to a download', async () => {
    io.canSaveInPlace = true;
    createPlan({ name: 'Pump station', owner: '', projectStart: '2026-11-02' });
    vi.stubGlobal('window', {
      showSaveFilePicker: async () => {
        throw new DOMException('blocked', 'NotAllowedError');
      },
    });
    useStore.setState({ fallback: false });
    await save();
    expect(download).toHaveBeenCalledWith('Pump station.xlsx', expect.any(Uint8Array));
    expect(pickersBlocked()).toBe(true);
    expect(state()).toMatchObject({ busy: null, dirty: false, fallback: true }); // the banner and the file chip say so
  });
});
