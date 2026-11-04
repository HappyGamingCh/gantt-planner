// Cell value parsing (SPEC §4.7). Pure functions over ExcelJS cell values; nothing here throws.
import { MAX_DAYS } from '../config';
import { fromDayNumber, isPlanDate } from '../engine/dates';
import type { ISODate } from '../engine/types';
import type { CellValue } from './exceljs';

type Plain = string | number | boolean | Date | null;

/** What the cell shows: a formula's cached result, a hyperlink's text, rich text joined, an error code. */
export function plainValue(value: CellValue): Plain {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || value instanceof Date) return value;
  if ('formula' in value || 'sharedFormula' in value) return plainValue(value.result ?? null);
  if ('richText' in value) return value.richText.map((r) => r.text).join('');
  if ('hyperlink' in value) return plainValue(value.text);
  if ('error' in value) return value.error;
  return null;
}

export function isFormula(value: CellValue): boolean {
  return typeof value === 'object' && value !== null && ('formula' in value || 'sharedFormula' in value);
}

/** A formula as Excel's formula bar shows it (`=TODAY()`); '' for any other value. */
export function formulaText(value: CellValue): string {
  if (typeof value !== 'object' || value === null || value instanceof Date || !isFormula(value)) return '';
  return 'formula' in value && typeof value.formula === 'string' ? `=${value.formula}` : 'a formula';
}

