import { describe, expect, it } from 'vitest';
import { createCalendar } from '../../src/engine/calendar';
import { arrowHead, linkPath } from '../../src/ui/gantt/arrows';
import { bottomSegments, dayCount, detailFor, ganttRange, isoWeek, monthSegments, pxPerDay } from '../../src/ui/gantt/scale';

describe('Gantt range — SPEC §7.8', () => {
  const cal = createCalendar(['2026-10-13', '2026-10-23']);

  it('earliest − 3 working days → latest + 5 working days', () => {
    // The sample: 28 Sep → 17 Oct, status date 30 Sep.
    expect(ganttRange(['2026-10-01', '2026-09-28', '2026-10-17'], '2026-09-30', cal)).toEqual({ start: '2026-09-25', end: '2026-10-22' });
  });

  it('skips holidays when counting working days', () => {
    expect(ganttRange(['2026-10-14'], '2026-10-14', cal).start).toBe('2026-10-10'); // 13 Oct is a holiday
    expect(ganttRange(['2026-10-20'], '2026-10-20', cal).end).toBe('2026-10-26'); // 23 Oct is a holiday
  });

  it('always includes the status date, with the same margins', () => {
    expect(ganttRange(['2026-11-02'], '2026-12-01', cal)).toEqual({ start: '2026-10-30', end: '2026-12-06' });
    expect(ganttRange(['2026-11-02'], '2026-10-01', cal)).toEqual({ start: '2026-09-28', end: '2026-11-07' });
    expect(ganttRange([], '2026-10-01', cal)).toEqual({ start: '2026-09-28', end: '2026-10-06' });
  });

  it('counts days inclusively', () => {
    expect(dayCount('2026-09-25', '2026-10-22')).toBe(28);
  });
});

describe('zoom', () => {
  it('Day, Week, Month have fixed scales; Fit shows every day, between Month and Day', () => {
    expect([pxPerDay('day', 28, 700), pxPerDay('week', 28, 700), pxPerDay('month', 28, 700)]).toEqual([32, 12, 4]);
    expect(pxPerDay('fit', 28, 700)).toBe(25);
    expect(pxPerDay('fit', 5, 700)).toBe(32);
    expect(pxPerDay('fit', 500, 700)).toBe(4);
  });

  it('picks the timeline detail from the room a day gets', () => {
    expect([32, 20, 19, 12, 10, 9, 4].map(detailFor)).toEqual(['day', 'day', 'week', 'week', 'week', 'month', 'month']);
  });
});

describe('timeline header', () => {
  it('ISO week numbers (weeks start on Monday)', () => {
    expect(isoWeek('2026-11-10')).toBe(46);
    expect(isoWeek('2026-09-28')).toBe(40);
    expect(isoWeek('2026-01-01')).toBe(1);
    expect(isoWeek('2027-01-01')).toBe(53); // 2026 has 53 ISO weeks
    expect(isoWeek('2027-01-04')).toBe(1);
  });

  it('top tier: months', () => {
    expect(monthSegments('2026-09-25', 28)).toEqual([
      { label: 'Sep 2026', day: 0, days: 6 },
      { label: 'Oct 2026', day: 6, days: 22 },
    ]);
  });

  it('bottom tier: days, weeks from Monday, or Monday ticks', () => {
    expect(bottomSegments('2026-09-25', 4, 'day')).toEqual([
      { label: '25', day: 0, days: 1 },
      { label: '26', day: 1, days: 1 },
      { label: '27', day: 2, days: 1 },
      { label: '28', day: 3, days: 1 },
    ]);
    expect(bottomSegments('2026-09-25', 12, 'week')).toEqual([
      { label: '', day: 0, days: 3 }, // Fri–Sun before the first Monday
      { label: 'W40 · 28 Sep', day: 3, days: 7 },
      { label: 'W41 · 5 Oct', day: 10, days: 2 },
    ]);
    expect(bottomSegments('2026-09-28', 15, 'month').map((s) => s.label)).toEqual(['28', '5', '12']);
  });
});

describe('dependency arrows — SPEC §7.8', () => {
  it('FS: right from the bar end, down, into the successor', () => {
    expect(linkPath('FS', { x: 100, y: 18 }, { x: 140, y: 54 }, 36)).toBe('M100,18 L105,18 Q108,18 108,21 L108,51 Q108,54 111,54 L140,54');
  });

  it('FS into a successor that starts too early: detour between the rows', () => {
    const path = linkPath('FS', { x: 100, y: 18 }, { x: 100, y: 90 }, 36);
    expect(path).toContain('Q108,36');
    expect(path).toContain('Q92,36');
    expect(path.endsWith('L100,90')).toBe(true);
  });

  it('SS: left from the bar start, also for a lead', () => {
    expect(linkPath('SS', { x: 50, y: 18 }, { x: 60, y: 54 }, 36)).toMatch(/^M50,18 L45,18 Q42,18 42,21 .* L60,54$/);
    expect(linkPath('SS', { x: 80, y: 54 }, { x: 40, y: 18 }, 36)).toContain('Q32,54');
  });

  it('arrowhead points right at the successor start', () => {
    expect(arrowHead({ x: 140, y: 54 })).toBe('M140,54 l-4,-3 v6 z');
  });
});
