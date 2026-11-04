import { describe, expect, it } from 'vitest';
import { MAX_DAYS } from '../../src/config';
import {
  cellText,
  excelDate,
  formulaText,
  isDateFormat,
  isFormula,
  isInvalidDate,
  keepsTime,
  nameLines,
  parseDate,
  parseDuration,
  parseNumber,
  plainValue,
  tidyLines,
} from '../../src/excel/cells';
import type { CellValue } from '../../src/excel/exceljs';

const utc = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m - 1, d, h));

describe('parseDate — SPEC §4.7', () => {
  it.each<[string, CellValue, string]>([
    ['Excel date cell (UTC midnight)', utc(2026, 10, 1), '2026-10-01'],
    ['date with a time', utc(2026, 10, 1, 18), '2026-10-01'],
    ['serial number', 46296, '2026-10-01'],
    ['serial with a time fraction', 46296.75, '2026-10-01'],
    ['YYYY-MM-DD', '2026-10-01', '2026-10-01'],
    ['d/m/yyyy (day first)', '1/10/2026', '2026-10-01'],
    ['dd/mm/yyyy', '01/10/2026', '2026-10-01'],
    ['d-MMM-yy', '1-Oct-26', '2026-10-01'],
    ['d MMM yyyy', '1 Oct 2026', '2026-10-01'],
    ['full month name, any case', ' 1 october 2026 ', '2026-10-01'],
    ['formula result', { formula: 'TODAY()', result: utc(2026, 10, 1) }, '2026-10-01'],
    ['rich text', { richText: [{ text: '2026-' }, { text: '10-01' }] }, '2026-10-01'],
  ])('%s', (_, value, expected) => {
    expect(parseDate(value)).toEqual({ value: expected, bad: false });
  });

  it.each<[string, CellValue]>([
    ['impossible day', '31/02/2026'],
    ['impossible month', '2026-13-01'],
    ['words', 'next week'],
    ['unknown month', '1-Okt-26'],
    ['two-digit year with slashes', '1/10/26'],
    ['tiny serial (1900)', 5],
    ['before 1950', '1949-12-31'],
    ['after 2199', '2200-01-01'],
    ['boolean', true],
    ['error value', { error: '#N/A' }],
  ])('bad: %s', (_, value) => {
    expect(parseDate(value)).toEqual({ bad: true });
  });

  it('treats empty cells as blank, not bad', () => {
    for (const value of [null, undefined, '', '   ', { formula: 'A1', result: undefined }]) {
      expect(parseDate(value as CellValue)).toEqual({ bad: false });
    }
  });

  it('a huge number (a work-order number in a date column) is bad, never a crash', () => {
    for (const value of [99_999_999, 100_025_570, 4_500_123_456, 1e15, 2_958_466, new Date(Number.NaN)]) {
      expect(parseDate(value)).toEqual({ bad: true });
    }
    expect(parseDate(2_958_465)).toEqual({ bad: true }); // 9999-12-31: a real day, outside 1950–2199
  });

  it('serial numbers in a 1904 workbook count from 1904-01-01', () => {
    expect(parseDate(46296)).toEqual({ value: '2026-10-01', bad: false });
    expect(parseDate(44834, true)).toEqual({ value: '2026-10-01', bad: false });
    expect(parseDate(utc(2026, 10, 1), true)).toEqual({ value: '2026-10-01', bad: false }); // ExcelJS already converted it
  });
});

