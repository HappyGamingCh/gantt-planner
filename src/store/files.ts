// File actions (SPEC §3.4–§3.5, §7.10, §10): open, new plan, sample, template and reload. Save, Save as and the
// error screen's download are in save.ts.
import { computePlan } from '../engine/compute';
import { addDays, dayOfWeek, isPlanDate } from '../engine/dates';
import { makeIssue } from '../engine/issues';
import type { Change, ISODate, Issue, Plan, Task } from '../engine/types';
import { loadWorkbook, workbookBytes, type Workbook } from '../excel/exceljs';
import { emptyLayout, readPlan } from '../excel/read';
import { createTemplate } from '../excel/template';
import { listText, scanFile } from '../excel/unsupported';
import { calculatedChanges } from '../excel/write';
import { download } from '../io/download';
import { PickerBlockedError, droppedFile, isNotFound, isXlsxName, pickFile, readHandle, reopen, type OpenedFile } from '../io/fileAccess';
import { forgetRecent, loadRecent, saveRecent } from '../io/recent';
import { SAMPLE_FILE_NAME, buildSampleWorkbook } from '../sample/sampleWorkbook';
import { plural } from '../ui/common/format';
import { errorText, showError } from './errors';
import { DATE_RANGE_MESSAGE } from './rules';
import { problems } from './selectors';
import { CLOSED, closeView, openIssues, showToast, todayISO, useStore, type ReadIssue, type State } from './store';

export { build, downloadMyData, recoveryBytes, sameFileText, save, saveAnyway, saveAs } from './save';

const { getState: get, setState: set } = useStore;

export async function init(): Promise<void> {
  set({ recent: await loadRecent() });
}

/** True, with a toast, while a save or an open is running: file actions wait for it (§3.5). */
function isBusy(): boolean {
  const { busy } = get();
  if (busy) showToast(busy === 'saving' ? 'Wait for the save to finish' : 'Wait for the file to open');
  return busy !== null;
}

/** Runs `then` now, or once the user agrees to drop unsaved changes; nothing while a save or an open runs. */
function guard(then: () => void) {
  if (isBusy()) return;
  if (get().dirty) set({ dialog: { kind: 'discard', then } });
  else then();
}

export function discardChanges(): void {
  const { dialog } = get();
  set({ dialog: null });
  if (dialog?.kind === 'discard') dialog.then();
}

/** "Opening <name>…" from the moment a file is chosen: reading it can take a while (OneDrive). */
function beginOpen(name: string) {
  if (get().busy !== 'saving') set({ busy: 'opening', opening: name, dialog: null });
}

/** Why a file can't be opened by its name; Excel's other formats get a Save As hint. */
export function notXlsxText(name: string): string {
  const hint = /\.(xls|xlsm|xlsb|csv)$/i.test(name) ? ' In Excel, use File › Save As › Excel Workbook (.xlsx), then open that copy.' : '';
  return `Gantt Planner opens Excel workbooks (.xlsx) only.${hint}`;
}

export function openPicked(): void {
  guard(pickAndOpen);
}

function pickAndOpen() {
  pickFile(beginOpen).then(
    (file) => file && open(file),
    (err: unknown) => {
      if (!(err instanceof PickerBlockedError)) return showError("Couldn't open the file", errorText(err));
      // Fallback mode from now on. The refused picker used up the click: the dialog's button is a new one, for
      // <input type="file">.
      set({ fallback: true });
      showError("Couldn't open the file", 'Your browser blocked the file picker. Choose the file again to open it.', { label: 'Choose file…', run: pickAndOpen });
    },
  );
}

/**
 * Call from the drop handler: the dropped items must be read during the event. A drop that can't open (no
 * workbook, or several) says so before asking to drop unsaved changes.
 */
