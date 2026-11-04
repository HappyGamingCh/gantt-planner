// Time scale of the Gantt (SPEC §7.8): visible range, pixels per day, timeline header labels. Pure functions.
import { PX_PER_DAY, type Zoom } from '../../config';
import type { Calendar } from '../../engine/calendar';
import { dayOfWeek, fromDayNumber, toDayNumber } from '../../engine/dates';
import type { ISODate } from '../../engine/types';
import { MONTHS } from '../common/format';

/** Earliest date − 3 working days → latest date + 5 working days; the status date counts as one of the dates. */
export function ganttRange(dates: readonly ISODate[], statusDate: ISODate, cal: Calendar): { start: ISODate; end: ISODate } {
  let earliest = statusDate;
  let latest = statusDate;
  for (const d of dates) {
    if (d < earliest) earliest = d;
    if (d > latest) latest = d;
  }
  return { start: cal.addWorkdays(earliest, -3), end: cal.addWorkdays(latest, 5) };
}

/** Days in [start, end]. */
export function dayCount(start: ISODate, end: ISODate): number {
  return toDayNumber(end) - toDayNumber(start) + 1;
}

/** Pixels per day; Fit = the largest scale that shows every day in `viewWidth`, between Month and Day. */
export function pxPerDay(zoom: Zoom, days: number, viewWidth: number): number {
  if (zoom !== 'fit') return PX_PER_DAY[zoom];
  return Math.min(PX_PER_DAY.day, Math.max(PX_PER_DAY.month, viewWidth / Math.max(days, 1)));
}

/** Bottom tier of the timeline: day numbers, ISO weeks, or week ticks, by how much room a day gets. */
export function detailFor(px: number): 'day' | 'week' | 'month' {
  return px >= 20 ? 'day' : px >= 10 ? 'week' : 'month';
}

/** ISO 8601 week number (weeks start on Monday). */
export function isoWeek(d: ISODate): number {
  const n = toDayNumber(d);
  const thursday = n - ((dayOfWeek(d) + 6) % 7) + 3;
  const jan1 = toDayNumber(`${fromDayNumber(thursday).slice(0, 4)}-01-01`);
  return Math.floor((thursday - jan1) / 7) + 1;
}

export interface Segment {
  label: string;
  /** Offset from the range start, in days. */
  day: number;
  days: number;
}

/** Top tier: one segment per month, e.g. "Nov 2026". */
export function monthSegments(start: ISODate, days: number): Segment[] {
  const first = toDayNumber(start);
  const segments: Segment[] = [];
  for (let i = 0; i < days; i++) {
    const d = fromDayNumber(first + i);
    const last = segments.at(-1);
    if (last && d.slice(8, 10) !== '01') last.days++;
    else segments.push({ label: `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`, day: i, days: 1 });
  }
  return segments;
}

/** Bottom tier: each day ("10"), each week from its Monday ("W46 · 10 Nov"), or a tick per Monday ("10"). */
export function bottomSegments(start: ISODate, days: number, detail: 'day' | 'week' | 'month'): Segment[] {
  const first = toDayNumber(start);
  const segments: Segment[] = [];
  for (let i = 0; i < days; i++) {
    const d = fromDayNumber(first + i);
    const monday = dayOfWeek(d) === 1;
    if (detail === 'day') segments.push({ label: String(Number(d.slice(8, 10))), day: i, days: 1 });
    else if (monday || i === 0) {
      const label = detail === 'week' ? `W${isoWeek(d)} · ${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}` : String(Number(d.slice(8, 10)));
      segments.push({ label: monday ? label : '', day: i, days: 1 });
    } else {
      segments.at(-1)!.days++;
    }
  }
  return segments;
}

/** Vertical grid lines, as day offsets: every Monday; with day detail, every other day boundary as well. */
export function gridColumns(scale: GanttScale): { weeks: number[]; days: number[] } {
  const first = toDayNumber(scale.start);
  const weeks: number[] = [];
  const days: number[] = [];
  for (let i = 0; i < scale.days; i++) {
    if (dayOfWeek(fromDayNumber(first + i)) === 1) weeks.push(i);
    else if (scale.detail === 'day' && i > 0) days.push(i);
  }
  return { weeks, days };
}

/** Holiday columns are drawn whenever a day is at least Month-wide (SPEC §7.8), whatever the zoom. */
export const showsHolidays = (scale: GanttScale): boolean => scale.px >= PX_PER_DAY.month;

/** Weekend columns are drawn whenever a day is at least Week-wide (SPEC §7.8): Day, Week, a wide Fit, the appendix. */
export const showsWeekends = (scale: GanttScale): boolean => scale.px >= PX_PER_DAY.week;

