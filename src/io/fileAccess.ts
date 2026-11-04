// File access (SPEC §3.5): the File System Access API where the browser has it, so Save writes back to the
// same file; otherwise <input type="file"> to open and a download to save.

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PICKER = { types: [{ description: 'Excel workbook', accept: { [XLSX_MIME]: ['.xlsx'] } }], id: 'gantt-planner' };

/** True in Edge and Chrome: open, save in place and save as. False → fallback mode. */
export const canSaveInPlace =
  typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';

/** A file the user opened. `handle` is what Save writes back to; absent in fallback mode. */
export interface OpenedFile {
  name: string;
  bytes: ArrayBuffer;
  lastModified: number;
  handle?: FileSystemFileHandle;
}

export const isXlsxName = (name: string) => /\.xlsx$/i.test(name);

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';
/** The file is gone: moved, renamed or deleted since the handle was taken. */
export const isNotFound = (err: unknown) => err instanceof DOMException && err.name === 'NotFoundError';
/** A picker refused outright, e.g. File System Access blocked by browser policy. */
const isBlocked = (err: unknown) => err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');

let blocked = false;
/** True once the browser has refused a picker: from then on Open uses <input type="file"> and Save downloads. */
export const pickersBlocked = () => blocked;

let picking = false;
/**
 * Shows one picker at a time: a second one (a double click) would be refused with "File picker already active",
 * which must not count as blocked. `null` when a picker is already open.
 */
async function onePicker<T>(show: () => Promise<T>): Promise<T | null> {
  if (picking) return null;
  picking = true;
  try {
    return await show();
  } finally {
    picking = false;
  }
}

/** The open picker was refused; the click that asked for it is used up, so the user must click again. */
export class PickerBlockedError extends Error {
  constructor() {
    super('The browser blocked the file picker.');
    this.name = 'PickerBlockedError';
  }
}

/** Open picker; null when the user cancels. `onPicked` runs once a file is chosen, before it is read. */
export async function pickFile(onPicked?: (name: string) => void): Promise<OpenedFile | null> {
  if (!window.showOpenFilePicker || blocked) {
    const file = await pickWithInput();
    if (!file) return null;
    onPicked?.(file.name);
    return { name: file.name, bytes: await file.arrayBuffer(), lastModified: file.lastModified };
  }
  let handle: FileSystemFileHandle | undefined;
  try {
    [handle] = (await onePicker(() => window.showOpenFilePicker!(PICKER))) ?? [];
  } catch (err) {
    if (isAbort(err)) return null;
    if (!isBlocked(err)) throw err;
    blocked = true;
    throw new PickerBlockedError();
  }
  if (!handle) return null;
  onPicked?.(handle.name);
  return readHandle(handle);
}