export function openDropped(data: DataTransfer): void {
  if (isBusy()) return;
  const drop = droppedFile(data);
  if (drop.kind === 'none') {
    const name = drop.names.length === 1 ? (drop.names[0] ?? '') : '';
    return showError(`Can't open ${name || 'the dropped items'}`, notXlsxText(name));
  }
  if (drop.kind === 'many') {
    return showError('Drop one workbook at a time', `You dropped ${drop.names.length} Excel workbooks (${drop.names.join(', ')}). Drop just the one you want to open.`);
  }
  guard(() => {
    beginOpen(drop.name);
    drop.pending.then(open, (err: unknown) => showError("Couldn't open the dropped file", errorText(err)));
  });
}

export function openRecent(): void {
  const { recent } = get();
  if (!recent) return;
  guard(() => {
    reopen(recent, beginOpen).then(
      (file) => {
        if (file) return open(file);
        // Permission refused or the prompt dismissed: keep the link and say why nothing happened.
        showToast(`Gantt Planner needs your permission to open ${recent.name}. Click Reopen and choose Allow.`, { label: 'Open…', run: openPicked });
      },
      (err: unknown) => {
        if (!isNotFound(err)) {
          // Probably temporary (OneDrive offline or still syncing, file busy): keep the link.
          return showError(
            `Couldn't reopen ${recent.name}`,
            `${errorText(err)} If the file is in OneDrive, check that it has synced and is available on this computer, then try again.`,
          );
        }
        void forgetRecent();
        set({ recent: null });
        showError(`Couldn't find ${recent.name}`, 'It may have been moved, renamed or deleted. Use Open Excel plan to find it.');
      },
    );
  });
}

export function openSample(): void {
  guard(() => {
    beginOpen(SAMPLE_FILE_NAME);
    workbookBytes(buildSampleWorkbook(new Date())).then(
      (bytes) => open({ name: SAMPLE_FILE_NAME, bytes: bytes.buffer, lastModified: Date.now() }),
      (err: unknown) => showError("Couldn't open the sample", errorText(err)),
    );
  });
}

export async function downloadTemplate(): Promise<void> {
  download('gantt-planner-template.xlsx', await workbookBytes(createTemplate()));
}

export function askNewPlan(): void {
  guard(() => set({ dialog: { kind: 'newPlan' } }));
}

/** First Monday after `today`: the New plan dialog's default Project Start (§7.10). */
export function nextMonday(today: ISODate): ISODate {
  return addDays(today, (8 - dayOfWeek(today)) % 7 || 7);
}

/** A plan that replaces the current one starts in the main view (§9.1), where the load report's Review shows. */
function leaveReport(): Pick<State, 'view'> {
  if (get().view !== 'main') closeView();
  return { view: 'main' };
}

/** New plan (§7.10): the template in memory with one task in Plan mode; the first Save asks where (Save as). */
export function createPlan(fields: { name: string; owner: string; projectStart: ISODate }): void {
  if (isBusy()) return; // backstop: guard() already waits for a running save
  if (!isPlanDate(fields.projectStart)) return showToast(DATE_RANGE_MESSAGE); // the dialog stays open to fix it
  const name = fields.name.trim() || 'Untitled project';
  const plan: Plan = {
    project: { name, owner: fields.owner.trim(), projectStart: fields.projectStart, statusDate: todayISO(), mode: 'Plan' },
    tasks: [{ id: 1, name: 'New task', assigned: [], predecessorsText: '', plannedStart: fields.projectStart, plannedDuration: 1, progress: 0, remarks: '', extra: {} }],
    resources: [],
    holidays: [],
  };
  const fileName = `${name.replace(/[\\/:*?"<>|\s]+/g, ' ').trim() || 'plan'}.xlsx`;
  set({
    ...CLOSED,
    ...leaveReport(),
    plan,
    result: computePlan(plan),
    file: { name: fileName, workbook: createTemplate(), layout: emptyLayout(), unsupported: [] },
    dirty: true,
    maxIdEver: 1,
    session: get().session + 1,
  });
}