/** Days of the range (from 0) that fall on a Saturday or a Sunday: working days, marked so the week reads (§7.8). */
export function weekendDays(scale: Pick<GanttScale, 'start' | 'days'>): number[] {
  const first = toDayNumber(scale.start);
  const out: number[] = [];
  for (let i = 0; i < scale.days; i++) {
    const dow = dayOfWeek(fromDayNumber(first + i));
    if (dow === 0 || dow === 6) out.push(i);
  }
  return out;
}

/** Width of a timeline chip ("Today", "Status · 13 Nov"), from its text. */
export const chipWidth = (text: string): number => text.length * 6.2 + 12;

/** A timeline chip: its line's x, and where the chip itself is drawn (centre, width). */
export interface ChipBox {
  x: number;
  cx: number;
  w: number;
  text: string;
}

/**
 * Status and Today chips in the top tier (SPEC §7.8): centred on their line, kept inside the chart and clear of the
 * last `rightInset` px (the main view's Gantt corner sits there). When the Today chip would overlap the Status chip
 * it moves beside it, on its own side; with no room there, it is left out.
 */
export function layoutChips(width: number, status?: { x: number; text: string }, today?: { x: number; text: string }, rightInset = 0): { status?: ChipBox; today?: ChipBox } {
  const place = (line: { x: number; text: string }, cx = line.x): ChipBox => {
    const w = chipWidth(line.text);
    return { ...line, cx: Math.max(Math.min(cx, width - rightInset - w / 2 - 2), w / 2 + 2), w };
  };
  const s = status && place(status);
  let t = today && place(today);
  if (s && t) {
    const gap = (s.w + t.w) / 2 + 4;
    if (Math.abs(t.cx - s.cx) < gap) t = place(t, s.cx + (t.x > s.x ? gap : -gap));
    if (Math.abs(t.cx - s.cx) < gap - 0.5) t = undefined;
  }
  return { status: s, today: t };
}

/**
 * Top-tier month label: where its text starts, as an offset from the month's start (6 px), moved to the right of a
 * chip it would run into; null when the month is too narrow or the moved label no longer fits in it. A month that
 * runs past the chart's right `edge` counts only up to it.
 */
export function monthLabelOffset(m: Segment, px: number, chips: readonly ChipBox[], edge = Infinity): number | null {
  const left = m.day * px;
  const right = Math.min((m.day + m.days) * px, edge);
  if (right - left <= 56) return null;
  const textWidth = m.label.length * 7;
  let start = left + 6;
  for (const c of [...chips].sort((a, b) => a.cx - b.cx)) {
    if (start < c.cx + c.w / 2 && start + textWidth > c.cx - c.w / 2) start = c.cx + c.w / 2 + 6;
  }
  if (start > left + 6 && start + textWidth > right - 4) return null;
  return start - left;
}

export interface GanttScale {
  start: ISODate;
  days: number;
  /** Pixels per day. */
  px: number;
  width: number;
  detail: 'day' | 'week' | 'month';
  /** Left edge of a day. */
  x(d: ISODate): number;
}

export function makeScale(start: ISODate, end: ISODate, zoom: Zoom, viewWidth: number): GanttScale {
  const days = dayCount(start, end);
  const px = pxPerDay(zoom, days, viewWidth);
  const first = toDayNumber(start);
  return { start, days, px, width: days * px, detail: detailFor(px), x: (d) => (toDayNumber(d) - first) * px };
}

/**
 * The same scale drawn over at least `width` px: the calendar goes on after the range to the pane's right edge.
 * `x()` and the range start don't change, so the bars stay where they are.
 */
export function fillScale(scale: GanttScale, width: number): GanttScale {
  const days = Math.max(scale.days, Math.ceil(width / scale.px));
  return days === scale.days ? scale : { ...scale, days, width: days * scale.px };
}

/** Days ganttRange always adds after the latest date (5 working days ≥ 5 calendar days). */
const TAIL_DAYS = 5;

/**
 * A scale that fits [start, end] into `width` px (the report's Gantt appendix). With `labelRoom`, the scale shrinks
 * when needed so that at least `labelRoom` px remain right of the latest date for its bar label.
 */
export function fittedScale(start: ISODate, end: ISODate, width: number, labelRoom = 0): GanttScale {
  const days = dayCount(start, end);
  const px = Math.min(width / days, (width - labelRoom) / Math.max(days - TAIL_DAYS, 1));
  const first = toDayNumber(start);
  return { start, days, px, width: days * px, detail: detailFor(px), x: (d) => (toDayNumber(d) - first) * px };
}