function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.xlsx,${XLSX_MIME}`;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export async function readHandle(handle: FileSystemFileHandle): Promise<OpenedFile> {
  const file = await handle.getFile();
  return { name: file.name, bytes: await file.arrayBuffer(), lastModified: file.lastModified, handle };
}

export type DropChoice = { kind: 'one'; index: number } | { kind: 'none'; names: string[] } | { kind: 'many'; names: string[] };

/**
 * Which of the dropped items to open, by name: the single .xlsx among them. None (other files, a folder) or
 * several workbooks can't be opened, so the caller says why before asking to drop unsaved changes.
 */
export function chooseDropped(names: readonly string[]): DropChoice {
  const xlsx = names.flatMap((name, i) => (isXlsxName(name) ? [i] : []));
  if (xlsx.length === 1) return { kind: 'one', index: xlsx[0]! };
  if (xlsx.length === 0) return { kind: 'none', names: [...names] };
  return { kind: 'many', names: xlsx.map((i) => names[i]!) };
}

export type Dropped = { kind: 'file'; name: string; pending: Promise<OpenedFile> } | Exclude<DropChoice, { kind: 'one' }>;

/**
 * The workbook dropped on the window, with a handle when the browser gives one (so Save writes back to it).
 * Must be called during the drop event: the items are gone afterwards.
 */
export function droppedFile(data: DataTransfer): Dropped {
  const items = [...data.items].filter((i) => i.kind === 'file');
  const files = items.length > 0 ? items.map((i) => i.getAsFile()) : [...data.files];
  const choice = chooseDropped(files.map((f) => f?.name ?? ''));
  if (choice.kind !== 'one') return choice;
  const file = files[choice.index]!;
  const handle = items[choice.index]?.getAsFileSystemHandle?.().catch(() => null);
  const pending = (async () => {
    const h = await handle;
    if (typeof FileSystemFileHandle !== 'undefined' && h instanceof FileSystemFileHandle) return readHandle(h);
    return { name: file.name, bytes: await file.arrayBuffer(), lastModified: file.lastModified };
  })();
  return { kind: 'file', name: file.name, pending };
}

/**
 * Asks for read access to a remembered handle (needs a click) and reads it; null if refused. `onPicked` runs once
 * access is granted, before the read. A rejection with NotFoundError means the file is gone; any other error
 * (OneDrive offline or still syncing, file busy) may pass.
 */
export async function reopen(handle: FileSystemFileHandle, onPicked?: (name: string) => void): Promise<OpenedFile | null> {
  if (handle.requestPermission && (await handle.queryPermission?.({ mode: 'read' })) !== 'granted') {
    if ((await handle.requestPermission({ mode: 'read' })) !== 'granted') return null;
  }
  onPicked?.(handle.name);
  return readHandle(handle);
}

/** What the save flow needs from a file handle (a FileSystemFileHandle, or a fake in tests). */
export interface SaveTarget {
  getFile(): Promise<{ lastModified: number }>;
  createWritable(): Promise<{ write(data: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
}

export type SaveOutcome =
  | { kind: 'saved'; lastModified: number }
  | { kind: 'conflict' } // changed on disk since it was opened or last saved
  | { kind: 'denied' } // no write permission
  | { kind: 'missing'; error: unknown } // moved, renamed or deleted since it was opened
  | { kind: 'unreadable'; error: unknown } // the conflict check couldn't read it (e.g. OneDrive offline): nothing written
  | { kind: 'buildFailed'; error: unknown } // the workbook couldn't be made: nothing was written
  | { kind: 'failed'; error: unknown }; // the write threw: usually the file is open in Excel

/**
 * Save in place (§3.5). Permission comes first because it needs the click's user activation; then the conflict
 * check against `baseline` (lastModified at open or last save; undefined skips it, for Overwrite); then
 * `build` makes the bytes and they are written. Each step has its own outcome: only an error from the write
 * itself is the locked file (Excel's lock doesn't stop reads, so a read error at the check is something else).
 */
export async function saveToHandle(
  handle: SaveTarget,
  build: () => Promise<Uint8Array<ArrayBuffer>>,
  baseline: number | undefined,
): Promise<SaveOutcome> {
  try {
    if (!(await canWrite(handle))) return { kind: 'denied' };
  } catch {
    return { kind: 'denied' }; // e.g. no user activation left: "Try again" is a new click
  }
  if (baseline !== undefined) {
    try {
      if ((await handle.getFile()).lastModified !== baseline) return { kind: 'conflict' };
    } catch (error) {
      return { kind: isNotFound(error) ? 'missing' : 'unreadable', error };
    }
  }
  let data: Uint8Array<ArrayBuffer>;
  try {
    data = await build();
  } catch (error) {
    return { kind: 'buildFailed', error };
  }
  try {
    await writeBytes(handle, data);
  } catch (error) {
    return { kind: isNotFound(error) ? 'missing' : 'failed', error };
  }
  return { kind: 'saved', lastModified: await modifiedAfterWrite(handle) };
}

/**
 * lastModified after the app's own write. If the file can't be read back, -1: the next save then shows the
 * conflict dialog rather than skip the check.
 */
const modifiedAfterWrite = (handle: SaveTarget) => handle.getFile().then((f) => f.lastModified, () => -1);

async function canWrite(handle: SaveTarget): Promise<boolean> {
  const mode = { mode: 'readwrite' } as const;
  if (!handle.queryPermission || (await handle.queryPermission(mode)) === 'granted') return true;
  return (await handle.requestPermission?.(mode)) === 'granted';
}

async function writeBytes(handle: SaveTarget, data: Uint8Array<ArrayBuffer>): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => undefined);
    throw err;
  }
}

export type SaveAsOutcome =
  | { kind: 'saved'; handle: FileSystemFileHandle; lastModified: number; same: boolean } // same: it is `current`
  | { kind: 'blocked' } // the browser refused the picker: save by download instead
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: unknown };

/**
 * Save as… (§3.5): the picker first (it needs the click's user activation), then build and write. The plan is
 * always written to the picked file: Chromium creates or empties it before the picker returns, so writing nothing
 * would leave it empty. `same` says it is `current` (the open file), for the caller to tell the user.
 */
export async function saveAs(
  suggestedName: string,
  build: () => Promise<Uint8Array<ArrayBuffer>>,
  current?: FileSystemFileHandle,
): Promise<SaveAsOutcome> {
  let handle: FileSystemFileHandle | null;
  try {
    handle = await onePicker(() => window.showSaveFilePicker!({ ...PICKER, suggestedName }));
  } catch (err) {
    if (isAbort(err)) return { kind: 'cancelled' };
    if (!isBlocked(err)) return { kind: 'failed', error: err };
    blocked = true;
    return { kind: 'blocked' };
  }
  if (!handle) return { kind: 'cancelled' }; // another picker is open
  const same = !!current && (await current.isSameEntry(handle).catch(() => false));
  try {
    await writeBytes(handle, await build());
  } catch (error) {
    return { kind: 'failed', error };
  }
  return { kind: 'saved', handle, lastModified: await modifiedAfterWrite(handle), same };
}
