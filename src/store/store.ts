// App state (SPEC §3.3). The exported functions here are the view actions; plan edits live in edit.ts (through
// undo.ts) and file actions in files.ts. The state's shape is in state.ts.
import { create } from 'zustand';
import type { ColorBy, ColumnKey, Density, Paper, ReportOptions, Zoom } from '../config';
import { outlineOf } from '../engine/outline';
import type { ISODate } from '../engine/types';
import { canSaveInPlace } from '../io/fileAccess';
import { loadPrefs, savePrefs } from './prefs';
import { shownSelection } from './selectors';
import { CLOSED, type Filters, type State, type Toast } from './state';

export { CLOSED, NO_FILTERS, type Dialog, type FileSession, type Filters, type ReadIssue, type State, type Toast } from './state';

export const useStore = create<State>()(() => ({
  ...CLOSED,
  recent: null,
  fallback: !canSaveInPlace,
  reveal: 0,
  nameFocus: null,
  drawerFocus: false,
  issuesTab: 'problems',
  session: 0,
  view: 'main',
  maxIdEver: 0,
  ...loadPrefs(),
}));
const { getState: get, setState: set } = useStore;

const PREF_KEYS = ['zoom', 'density', 'gridWidth', 'columns', 'report', 'colorBy', 'critical', 'kpiCollapsed', 'printPaper'] as const;

useStore.subscribe((s, prev) => {
  if (PREF_KEYS.some((k) => s[k] !== prev[k])) {
    savePrefs({ zoom: s.zoom, density: s.density, gridWidth: s.gridWidth, columns: s.columns, report: s.report, colorBy: s.colorBy, critical: s.critical, kpiCollapsed: s.kpiCollapsed, printPaper: s.printPaper });
  }
});

/** Today's local date: the default status date (§4.2). */
export function todayISO(): ISODate {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function closeDialog(): void {
  set({ dialog: null });
}

/**
 * Click selection (§7.7): plain = this task only; `toggle` (Ctrl) adds or removes it; `range` (Shift) selects
 * from the anchor to it in `order` (the rows as shown).
 */
export function select(id: number, how: 'only' | 'toggle' | 'range' = 'only', order: readonly number[] = []): void {
  const { selection, anchor } = get();
  if (how === 'toggle') {
    set({ selection: selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id], anchor: id });
  } else if (how === 'range' && anchor !== null && order.includes(anchor) && order.includes(id)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(id)];
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    set({ selection: [...range.filter((s) => s !== id), id] });
  } else {
    set({ selection: [id], anchor: id, ...drawerFollows(id) });
  }
}

/** An open drawer follows a plain selection (§7.9), so an edit never lands on a task the user has left. */
function drawerFollows(id: number): Partial<State> {
  return get().drawerId !== null ? { drawerId: id } : {};
}

export function clearSelection(): void {
  set({ selection: [], anchor: null });
}

/** Selects a task and scrolls it into view. */
export function revealTask(id: number): void {
  // Pinned, so a task hidden by the search or filters still shows (§7.6); its major tasks expand (§7.7).
  const { pinned, reveal } = get();
  set({ selection: [id], anchor: id, reveal: reveal + 1, pinned: pinned.includes(id) ? pinned : [...pinned, id], ...drawerFollows(id), ...expandedTo(id) });
}

/** The collapsed list without the major tasks `id` is inside, so it shows. */
export function expandedTo(id: number): Partial<State> {
  const { plan, result, collapsed } = get();
  if (!plan || !result || collapsed.length === 0) return {};
  const { parentOf } = outlineOf(plan.tasks, result.tasks.map((r) => r.level));
  const above = new Set<number>();
  for (let p = parentOf.get(id); p !== undefined; p = parentOf.get(p)) above.add(p);
  return above.size > 0 && collapsed.some((c) => above.has(c)) ? { collapsed: collapsed.filter((c) => !above.has(c)) } : {};
}