/** Cell text, untrimmed. Dates become ISO dates; a date too large for Excel shows as Excel shows it (#####). */
export function cellText(value: CellValue): string {
  const v = plainValue(value);
  if (v === null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '#####' : utcDate(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

export function isBlank(value: CellValue): boolean {
  return cellText(value).trim() === '';
}

/** A number too large for a date in a date-formatted cell (Excel shows #####): ExcelJS loads it as an Invalid Date. */
export function isInvalidDate(value: CellValue): boolean {
  const v = plainValue(value);
  return v instanceof Date && Number.isNaN(v.getTime());
}

/** Trim and collapse repeated spaces (task, assignee and resource names). */
export function cleanName(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Each line trimmed with single spaces, blank lines dropped: a tidy multi-line (Alt+Enter) Task cell is unchanged. */
export function tidyLines(text: string): string {
  return text.split(/\r\n?|\n/).map(cleanName).filter(Boolean).join('\n');
}

/**
 * What Save writes in a Task cell with line breaks (Alt+Enter) that reads as `name`: its lines, tidied (the app shows
 * names on one line). Undefined when the cell has a single line or the name was changed in the app.
 */
export function nameLines(text: string, name: string): string | undefined {
  const lines = tidyLines(text);
  return lines.includes('\n') && cleanName(text) === name ? lines : undefined;
}

export interface Parsed<T> {
  value?: T;
  /** Not blank, but not understood: the caller warns and keeps the original text. */
  bad: boolean;
  /** Planned Duration text with a day unit (`5 days`), read as the number: the reader records a Change. */
  unitRemoved?: boolean;
  /** A Buddhist-era year (2569 → 2026) was converted: the reader records a Change. */
  buddhist?: boolean;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const THAI_MONTHS = ['มค', 'กพ', 'มีค', 'เมย', 'พค', 'มิย', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค']; // ม.ค. … ธ.ค. without dots
const THAI_MONTH_NAMES = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];
const EXCEL_EPOCH = -25569; // day number of 1899-12-30, Excel's day 0
const EXCEL_EPOCH_1904 = -24107; // day number of 1904-01-01, day 0 of the 1904 date system (old Mac workbooks)
const MAX_SERIAL = 2958465; // 9999-12-31, Excel's last day; a larger number would overflow a JS Date
const FIRST_PLAN_DAY = Date.UTC(1950, 0, 1);
const MS_PER_DAY = 86_400_000;

/** Thai users type Buddhist-era (พ.ศ.) years: 2493–2742 is 1950–2199 + 543, so no accepted year is ever reread. */
const BE_OFFSET = 543;
const isBuddhistYear = (y: number) => y >= 1950 + BE_OFFSET && y <= 2199 + BE_OFFSET;

const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function utcDate(d: Date): ISODate {
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

type Ymd = [year: number, month: number, day: number];

/**
 * Excel date cell, serial number, `YYYY-MM-DD`, `d/m/yyyy`, `d-MMM-yy` or `d MMM yyyy` (English or Thai month).
 * Dates must fall in 1950–2199 so a stray small number can't stretch the plan back to 1900; a Buddhist-era year is
 * converted first. `date1904`: the workbook counts serial numbers from 1904 (ExcelJS converts date cells itself).
 */
export function parseDate(value: CellValue, date1904 = false): Parsed<ISODate> {
  const v = plainValue(value);
  if (v === null || (typeof v === 'string' && v.trim() === '')) return { bad: false };
  let ymd: Ymd | undefined;
  if (v instanceof Date) {
    if (!Number.isNaN(v.getTime())) ymd = [v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()];
  } else if (typeof v === 'number') {
    // Range first: a 10-digit number (a work-order number in the wrong column) would overflow a Date.
    if (Number.isFinite(v) && v >= 1 && v <= MAX_SERIAL) {
      const [y, m, d] = fromDayNumber(Math.floor(v) + (date1904 ? EXCEL_EPOCH_1904 : EXCEL_EPOCH)).split('-').map(Number);
      ymd = [y, m, d];
    }
  } else if (typeof v === 'string') {
    ymd = parseDateText(v.trim());
  }
  if (!ymd) return { bad: true };
  // Only a date the user sees as one (a date cell or text): a plain number of 6 digits is more likely a stray number.
  const buddhist = typeof v !== 'number' && isBuddhistYear(ymd[0]);
  const date = iso(buddhist ? ymd[0] - BE_OFFSET : ymd[0], ymd[1], ymd[2]);
  if (!isPlanDate(date)) return { bad: true };
  return buddhist ? { value: date, bad: false, buddhist } : { value: date, bad: false };
}

function parseDateText(s: string): Ymd | undefined {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return [Number(m[3]), Number(m[2]), Number(m[1])];
  m = /^(\d{1,2})[-\s]([a-z]{3,9})\.?[-\s,]+(\d{2}|\d{4})$/i.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (month > 0) return [year, month, Number(m[1])];
  }
  // Thai month, with or without dots or in full: `2 พ.ย. 2569`, `2 พฤศจิกายน 2569`. A 2-digit year is then Buddhist-era.
  m = /^(\d{1,2})\s*([฀-๿.]+?)\s*(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const name = m[2].replace(/\./g, '');
    const month = Math.max(THAI_MONTHS.indexOf(name), THAI_MONTH_NAMES.indexOf(name)) + 1;
    const year = m[3].length === 2 ? 2500 + Number(m[3]) : Number(m[3]);
    if (month > 0) return [year, month, Number(m[1])];
  }
  return undefined;
}

/**
 * A number or numeric text; with `percentText`, `50%` reads as 50. ExcelJS hands a number in a date-formatted cell
 * over as a Date (Planned Duration 5 shows as 05-Jan-00): before 1950 it can only be such a number, so it is read
 * back as its serial; a real date stays bad.
 */
export function parseNumber(value: CellValue, percentText = false, date1904 = false): Parsed<number> {
  const v = plainValue(value);
  if (v === null || (typeof v === 'string' && v.trim() === '')) return { bad: false };
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v, bad: false } : { bad: true };
  if (v instanceof Date) {
    const t = v.getTime();
    // The inverse of ExcelJS's serial → Date conversion.
    const serial = Math.round((t / MS_PER_DAY - (date1904 ? EXCEL_EPOCH_1904 : EXCEL_EPOCH)) * 1e6) / 1e6;
    return Number.isFinite(serial) && serial >= 0 && t < FIRST_PLAN_DAY ? { value: serial, bad: false } : { bad: true };
  }
  if (typeof v !== 'string') return { bad: true };
  let s = v.trim();
  if (percentText && s.endsWith('%')) s = s.slice(0, -1).trim();
  return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s) ? { value: Number(s), bad: false } : { bad: true };
}

/** A day unit after a duration: `5d`, `5 d`, `1 day`, `5 Days`, `5 วัน`, MS Project's estimated `5 days?`. */
const DAY_UNIT = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*(?:d|days?|วัน)\s*\??\s*$/i;

/**
 * Planned Duration: a number of working days from 0 to MAX_DAYS, also with a day unit (`unitRemoved`). A negative or
 * huge number is as bad as text: a typo can't stretch the plan over centuries.
 */
export function parseDuration(value: CellValue, date1904 = false): Parsed<number> {
  const v = plainValue(value);
  const unit = typeof v === 'string' ? DAY_UNIT.exec(v) : null;
  const p: Parsed<number> = unit ? { value: Number(unit[1]), bad: false, unitRemoved: true } : parseNumber(value, false, date1904);
  return p.value !== undefined && (p.value < 0 || p.value > MAX_DAYS) ? { bad: true } : p;
}

/** An Excel number format that shows a date (d, m or y outside quotes and brackets). */
export function isDateFormat(numFmt: string | undefined): boolean {
  return !!numFmt && /[dmy]/i.test(numFmt.replace(/"[^"]*"|\[[^\]]*\]/g, ''));
}

/** A percent number format: `%` outside quoted text, [..] sections and escaped characters (`0"%"` is not one). */
export function isPercentFormat(numFmt: string | undefined): boolean {
  return !!numFmt && numFmt.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').includes('%');
}

/** ISO date → the Date ExcelJS writes as that calendar day. */
export function excelDate(d: ISODate): Date {
  return new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))));
}

/** A date cell on `day`, perhaps with a time of day (a night-shift start at 19:00): the app plans whole days, so
 * Save keeps such a cell as it is while its day is unchanged. */
export function keepsTime(original: CellValue, day: ISODate): boolean {
  return original instanceof Date && !Number.isNaN(original.getTime()) && utcDate(original) === day;
}
