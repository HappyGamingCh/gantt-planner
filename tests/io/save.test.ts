import { describe, expect, it, vi } from 'vitest';
import { saveToHandle, type SaveTarget } from '../../src/io/fileAccess';

// The save flow of SPEC §3.5 against a fake file handle.
function fakeFile(options: { lastModified?: number; permission?: PermissionState; grant?: PermissionState; failOn?: 'write' | 'close' } = {}) {
  let lastModified = options.lastModified ?? 100;
  let permission = options.permission ?? 'granted';
  const written: Uint8Array[] = [];
  const calls: string[] = [];
  const handle: SaveTarget = {
    getFile: async () => ({ lastModified }),
    createWritable: async () => ({
      write: async (data) => {
        calls.push('write');
        if (options.failOn === 'write') throw new DOMException('locked', 'NoModificationAllowedError');
        written.push(data);
      },
      close: async () => {
        calls.push('close');
        if (options.failOn === 'close') throw new DOMException('locked', 'InvalidStateError');
        lastModified += 1;
      },
      abort: async () => {
        calls.push('abort');
      },
    }),
    queryPermission: async () => permission,
    requestPermission: async () => {
      calls.push('request');
      permission = options.grant ?? permission;
      return permission;
    },
  };
  return { handle, written, calls };
}

const bytes = new Uint8Array([1, 2, 3]);

describe('saveToHandle', () => {
  it('writes and returns the new lastModified', async () => {
    const f = fakeFile();
    const build = vi.fn(async () => bytes);
    expect(await saveToHandle(f.handle, build, 100)).toEqual({ kind: 'saved', lastModified: 101 });
    expect(f.written).toEqual([bytes]);
    expect(f.calls).toEqual(['write', 'close']);
  });

  it('asks for write permission first; refused → denied, nothing built or written', async () => {
    const f = fakeFile({ permission: 'prompt', grant: 'denied' });
    const build = vi.fn(async () => bytes);
    expect(await saveToHandle(f.handle, build, 100)).toEqual({ kind: 'denied' });
    expect(f.calls).toEqual(['request']);
    expect(build).not.toHaveBeenCalled();
  });

  it('granted on request → saves', async () => {
    const f = fakeFile({ permission: 'prompt', grant: 'granted' });
    expect((await saveToHandle(f.handle, async () => bytes, 100)).kind).toBe('saved');
  });

  it('file changed since it was opened → conflict, nothing written; Overwrite skips the check', async () => {
    const f = fakeFile({ lastModified: 200 });
    expect(await saveToHandle(f.handle, async () => bytes, 100)).toEqual({ kind: 'conflict' });
    expect(f.written).toEqual([]);
    expect((await saveToHandle(f.handle, async () => bytes, undefined)).kind).toBe('saved');
  });

  it.each(['write', 'close'] as const)('write fails at %s (file open in Excel) → failed, stream aborted', async (failOn) => {
    const f = fakeFile({ failOn });
    const outcome = await saveToHandle(f.handle, async () => bytes, 100);
    expect(outcome.kind).toBe('failed');
    expect(f.calls.at(-1)).toBe('abort');
  });
});

describe('saveToHandle — each step has its own outcome (§3.5, §17)', () => {
  const notFound = () => new DOMException('A requested file or directory could not be found', 'NotFoundError');

  it('file moved, renamed or deleted (conflict check) → missing; nothing built or written', async () => {
    const f = fakeFile();
    f.handle.getFile = async () => {
      throw notFound();
    };
    const build = vi.fn(async () => bytes);
    expect((await saveToHandle(f.handle, build, 100)).kind).toBe('missing');
    expect(build).not.toHaveBeenCalled();
    expect(f.written).toEqual([]);
  });

  it('the conflict check can’t read the file (OneDrive offline) → unreadable, not the locked file; nothing written', async () => {
    const f = fakeFile();
    const error = new DOMException('The file could not be read', 'NotReadableError');
    f.handle.getFile = async () => {
      throw error;
    };
    const build = vi.fn(async () => bytes);
    expect(await saveToHandle(f.handle, build, 100)).toEqual({ kind: 'unreadable', error });
    expect(build).not.toHaveBeenCalled();
    expect(f.written).toEqual([]);
  });

  it('file gone when the write starts (Overwrite skips the check) → missing', async () => {
    const f = fakeFile();
    f.handle.createWritable = async () => {
      throw notFound();
    };
    expect((await saveToHandle(f.handle, async () => bytes, undefined)).kind).toBe('missing');
  });

  it('the workbook can’t be built → buildFailed with the error; the file is never opened for writing', async () => {
    const f = fakeFile();
    const error = new TypeError('writePlan broke');
    const outcome = await saveToHandle(
      f.handle,
      async () => {
        throw error;
      },
      100,
    );
    expect(outcome).toEqual({ kind: 'buildFailed', error });
    expect(f.calls).toEqual([]);
  });

  it('the permission request throws (no click left) → denied, so "Try again" brings a new click', async () => {
    const f = fakeFile({ permission: 'prompt' });
    f.handle.requestPermission = async () => {
      throw new DOMException('User activation is required', 'SecurityError');
    };
    expect(await saveToHandle(f.handle, async () => bytes, 100)).toEqual({ kind: 'denied' });
  });

  it('written, but the file can’t be read back → saved with an unknown baseline (-1): the next save asks first', async () => {
    const f = fakeFile();
    let reads = 0;
    f.handle.getFile = async () => {
      if (++reads > 1) throw new DOMException('busy', 'NotReadableError');
      return { lastModified: 100 };
    };
    expect(await saveToHandle(f.handle, async () => bytes, 100)).toEqual({ kind: 'saved', lastModified: -1 });
    expect(f.written).toEqual([bytes]);
  });
});