/** Opens the task in the drawer. From the keyboard (`focus`) the drawer takes the focus; from the mouse it stays put. */
export function openDrawer(id: number, { focus = false }: { focus?: boolean } = {}): void {
  set({ drawerId: id, selection: [id], anchor: id, panel: null, drawerFocus: focus });
}

export function closeDrawer(): void {
  set({ drawerId: null, drawerFocus: false });
}

export function nameFocused(): void {
  set({ nameFocus: null });
}

export function drawerFocused(): void {
  set({ drawerFocus: false });
}

export function setZoom(zoom: Zoom): void {
  set({ zoom });
}

export function setDensity(density: Density): void {
  set({ density });
}

/** Grid width of one mode (§7.3); null fits the visible columns again. */
export function setGridWidth(mode: 'Plan' | 'Track', width: number | null): void {
  set({ gridWidth: { ...get().gridWidth, [mode]: width } });
}

export function toggleColumn(mode: 'Plan' | 'Track', key: ColumnKey): void {
  const { columns } = get();
  const shown = columns[mode].includes(key) ? columns[mode].filter((k) => k !== key) : [...columns[mode], key];
  set({ columns: { ...columns, [mode]: shown } });
}

export function setColorBy(colorBy: ColorBy): void {
  set({ colorBy });
}

export function toggleCritical(): void {
  set({ critical: !get().critical });
}

/** KPI strip: full cards or one line (§7.3); remembered with the preferences. */
export function toggleKpis(): void {
  set({ kpiCollapsed: !get().kpiCollapsed });
}

export function setReportOptions(options: Partial<ReportOptions>): void {
  set({ report: { ...get().report, ...options } });
}

export function setPrintPaper(printPaper: Paper): void {
  set({ printPaper });
}

/** The URL hash of each view shown over the main view: the report (§9.1) and Print Gantt (§9.4). */
const VIEW_HASH = { report: '#report', print: '#print' } as const;
type OverView = keyof typeof VIEW_HASH;

/** The report and Print Gantt are routes: opening one adds its hash, Back returns to the main view. */
function openView(view: OverView): void {
  set({ drawerId: null, panel: null });
  location.hash = VIEW_HASH[view];
}

export const openReport = (): void => openView('report');
export const openPrint = (): void => openView('print');

/** The view a URL hash shows over the main view, if any. */
export const viewOfHash = (hash: string): OverView | undefined => (Object.keys(VIEW_HASH) as OverView[]).find((v) => VIEW_HASH[v] === hash);

/** Back from the report or Print Gantt to the main view. */
export function closeView(): void {
  if (viewOfHash(location.hash)) history.back();
  set({ view: 'main' });
}

/** Keeps `view` in step with the URL hash (Back button included). */
export function syncView(): void {
  const view = viewOfHash(location.hash);
  set({ view: view && get().plan ? view : 'main' });
}

/** New search or filters (§7.6): pinned rows go back to following them, and rows they hide leave the selection. */
export function setFilters(filters: Partial<Filters>): void {
  const { plan, result, selection, anchor } = get();
  const next = { ...get().filters, ...filters };
  const shown = (ids: number[]) => shownSelection({ plan, result, filters: next, pinned: [], selection: ids });
  set({ filters: next, pinned: [], selection: shown(selection), anchor: anchor !== null && shown([anchor]).length > 0 ? anchor : null });
}

export function openIssues(tab: State['issuesTab'] = 'problems'): void {
  // The panel is in the main view: a toast's Review from the report or Print Gantt goes back there first.
  if (get().view !== 'main') closeView();
  set({ panel: 'issues', issuesTab: tab, drawerId: null });
}

export function setIssuesTab(tab: State['issuesTab']): void {
  set({ issuesTab: tab });
}

export function closePanel(): void {
  set({ panel: null });
}

let toastId = 0;

/** Bottom-centre message (§7.11); the host hides it after 4 s. */
export function showToast(message: string, action?: Toast['action']): void {
  set({ toast: { id: ++toastId, message, action } });
}

export function dismissToast(): void {
  set({ toast: null });
}