describe('Buddhist-era years — SPEC §4.7', () => {
  it.each<[string, CellValue, string]>([
    ['date cell', utc(2569, 11, 2), '2026-11-02'],
    ['d/m/yyyy', '2/11/2569', '2026-11-02'],
    ['YYYY-MM-DD', '2569-11-02', '2026-11-02'],
    ['d MMM yyyy', '2 Nov 2569', '2026-11-02'],
    ['Thai month', '2 พ.ย. 2569', '2026-11-02'],
    ['Thai month, 2-digit year', '2 พ.ย. 69', '2026-11-02'],
    ['Thai month in full', '2 พฤศจิกายน 2569', '2026-11-02'],
    ['leap day of the Western year', '29/2/2567', '2024-02-29'],
    ['first year', '1/1/2493', '1950-01-01'],
    ['last year', '31/12/2742', '2199-12-31'],
  ])('%s', (_, value, expected) => {
    expect(parseDate(value)).toEqual({ value: expected, bad: false, buddhist: true });
  });

  it('a Thai month with a Western year is just a date; out-of-range years stay bad', () => {
    expect(parseDate('2 พ.ย. 2026')).toEqual({ value: '2026-11-02', bad: false });
    expect(parseDate('2/11/2026')).toEqual({ value: '2026-11-02', bad: false });
    for (const value of ['2/11/2743', '2200-01-01', '2/11/2492', '29/2/2568', '2 พย 2569x', '2 มกรา 2569']) {
      expect(parseDate(value)).toEqual({ bad: true });
    }
    expect(parseDate(244_337)).toEqual({ bad: true }); // a plain number (a serial in 2569): not reread
  });
});

describe('parseNumber / parseDuration', () => {
  it('accepts numbers and numeric text', () => {
    expect(parseNumber(5)).toEqual({ value: 5, bad: false });
    expect(parseNumber(' 5.5 ')).toEqual({ value: 5.5, bad: false });
    expect(parseNumber('-2')).toEqual({ value: -2, bad: false });
    expect(parseNumber({ formula: '1+1', result: 2 })).toEqual({ value: 2, bad: false });
    expect(parseNumber('')).toEqual({ bad: false });
  });

  it('reads 50% as 50 only for Progress', () => {
    expect(parseNumber('50%', true)).toEqual({ value: 50, bad: false });
    expect(parseNumber('50 %', true)).toEqual({ value: 50, bad: false });
    expect(parseNumber('50%')).toEqual({ bad: true });
  });

  it('rejects other text and values', () => {
    for (const value of ['two', '5 days', '1,000', true, utc(2026, 1, 1), Number.NaN]) expect(parseNumber(value).bad).toBe(true);
  });

  it('Planned Duration rejects negatives', () => {
    expect(parseDuration(-1)).toEqual({ bad: true });
    expect(parseDuration(0)).toEqual({ value: 0, bad: false });
  });

  it('Planned Duration rejects more than MAX_DAYS (a typo or a pasted date serial)', () => {
    expect(parseDuration(MAX_DAYS)).toEqual({ value: MAX_DAYS, bad: false });
    for (const value of [MAX_DAYS + 1, 46000, 100_000_000, '5000', '5000 days']) expect(parseDuration(value)).toEqual({ bad: true });
  });

  it('Planned Duration reads a day unit', () => {
    const cases: [string, number][] = [
      ['5 days', 5],
      ['5 Days', 5],
      ['3d', 3],
      ['3 d', 3],
      ['1 day', 1],
      ['4 วัน', 4],
      ['5 days?', 5],
      [' 2.5 days ', 2.5],
    ];
    for (const [text, value] of cases) expect(parseDuration(text)).toEqual({ value, bad: false, unitRemoved: true });
    for (const text of ['1w', '8h', '5 edays', '-2d', 'five days', '5 days late', 'd', '2 months']) expect(parseDuration(text)).toEqual({ bad: true });
    expect(parseNumber('5 days').bad).toBe(true); // ID and Progress stay strict
  });

  it('a number shown with a date format (ExcelJS gives a Date before 1950) is read as the number', () => {
    expect(parseNumber(utc(1900, 1, 4))).toEqual({ value: 5, bad: false }); // 5 shown as 05-Jan-00
    expect(parseNumber(new Date(Date.UTC(1899, 11, 30, 12)))).toEqual({ value: 0.5, bad: false });
    expect(parseNumber(utc(1904, 1, 6), false, true)).toEqual({ value: 5, bad: false }); // 1904 date system
    expect(parseDuration(utc(1900, 1, 4))).toEqual({ value: 5, bad: false });
    for (const value of [utc(1950, 1, 1), utc(2026, 11, 2), new Date(Number.NaN), utc(1899, 12, 29)]) expect(parseNumber(value)).toEqual({ bad: true });
  });
});

