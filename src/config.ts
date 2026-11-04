// App-wide thresholds and constants.

/** Schedule state bands on Variance (pts) = actual % − planned % (SPEC §5.8). */
export const SCHEDULE_STATE_BANDS = {
  ahead: 2.0, // ≥ → Ahead
  onTrack: -2.0, // > → On track
  slightlyBehind: -5.0, // > → Slightly behind; otherwise Behind
} as const;

/** Written to Project › App Version on save (SPEC §4.2). */
export const APP_VERSION = '1.0.0';

/** Resource palette (SPEC §7.2): colour by assignee, avatars, and the Color of resources appended on save. */
export const RESOURCE_PALETTE = [
  '#2563EB',
  '#0D9488',
  '#D97706',
  '#7C3AED',
  '#DB2777',
  '#0891B2',
  '#65A30D',
  '#EA580C',
  '#4F46E5',
  '#475569',
] as const;

/** Gantt zoom (SPEC §7.8): pixels per day; Fit picks a scale between Month and Day. */
export type Zoom = 'day' | 'week' | 'month' | 'fit';
export const PX_PER_DAY = { day: 32, week: 12, month: 4 } as const;

/** Row density (SPEC §7.6): grid and Gantt rows share the height, in px. */
export type Density = 'compact' | 'default' | 'comfortable';
export const ROW_HEIGHTS: Record<Density, number> = { compact: 30, default: 36, comfortable: 40 };

/** Height of the two-tier timeline header, matched by the grid header (px). */
export const TIMELINE_HEIGHT = 44;

/** Grid columns that can be shown or hidden (SPEC §7.6); ID and Task are always shown. */
export const OPTIONAL_COLUMNS = [
  'assigned',
  'duration',
  'start',
  'finish',
  'predecessors',
  'successors',
  'progress',
  'actualStart',
  'actualFinish',
  'actualDuration',
  'forecastStart',
  'forecastFinish',
  'variance',
  'status',
  'critical',
  'remarks',
] as const;
export type ColumnKey = (typeof OPTIONAL_COLUMNS)[number];

/** Default grid columns per mode (SPEC §6). */
export const DEFAULT_COLUMNS: Record<'Plan' | 'Track', ColumnKey[]> = {
  Plan: ['assigned', 'duration', 'start', 'finish', 'predecessors'],
  Track: ['assigned', 'progress', 'actualStart', 'actualFinish', 'forecastFinish', 'variance', 'status'],
};

/** Gantt bar colours (SPEC §7.8): by status (Plan mode: the accent) or by the first assignee. */
export type ColorBy = 'status' | 'assignee';

/**
 * Largest Planned Duration or |lag| the app accepts, in working days (SPEC §4.7, §5.2). It doesn't bound a long
 * chain; the engine clamps dates (§5.1) and samples the S-curve (§5.9).
 */
export const MAX_DAYS = 3650;

/** Largest ID read from Excel (SPEC §4.7): 12 digits, so work-order numbers fit and max + 1 is always a new number
 * (from about 16 digits, adding 1 gives the same number). A bigger ID gets the next free ID. */
export const MAX_ID = 999_999_999_999;

/** Undo keeps this many steps (SPEC §8). */
export const UNDO_LIMIT = 100;

/** Grid width (SPEC §7.3): splitter limits, px, and the share of the workspace a grid fitted to its columns may take. */
export const GRID_WIDTH = { min: 320, max: 900, share: 0.6 } as const;

/**
 * Report chart palette (SPEC §9.2); hex is allowed here (CLAUDE.md). Each value mirrors a token, and every mark is
 * at least 3:1 on white: planned = --baseline (4.07), actual / status date / in progress = --accent (5.17),
 * completed = --done (5.02), late = --late (4.83), text = --text-2 (7.58). Not started stays pale (1.48): the legend
 * prints its count and the separator leaves white gaps between the donut's slices.
 */
export const REPORT_PALETTE = {
  planned: '#707F95',
  actual: '#2563EB',
  statusDate: '#2563EB',
  completed: '#15803D',
  inProgress: '#2563EB',
  notStarted: '#CBD5E1',
  late: '#DC2626',
  grid: '#E3E6EB',
  text: '#475569',
  separator: '#FFFFFF',
} as const;

/** Print Gantt paper (SPEC §9.4), always landscape. */
export type Paper = 'A4' | 'A3';

/** Report options (SPEC §9.1): sections on/off and the look-ahead window in calendar days. */
export interface ReportOptions {
  summary: boolean;
  assignees: boolean;
  attention: boolean;
  gantt: boolean;
  lookAheadDays: 3 | 7 | 14;
}
export const DEFAULT_REPORT: ReportOptions = { summary: true, assignees: true, attention: true, gantt: true, lookAheadDays: 7 };

/** Workload heatmap (SPEC §9.3): one column per day for at most 14 days when the project spans ≤ 42 calendar days. */
export const HEATMAP_DAILY_MAX_SPAN = 42;
export const HEATMAP_DAYS = 14;
/** Weekly heatmap: at most 8 columns. */
export const HEATMAP_WEEKS = 8;

/** Report page 2: assignees per planned-vs-actual chart image, so no image is taller than a printed page. */
export const REPORT_BARS_PER_CHART = 20;
