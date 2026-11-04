import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, loadPrefs, savePrefs } from '../../src/store/prefs';

/** An in-memory localStorage. */
function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preferences — SPEC §7.13', () => {
  it('fall back to the defaults when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(DEFAULT_PREFS)).not.toThrow();
  });

  it('keep Color by and the critical path with the other view settings', () => {
    stubStorage();
    savePrefs({ ...DEFAULT_PREFS, colorBy: 'assignee', critical: true, zoom: 'week', columns: { ...DEFAULT_PREFS.columns, Plan: ['duration', 'critical'] } });
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, colorBy: 'assignee', critical: true, zoom: 'week', columns: { ...DEFAULT_PREFS.columns, Plan: ['duration', 'critical'] } });
  });

  it('keep the Print Gantt paper (§9.4); anything else is A4', () => {
    stubStorage();
    expect(loadPrefs().printPaper).toBe('A4');
    savePrefs({ ...DEFAULT_PREFS, printPaper: 'A3' });
    expect(loadPrefs().printPaper).toBe('A3');
    stubStorage({ 'gantt-planner:prefs': JSON.stringify({ printPaper: 'Letter' }) });
    expect(loadPrefs().printPaper).toBe('A4');
  });

  it('ignore values they do not know', () => {
    stubStorage({
      'gantt-planner:prefs': JSON.stringify({ colorBy: 'rainbow', critical: 'yes', zoom: 'year', gridWidth: 5000, columns: { Plan: ['critical', 'nope'] } }),
    });
    expect(loadPrefs()).toMatchObject({ colorBy: 'status', critical: false, zoom: 'fit', gridWidth: { Plan: 900, Track: 900 }, columns: { Plan: ['critical'] } });
  });

  it('keep the grid width per mode (§7.3); null fits the columns', () => {
    stubStorage();
    expect(loadPrefs().gridWidth).toEqual({ Plan: null, Track: null });
    savePrefs({ ...DEFAULT_PREFS, gridWidth: { Plan: 640, Track: null } });
    expect(loadPrefs().gridWidth).toEqual({ Plan: 640, Track: null });
    savePrefs({ ...DEFAULT_PREFS, gridWidth: { Plan: null, Track: 560 } });
    expect(loadPrefs().gridWidth).toEqual({ Plan: null, Track: 560 }); // 560 is only the old default in the old format
    stubStorage({ 'gantt-planner:prefs': JSON.stringify({ gridWidth: { Plan: 'wide', Track: 100.4 } }) });
    expect(loadPrefs().gridWidth).toEqual({ Plan: null, Track: 320 });
    stubStorage({ 'gantt-planner:prefs': JSON.stringify({ gridWidth: null }) });
    expect(loadPrefs().gridWidth).toEqual({ Plan: null, Track: null });
  });

  it('move an older single grid width to both modes; the old default 560 becomes "fit the columns"', () => {
    stubStorage({ 'gantt-planner:prefs': JSON.stringify({ gridWidth: 560 }) });
    expect(loadPrefs().gridWidth).toEqual({ Plan: null, Track: null });
    stubStorage({ 'gantt-planner:prefs': JSON.stringify({ gridWidth: 700 }) });
    expect(loadPrefs().gridWidth).toEqual({ Plan: 700, Track: 700 });
  });

  it('keep the KPI strip collapsed (§7.3); anything but true is expanded', () => {
    stubStorage();
    expect(loadPrefs().kpiCollapsed).toBe(false);
    savePrefs({ ...DEFAULT_PREFS, kpiCollapsed: true });
    expect(loadPrefs().kpiCollapsed).toBe(true);
    stubStorage({ 'gantt-planner:prefs': JSON.stringify({ kpiCollapsed: 'yes' }) });
    expect(loadPrefs().kpiCollapsed).toBe(false);
  });

  it('keep the look-ahead window in days (§9.1); an old weeks value falls back to 7 days', () => {
    stubStorage();
    expect(loadPrefs().report.lookAheadDays).toBe(7);
    savePrefs({ ...DEFAULT_PREFS, report: { ...DEFAULT_PREFS.report, lookAheadDays: 14 } });
    expect(loadPrefs().report.lookAheadDays).toBe(14);
    stubStorage({ 'gantt-planner:prefs': JSON.stringify({ report: { attention: false, lookAheadWeeks: 4 } }) });
    expect(loadPrefs().report).toEqual({ ...DEFAULT_PREFS.report, attention: false, lookAheadDays: 7 });
    stubStorage({ 'gantt-planner:prefs': JSON.stringify({ report: { lookAheadDays: 5 } }) });
    expect(loadPrefs().report.lookAheadDays).toBe(7);
  });
});
