import type { ISODate } from '../../engine/types';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const month = (d: ISODate) => MONTHS[Number(d.slice(5, 7)) - 1];

/** `dd MMM yy`, e.g. 22 Oct 26 — grid and KPI strip (SPEC §7.2). */
export function formatDate(d: ISODate): string {
  return `${d.slice(8, 10)} ${month(d)} ${d.slice(2, 4)}`;
}

/** `d MMM yyyy`, e.g. 22 Oct 2026 — tooltips and report (SPEC §7.2). */
export function formatDateLong(d: ISODate): string {
  return `${Number(d.slice(8, 10))} ${month(d)} ${d.slice(0, 4)}`;
}

/** `d MMM`, e.g. 3 Nov — labels and change lists. */
export function formatDayMonth(d: ISODate): string {
  return `${Number(d.slice(8, 10))} ${month(d)}`;
}

/** Signed number with a true minus sign: +3, −1.5, 0. */
export function formatSigned(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
}

/** Variance in points, one decimal: −5.0 pts, +2.5 pts. */
export function formatPts(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)} pts`;
}

/** Durations: `5d`. */
export function formatDays(n: number): string {
  return `${n}d`;
}

/** Variance: `+3d`, `−1d`, or `—` when on time. */
export function formatVariance(n: number): string {
  return n === 0 ? '—' : `${formatSigned(n)}d`;
}

/**
 * Whole percent, rounded half up, but 100 only when complete and 0 only when nothing is reported: 99.7 → 99,
 * 0.3 → 1. A rounded 100% would say "done" while a task is still open.
 */
export function pctInt(n: number): number {
  const r = Math.round(n);
  if (r >= 100 && n < 100) return 99;
  if (r <= 0 && n > 0) return 1;
  return r;
}

/** Whole percent: `42%` (see pctInt). */
export function formatPct(n: number): string {
  return `${pctInt(n)}%`;
}

/** Local time `HH:mm`, e.g. "Saved 11:58". */
export function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** `1 task`, `3 tasks`. */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
