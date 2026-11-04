// Save, Save as, the download fallback (SPEC §3.5) and the error screen's download (§10). Writes only when the user
// asks: into the retained workbook, never a rebuilt one (§4.8).
import { computePlan } from '../engine/compute';
import type { Plan } from '../engine/types';
import { workbookBytes } from '../excel/exceljs';
import { emptyLayout } from '../excel/read';
import { createTemplate } from '../excel/template';
import { listText } from '../excel/unsupported';
import { writePlan } from '../excel/write';
import { download } from '../io/download';
import { canSaveInPlace, pickersBlocked, saveAs as saveAsFile, saveToHandle } from '../io/fileAccess';
import { saveRecent } from '../io/recent';
import { errorDetail, errorText, showError } from './errors';
import { showToast, useStore, type Dialog, type FileSession } from './store';

const { getState: get, setState: set } = useStore;

/** Writes the plan into the retained workbook and serializes it (§4.8). */
export async function build(): Promise<Uint8Array<ArrayBuffer>> {
  const { file, plan, result } = get();
  if (!file || !plan || !result) throw new Error('No plan is open');
  writePlan(file.workbook, plan, result, file.layout, new Date());
  return workbookBytes(file.workbook);
}

/**
 * One save, tied to the plan session that started it. `bytes` builds the file and remembers the plan it holds, so
 * `done` marks exactly that plan as saved: an edit made while the file is being written stays unsaved. Once
 * another plan has been opened, the save's outcome changes nothing.
 */
function startSave() {
  const { session } = get();
  let written: Plan | null = null;
  return {
    current: () => get().session === session,
    bytes: (): Promise<Uint8Array<ArrayBuffer>> => {
      written = get().plan; // what build() reads, before its first await
      return build();
    },
    done(update: Partial<FileSession>) {
      const { file, plan } = get();
      if (!file || get().session !== session) return;
      set({
        busy: null,
        dirty: plan !== written,
        cleanPlan: written,
        savedAt: new Date(),
        changesSaved: get().changes,
        file: { ...file, ...update, unsupported: [] },
      });
    },
  };
}

/** Save (§3.5): to the open file; the first time, Save as. `overwrite` skips the conflict check. */
export async function save(options: { overwrite?: boolean } = {}): Promise<void> {
  const { file, busy } = get();
  if (!file || busy) return;
  if (!file.handle) return saveAs();
  if (file.unsupported.length > 0) return set({ dialog: { kind: 'unsupported', parts: listText(file.unsupported) } });
  set({ busy: 'saving', dialog: null });
  const job = startSave();
  const outcome = await saveToHandle(file.handle, job.bytes, options.overwrite ? undefined : file.lastModified);
  if (!job.current()) return;
  if (outcome.kind === 'saved') return job.done({ lastModified: outcome.lastModified });
  let dialog: Dialog;
  if (outcome.kind === 'conflict' || outcome.kind === 'denied') dialog = { kind: outcome.kind };
  else {
    console.error('Save failed', outcome.error);
    dialog = { kind: outcome.kind, detail: errorDetail(outcome.error) };
  }
  set({ busy: null, dialog });
}

/** "Save anyway": the user accepts that Save removes content ExcelJS can't keep. */
export function saveAnyway(): Promise<void> {
  const { file } = get();
  if (file) set({ file: { ...file, unsupported: [] } });
  return save();
}

/**
 * Save as… (§3.5); in fallback mode, or when the browser blocks the picker, a download. The new file becomes the
 * open file. `copy` ("Save a copy…" in the save dialogs) suggests "<name> (copy).xlsx", away from the file that
 * couldn't, or shouldn't, be saved. The plan is written to whatever file is picked, even the open file: the browser
 * has already emptied it (Chromium), so a toast says so instead.
 */
export async function saveAs(options: { copy?: boolean } = {}): Promise<void> {
  const { file, busy } = get();
  if (!file || busy) return;
  const name = options.copy ? `${file.name.replace(/\.xlsx$/i, '')} (copy).xlsx` : file.name;
  const job = startSave();
  set({ dialog: null });
  if (!canSaveInPlace || pickersBlocked()) return saveByDownload(job, name);
  // "Saving…" once a file is picked, not while the user is still choosing a folder.
  const bytes = () => {
    set({ busy: 'saving' });
    return job.bytes();
  };
  const outcome = await saveAsFile(name, bytes, file.handle);
  if (!job.current()) return;
  switch (outcome.kind) {
    case 'cancelled':
      return set({ busy: null });
    case 'blocked':
      set({ fallback: true });
      return saveByDownload(job, name);
    case 'failed':
      console.error('Save as failed', outcome.error);
      return showError("Couldn't save the file", errorText(outcome.error));
    case 'saved': {
      job.done({ name: outcome.handle.name, handle: outcome.handle, lastModified: outcome.lastModified });
      const told = outcome.same && sameFileText(file.name, !!options.copy, file.unsupported);
      if (told) showToast(told);
      set({ recent: outcome.handle });
      await saveRecent(outcome.handle);
    }
  }
}

/**
 * Save as… onto the open file, which the picker had already emptied: no conflict check or confirm could still help,
 * so the toast says what happened. Null when there is nothing to tell (a plain Save as… with nothing removed).
 */
export function sameFileText(name: string, copy: boolean, removed: readonly string[]): string | null {
  const parts = copy ? [`You chose ${name} itself, so your plan was saved there.`] : [];
  if (removed.length > 0) parts.push(`Saving removed ${listText(removed)} from ${copy ? 'it' : name}, which Gantt Planner can't keep.`);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Fallback save (§3.5): the browser downloads the workbook; the download becomes the open file (no handle). */
async function saveByDownload(job: ReturnType<typeof startSave>, name: string): Promise<void> {
  set({ busy: 'saving' });
  try {
    download(name, await job.bytes());
  } catch (err) {
    console.error('Save failed', err);
    if (job.current()) showError("Couldn't save the file", errorText(err));
    return;
  }
  job.done({ name, handle: undefined, lastModified: undefined });
}

/**
 * Error screen (§10): the plan in memory as a new workbook — written into the opened workbook (so its formatting
 * comes along), else into a blank template with the plan's holidays.
 */
export async function recoveryBytes(plan: Plan, file: FileSession | null): Promise<Uint8Array<ArrayBuffer>> {
  const result = computePlan(plan);
  if (file) {
    try {
      writePlan(file.workbook, plan, result, file.layout, new Date());
      return await workbookBytes(file.workbook);
    } catch {
      // The opened workbook may be what failed: use a blank template instead.
    }
  }
  const workbook = createTemplate(plan.holidays);
  writePlan(workbook, plan, result, emptyLayout(), new Date());
  return workbookBytes(workbook);
}

/** "Download my data as .xlsx": a new file next to the original name; the open file is never written. */
export async function downloadMyData(): Promise<void> {
  const { plan, file } = get();
  if (!plan) return;
  download(`${(file?.name ?? 'plan.xlsx').replace(/\.xlsx$/i, '')} (recovered).xlsx`, await recoveryBytes(plan, file));
}
