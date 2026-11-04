// "Reopen <name>" (SPEC §3.5): the last file's handle, kept in IndexedDB under `recentFile`. Every call is
// wrapped; where IndexedDB or handles aren't available (fallback mode, some file:// setups) the feature hides.
const DB_NAME = 'gantt-planner';
const STORE = 'files';
const KEY = 'recentFile';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = op(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function loadRecent(): Promise<FileSystemFileHandle | null> {
  try {
    const value: unknown = await run('readonly', (s) => s.get(KEY));
    return typeof FileSystemFileHandle !== 'undefined' && value instanceof FileSystemFileHandle ? value : null;
  } catch {
    return null;
  }
}

export async function saveRecent(handle: FileSystemFileHandle): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(handle, KEY));
  } catch {
    // Feature unavailable: nothing to remember.
  }
}

export async function forgetRecent(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    // Nothing stored.
  }
}