/** Load report line (§7.11), e.g. "Filled 23 values · corrected 2 · 3 warnings". */
export function loadSummary(changes: readonly Change[], issues: readonly Issue[]): string {
  const filled = changes.filter((c) => c.kind === 'filled').length;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const parts = [`Filled ${plural(filled, 'value')}`, `corrected ${changes.length - filled}`, plural(warnings, 'warning')];
  if (errors > 0) parts.push(plural(errors, 'error'));
  return parts.join(' · ');
}

/** Ties each reader problem about a task to that task's row, so it follows the task (problems(), §7.11). */
function withRows(issues: readonly Issue[], tasks: readonly Task[]): ReadIssue[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return issues.map((issue) => {
    const id = issue.taskId;
    const task = id === undefined ? undefined : byId.get(id);
    if (id === undefined || task?.source === undefined) return issue;
    return { ...issue, at: { row: task.source, id, predecessors: task.predecessorsText } };
  });
}

/** Open → read workbook → parse → compute → load report (§3.4). Nothing is written until Save. */
async function open(file: OpenedFile): Promise<void> {
  // Backstop: a picker or a permission prompt can outlast guard(); a running save keeps the open file.
  if (get().busy === 'saving') return showToast('Wait for the save to finish');
  if (!isXlsxName(file.name)) return showError(`Can't open ${file.name}`, notXlsxText(file.name));
  set({ busy: 'opening', opening: file.name, dialog: null });
  let workbook: Workbook;
  try {
    workbook = await loadWorkbook(file.bytes);
  } catch {
    return showError(`Couldn't open ${file.name}`, "It isn't a valid Excel workbook (.xlsx), or it's protected with a password.");
  }
  const { handle, lastModified, name } = file;
  try {
    const scan = await scanFile(new Uint8Array(file.bytes));
    const read = readPlan(workbook, todayISO(), scan.filtered);
    const result = computePlan(read.plan);
    // The first Save asks about what it removes and what it converts (tables, merged cells) (§3.5).
    const unsupported = [...scan.unsupported, ...read.converted];
    const fileIssues = scan.unsupported.length > 0 ? [makeIssue('W_UNSUPPORTED_CONTENT', { parts: listText(scan.unsupported) })] : [];
    const readIssues = [...fileIssues, ...withRows(read.issues, read.plan.tasks)];
    const changes = [...read.changes, ...result.changes, ...calculatedChanges(read.plan.tasks, read.layout, result)];
    set({
      ...CLOSED,
      ...leaveReport(),
      plan: read.plan,
      result,
      readIssues,
      changes,
      file: { name, handle, lastModified, workbook, layout: read.layout, unsupported },
      // The app doesn't auto-save: anything it filled or corrected waits for Save (§5.3).
      dirty: changes.length > 0,
      cleanPlan: changes.length > 0 ? null : read.plan,
      maxIdEver: Math.max(0, ...read.plan.tasks.map((t) => t.id)),
      session: get().session + 1,
    });
    const { list, notes } = problems(get());
    // Tasks not found (no Tasks sheet, no Task header): the toast says that instead of the counts (§7.11).
    const fileProblem = readIssues.find((i) => i.code === 'W_NO_TASKS_SHEET' || i.code === 'E_NO_TASK_HEADER');
    if (fileProblem || changes.length > 0 || list.length > 0 || notes.length > 0) {
      const tab = fileProblem || list.length > 0 || changes.length === 0 ? 'problems' : 'changes';
      showToast(fileProblem?.message ?? loadSummary(changes, [...list, ...notes]), { label: 'Review', run: () => openIssues(tab) });
    }
  } catch (err) {
    return showError(`Couldn't read ${name}`, errorText(err));
  }
  if (handle) {
    set({ recent: handle });
    await saveRecent(handle);
  }
}

/** Conflict dialog → Reload file: open the file as it is on disk, dropping unsaved changes. */
export async function reload(): Promise<void> {
  const { file } = get();
  if (!file?.handle || isBusy()) return;
  beginOpen(file.name);
  try {
    await open(await readHandle(file.handle));
  } catch (err) {
    showError(`Couldn't reload ${file.name}`, errorText(err));
  }
}