describe('cell text', () => {
  it('shows what the cell shows', () => {
    expect(cellText({ richText: [{ text: 'Pump ' }, { text: 'overhaul' }] })).toBe('Pump overhaul');
    expect(cellText({ text: 'Permit', hyperlink: 'https://example.com' })).toBe('Permit');
    expect(cellText({ formula: 'A1&"x"', result: 'Ax' })).toBe('Ax');
    expect(cellText({ sharedFormula: 'B2', result: 3 })).toBe('3');
    expect(cellText({ error: '#REF!' })).toBe('#REF!');
    expect(cellText(utc(2026, 10, 1))).toBe('2026-10-01');
    expect(cellText(false)).toBe('FALSE');
    expect(cellText(null)).toBe('');
  });

  it('knows formulas and plain values', () => {
    expect(isFormula({ formula: '1+1', result: 2 })).toBe(true);
    expect(isFormula({ sharedFormula: 'A2', result: 2 })).toBe(true);
    expect(isFormula('=1+1')).toBe(false);
    expect(plainValue({ formula: '1+1' })).toBeNull();
  });

  it('shows a formula as Excel does', () => {
    expect(formulaText({ formula: 'TODAY()', result: utc(2026, 10, 20) })).toBe('=TODAY()');
    expect(formulaText({ sharedFormula: 'B4', result: 2 })).toBe('a formula');
    expect(formulaText('=TODAY()')).toBe('');
    expect(formulaText(utc(2026, 10, 20))).toBe('');
  });

  it('a date too large for Excel shows as #####, not as NaN, and is not blank', () => {
    expect(cellText(new Date(Number.NaN))).toBe('#####');
    expect(isInvalidDate(new Date(Number.NaN))).toBe(true);
    expect(isInvalidDate({ formula: 'A1+0', result: new Date(Number.NaN) })).toBe(true);
    expect(isInvalidDate(utc(2026, 10, 1))).toBe(false);
    expect(isInvalidDate(4_500_123_456)).toBe(false);
  });

  it('task names: line breaks (Alt+Enter) are kept in the file, each line tidied', () => {
    expect(tidyLines(' เปิดหน้าแปลน \r\n\n E-101  bay ')).toBe('เปิดหน้าแปลน\nE-101 bay');
    expect(nameLines('เปิดหน้าแปลน\nE-101', 'เปิดหน้าแปลน E-101')).toBe('เปิดหน้าแปลน\nE-101');
    expect(nameLines('เปิดหน้าแปลน \nE-101', 'เปิดหน้าแปลน E-101')).toBe('เปิดหน้าแปลน\nE-101'); // a space before Alt+Enter
    expect(nameLines('A\n\nB', 'A B')).toBe('A\nB'); // a blank line
    expect(nameLines('เปิดหน้าแปลน\nE-101', 'Open flange')).toBeUndefined(); // renamed in the app
    expect(nameLines('A B', 'A B')).toBeUndefined(); // one line: the usual text rule
    expect(nameLines('A\n', 'A')).toBeUndefined(); // only a trailing line break
  });
});

describe('date formats', () => {
  it('recognises date number formats', () => {
    expect(isDateFormat('dd-mmm-yy')).toBe(true);
    expect(isDateFormat('[$-409]d/m/yyyy;@')).toBe(true);
    expect(isDateFormat('General')).toBe(false);
    expect(isDateFormat('0%')).toBe(false);
    expect(isDateFormat('"day "0')).toBe(false);
    expect(isDateFormat(undefined)).toBe(false);
  });

  it('writes a calendar day as UTC midnight', () => {
    expect(excelDate('2026-10-01')).toEqual(utc(2026, 10, 1));
  });

  it('keeps a date cell with a time of day while its day is unchanged', () => {
    expect(keepsTime(utc(2026, 9, 30, 19), '2026-09-30')).toBe(true);
    expect(keepsTime(utc(2026, 9, 30, 19), '2026-10-01')).toBe(false);
    expect(keepsTime('30-Sep-26 19:00', '2026-09-30')).toBe(false);
    expect(keepsTime({ formula: 'E2', result: utc(2026, 9, 30, 19) }, '2026-09-30')).toBe(false); // formulas are never written
  });
});
