// UI preferences (SPEC §7.13), kept in localStorage. Never project data. Every access is wrapped: where storage
// is unavailable the defaults are used.
import { DEFAULT_COLUMNS, DEFAULT_REPORT, GRID_WIDTH, OPTIONAL_COLUMNS, ROW_HEIGHTS, type ColorBy, type ColumnKey, type Density, type Paper, type ReportOptions, type Zoom } from '../config';

const KEY = 'gantt-planner:prefs';

/** Grid width per mode (§7.3), px; null = fit the visible columns. */
export type GridWidth = Record<'Plan' | 'Track', number | null>;

export interface Prefs {
  zoom: Zoom;
  density: Density;
  gridWidth: GridWidth;
  columns: Record<'Plan' | 'Track', ColumnKey[]>;
  report: ReportOptions;
  colorBy: ColorBy;
  /** Critical path shown on the Gantt. */
  critical: boolean;
  /** KPI strip shown as one line (§7.3). */
  kpiCollapsed: boolean;
  /** Print Gantt paper (§9.4). */
  printPaper: Paper;
}

export const DEFAULT_PREFS: Prefs = {
  zoom: 'fit',
  density: 'default',
  gridWidth: { Plan: null, Track: null },
  columns: DEFAULT_COLUMNS,
  report: DEFAULT_REPORT,
  colorBy: 'status',
  critical: false,
  kpiCollapsed: false,
  printPaper: 'A4',
};

const ZOOMS: readonly Zoom[] = ['day', 'week', 'month', 'fit'];

function columnsOr(value: unknown, fallback: ColumnKey[]): ColumnKey[] {
  return Array.isArray(value) ? value.filter((k): k is ColumnKey => (OPTIONAL_COLUMNS as readonly unknown[]).includes(k)) : fallback;
}

/** The single width of older versions; 560 was their default, which now means "fit the columns". */
const OLD_DEFAULT_WIDTH = 560;

const widthOr = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(GRID_WIDTH.max, Math.max(GRID_WIDTH.min, Math.round(value))) : null;

/** Per mode; an older single number applies to both modes. */
function gridWidthOf(value: unknown): GridWidth {
  if (typeof value === 'number') {
    const width = value === OLD_DEFAULT_WIDTH ? null : widthOr(value);
    return { Plan: width, Track: width };
  }
  const saved = (value !== null && typeof value === 'object' ? value : {}) as Partial<Record<'Plan' | 'Track', unknown>>;
  return { Plan: widthOr(saved.Plan), Track: widthOr(saved.Track) };
}

export function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof Prefs, unknown>>;
    const columns = (saved.columns ?? {}) as Partial<Record<'Plan' | 'Track', unknown>>;
    const report = (saved.report ?? {}) as Partial<Record<keyof ReportOptions, unknown>>;
    const flag = (key: 'summary' | 'assignees' | 'attention' | 'gantt') => (typeof report[key] === 'boolean' ? (report[key] as boolean) : DEFAULT_REPORT[key]);
    return {
      zoom: ZOOMS.includes(saved.zoom as Zoom) ? (saved.zoom as Zoom) : DEFAULT_PREFS.zoom,
      density: (saved.density as Density) in ROW_HEIGHTS ? (saved.density as Density) : DEFAULT_PREFS.density,
      gridWidth: gridWidthOf(saved.gridWidth),
      columns: { Plan: columnsOr(columns.Plan, DEFAULT_COLUMNS.Plan), Track: columnsOr(columns.Track, DEFAULT_COLUMNS.Track) },
      report: {
        summary: flag('summary'),
        assignees: flag('assignees'),
        attention: flag('attention'),
        gantt: flag('gantt'),
        // The old `lookAheadWeeks` key is ignored: it falls back to the default window.
        lookAheadDays: report.lookAheadDays === 3 || report.lookAheadDays === 14 ? report.lookAheadDays : DEFAULT_REPORT.lookAheadDays,
      },
      colorBy: saved.colorBy === 'assignee' ? 'assignee' : DEFAULT_PREFS.colorBy,
      critical: saved.critical === true,
      kpiCollapsed: saved.kpiCollapsed === true,
      printPaper: saved.printPaper === 'A3' ? 'A3' : DEFAULT_PREFS.printPaper,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable (e.g. some file:// setups): preferences last for this visit only.
  }
}
