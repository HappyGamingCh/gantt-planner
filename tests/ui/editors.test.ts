import { describe, expect, it } from 'vitest';
import { MAX_DAYS } from '../../src/config';
import { addNames } from '../../src/ui/common/assignees';
import { parseDuration, parseProgress } from '../../src/ui/common/numbers';
import { dateEditProblem, floatingPosition, floatingState } from '../../src/ui/grid/editing';

describe('cell popover position — SPEC §7.7', () => {
  const cell = (top: number) => ({ top, bottom: top + 36, left: 300 });

  it('opens under the cell when it fits, even near the bottom of a 720 px window', () => {
    // A row at y = 508 (the 8th visible row): the 85 px Progress popover still fits below.
    expect(floatingPosition(cell(508), 280, 85, 1280, 720)).toEqual({ left: 300, top: 548 });
  });

  it('opens just above the cell, anchored by its bottom edge, only when it does not fit below', () => {
    expect(floatingPosition(cell(640), 280, 85, 1280, 720)).toEqual({ left: 300, bottom: 720 - 640 + 4 });
  });

  it('stays below when it fits neither way', () => {
    expect(floatingPosition(cell(60), 280, 700, 1280, 720)).toEqual({ left: 300, top: 100 });
  });

  it('stays inside the window sideways, by its measured width', () => {
    expect(floatingPosition({ top: 100, bottom: 136, left: -50 }, 280, 85, 1280, 720).left).toBe(8);
    expect(floatingPosition({ top: 100, bottom: 136, left: 1200 }, 280, 85, 1280, 720).left).toBe(1280 - 280 - 8);
  });
});

describe('cell popover follows its cell — SPEC §7.7', () => {
  const pane = { top: 100, bottom: 700 }; // rows start under the timeline header (100 + TIMELINE_HEIGHT)
  const cell = (top: number) => ({ top, bottom: top + 36, left: 300 });

  it('follows the cell while it is in the pane', () => {
    expect(floatingState(cell(300), pane, true, true)).toBe('place');
    expect(floatingState(cell(300), undefined, true, true)).toBe('place');
  });

  it('a scroll that takes the cell away ends a popover and hides a hint', () => {
    expect(floatingState(cell(720), pane, true, true)).toBe('lost'); // below the pane
    expect(floatingState(cell(100), pane, true, true)).toBe('lost'); // under the timeline header
    expect(floatingState(cell(720), pane, true, false)).toBe('hide');
  });

  it('opening or growing never ends the edit, even with the cell out of view: the box waits for it', () => {
    // A typed key on a cell scrolled away by the wheel must not save it at once, off-screen (#33).
    expect(floatingState(cell(720), pane, false, true)).toBe('wait');
    expect(floatingState(cell(100), pane, false, false)).toBe('wait');
  });
});

describe('date editor — SPEC §7.7, §4.3 (1950–2199)', () => {
  it('refuses a half-typed date, whatever the input reports as its value', () => {
    expect(dateEditProblem('', true)).toBe('Enter a complete date, or clear every part');
  });

  it('a date with every part cleared is blank, not half typed: it clears the cell', () => {
    expect(dateEditProblem('', false)).toBeUndefined();
  });

  it('only 1950–2199', () => {
    expect(dateEditProblem('2026-09-30', false)).toBeUndefined();
    expect(dateEditProblem('1950-01-01', false)).toBeUndefined();
    expect(dateEditProblem('2199-12-31', false)).toBeUndefined();
    expect(dateEditProblem('0026-09-30', false)).toBe('Enter a date between 1950 and 2199');
    expect(dateEditProblem('2200-01-01', false)).toBe('Enter a date between 1950 and 2199');
  });
});

describe('duration editor — SPEC §7.7 "inline input with validation"', () => {
  it('keeps the decimal point: 1.5 is rounded to 2 days with a note, never read as 15', () => {
    expect(parseDuration('1.5')).toEqual({ value: 2, note: 'Rounded to 2 days — whole working days only' });
    expect(parseDuration('0,5')).toEqual({ value: 1, note: 'Rounded to 1 day — whole working days only' });
    expect(parseDuration('.4').value).toBe(0);
    expect(parseDuration(' 12 ')).toEqual({ value: 12, note: undefined });
  });

  it('blank is no change', () => {
    expect(parseDuration('')).toEqual({});
    expect(parseDuration('  ')).toEqual({});
  });

  it('rejects text, negatives and more than MAX_DAYS with a message', () => {
    expect(parseDuration('a').error).toBe('Enter whole working days, e.g. 5');
    expect(parseDuration('5d').error).toBe('Enter whole working days, e.g. 5');
    expect(parseDuration('1e3').error).toBe('Enter whole working days, e.g. 5');
    expect(parseDuration('-1').error).toBe("Duration can't be negative");
    expect(parseDuration(String(MAX_DAYS)).value).toBe(MAX_DAYS);
    expect(parseDuration(String(MAX_DAYS + 1)).error).toBe(`Duration must be 0–${MAX_DAYS} days`);
    expect(parseDuration('30000').value).toBeUndefined();
  });
});

describe('progress editor — SPEC §7.7, §8', () => {
  it('reads a typed percent; a decimal is rounded', () => {
    expect(parseProgress('50')).toEqual({ value: 50 });
    expect(parseProgress('33')).toEqual({ value: 33 });
    expect(parseProgress('33.5')).toEqual({ value: 34 });
    expect(parseProgress('0')).toEqual({ value: 0 });
    expect(parseProgress('100')).toEqual({ value: 100 });
  });

  it('blank is no change; outside 0–100 or not a number is an error', () => {
    expect(parseProgress('')).toEqual({});
    for (const text of ['101', '-5', 'abc', '5%']) expect(parseProgress(text).error).toBe('Enter a percent from 0 to 100');
  });
});

describe('assignee names typed or pasted — SPEC §4.3, §7.7', () => {
  const suggestions = ['ACME', 'ThermCo', 'Refracto'];

  it('splits on "," and ";" as the Assigned cell is read, so a pasted list gives several names', () => {
    expect(addNames([], 'ACME, ThermCo', suggestions)).toEqual(['ACME', 'ThermCo']);
    expect(addNames(['NDT'], ' Somchai ;  Team  A ,', suggestions)).toEqual(['NDT', 'Somchai', 'Team A']);
  });

  it('takes the spelling of a matching suggestion and skips names already there', () => {
    expect(addNames(['NDT'], 'acme', suggestions)).toEqual(['NDT', 'ACME']);
    expect(addNames(['ACME'], 'acme, refracto', suggestions)).toEqual(['ACME', 'Refracto']);
  });

  it('returns the same list when nothing is added', () => {
    const names = ['ACME'];
    expect(addNames(names, '', suggestions)).toBe(names);
    expect(addNames(names, ' , ; ', suggestions)).toBe(names);
    expect(addNames(names, 'Acme', suggestions)).toBe(names);
  });

  it('keeps Thai names as typed', () => {
    expect(addNames([], 'ทีมเครื่องกล, สมชาย ใจดี', suggestions)).toEqual(['ทีมเครื่องกล', 'สมชาย ใจดี']);
  });
});
