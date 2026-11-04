import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickersBlocked, saveAs } from '../../src/io/fileAccess';

// Save as… and the pickers (SPEC §3.5) against a fake window and fake file handles.
function fakeHandle(name: string) {
  const written: Uint8Array[] = [];
  const handle = {
    name,
    getFile: async () => ({ name, lastModified: 7 }),
    createWritable: async () => ({
      write: async (data: Uint8Array) => void written.push(data),
      close: async () => undefined,
      abort: async () => undefined,
    }),
    isSameEntry: async (other: unknown) => other === handle,
  };
  return { handle: handle as unknown as FileSystemFileHandle, written };
}

const bytes = new Uint8Array([1, 2, 3]);
const picker = (result: () => Promise<FileSystemFileHandle>) => {
  const showSaveFilePicker = vi.fn(result);
  vi.stubGlobal('window', { showSaveFilePicker, showOpenFilePicker: vi.fn(result) });
  return showSaveFilePicker;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveAs', () => {
  it('suggests the name, then builds and writes the picked file', async () => {
    const target = fakeHandle('plan (copy).xlsx');
    const show = picker(async () => target.handle);
    const outcome = await saveAs('plan (copy).xlsx', async () => bytes);
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'plan (copy).xlsx' }));
    expect(outcome).toEqual({ kind: 'saved', handle: target.handle, lastModified: 7, same: false });
    expect(target.written).toEqual([bytes]);
  });

  it('picking the open file → still written (Chromium has already emptied it), flagged same', async () => {
    const open = fakeHandle('plan.xlsx');
    const other = fakeHandle('plan.xlsx');
    picker(async () => open.handle);
    expect(await saveAs('plan (copy).xlsx', async () => bytes, open.handle)).toEqual({ kind: 'saved', handle: open.handle, lastModified: 7, same: true });
    expect(open.written).toEqual([bytes]);
    expect(await saveAs('plan (copy).xlsx', async () => bytes, other.handle)).toMatchObject({ kind: 'saved', same: false });
  });

  it('cancelled picker → cancelled; any other picker error → failed, and the pickers still count as working', async () => {
    picker(async () => {
      throw new DOMException('', 'AbortError');
    });
    expect(await saveAs('plan.xlsx', async () => bytes)).toEqual({ kind: 'cancelled' });
    picker(async () => {
      throw new TypeError('odd');
    });
    expect((await saveAs('plan.xlsx', async () => bytes)).kind).toBe('failed');
    expect(pickersBlocked()).toBe(false);
  });

  it('one picker at a time: a second call while one is open (double click) does nothing', async () => {
    const target = fakeHandle('plan.xlsx');
    let pick!: (h: FileSystemFileHandle) => void;
    const show = picker(() => new Promise((resolve) => (pick = resolve)));
    const first = saveAs('plan.xlsx', async () => bytes);
    expect(await saveAs('plan.xlsx', async () => bytes)).toEqual({ kind: 'cancelled' });
    expect(show).toHaveBeenCalledTimes(1);
    pick(target.handle);
    expect((await first).kind).toBe('saved');
  });
});

// Last: once blocked, the module stays in fallback mode.
describe('pickers blocked by the browser (e.g. policy)', () => {
  it('Save as → blocked, and from then on saving downloads', async () => {
    picker(async () => {
      throw new DOMException('blocked', 'NotAllowedError');
    });
    expect(await saveAs('plan.xlsx', async () => bytes)).toEqual({ kind: 'blocked' });
    expect(pickersBlocked()).toBe(true);
  });

  it('Open → PickerBlockedError, so the app can offer a new click for <input type="file">', async () => {
    vi.stubGlobal('window', {
      showOpenFilePicker: async () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    // This module instance is already blocked (it would use <input type="file">, which needs a DOM): use a fresh one.
    vi.resetModules();
    const fresh = await import('../../src/io/fileAccess');
    await expect(fresh.pickFile()).rejects.toBeInstanceOf(fresh.PickerBlockedError);
    expect(fresh.pickersBlocked()).toBe(true);
  });
});
