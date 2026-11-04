import { describe, expect, it } from 'vitest';
import { MAX_DAYS } from '../../src/config';
import { formatLink, formatLinks, parsePredecessors } from '../../src/engine/links';
import { issuesOf, makeTask, run, taskOf } from './helpers';

const links = (text: string) => parsePredecessors(text).map((t) => t.link);

describe('parsePredecessors — SPEC §5.2 examples', () => {
  it.each([
    ['3', [{ predId: 3, type: 'FS', lag: 0 }]],
    ['3+2', [{ predId: 3, type: 'FS', lag: 2 }]],
    ['3FS+2', [{ predId: 3, type: 'FS', lag: 2 }]],
    ['5SS', [{ predId: 5, type: 'SS', lag: 0 }]],
    ['5ss-1d', [{ predId: 5, type: 'SS', lag: -1 }]],
    [
      '3, 5SS+2',
      [
        { predId: 3, type: 'FS', lag: 0 },
        { predId: 5, type: 'SS', lag: 2 },
      ],
    ],
  ])('%s', (text, expected) => {
    expect(links(text)).toEqual(expected);
  });

  it('ignores whitespace and case, accepts ; as separator', () => {
    expect(links(' 3 fs + 2 ; 4')).toEqual([
      { predId: 3, type: 'FS', lag: 2 },
      { predId: 4, type: 'FS', lag: 0 },
    ]);
  });

  it('treats a zero lag as 0 (never −0)', () => {
    expect(Object.is(links('3-0')[0]?.lag, 0)).toBe(true);
    expect(links('3+0')).toEqual([{ predId: 3, type: 'FS', lag: 0 }]);
  });

  it('skips empty items', () => {
    expect(links('3,,4,')).toHaveLength(2);
    expect(parsePredecessors('')).toEqual([]);
  });

  it('flags invalid tokens and FF/SF', () => {
    for (const bad of ['abc', '3XX', '3+', '+2', '3.5', '3FS+2.5']) {
      expect(parsePredecessors(bad)).toEqual([{ raw: bad, error: 'bad' }]);
    }
    expect(parsePredecessors('3FF, 4sf+1').map((t) => t.error)).toEqual(['unsupported', 'unsupported']);
  });

  it('line breaks separate items like , and ;', () => {
    const both = [
      { predId: 3, type: 'FS', lag: 0 },
      { predId: 4, type: 'FS', lag: 0 },
    ];
    expect(links('3\n4')).toEqual(both);
    expect(links('3\r\n4')).toEqual(both);
    expect(links('3,\n4\n')).toEqual(both);
  });

  it('whitespace between two numbers is invalid, never one merged ID', () => {
    for (const bad of ['3 4', '1 20', '3\t4', '3+2 0', '3 SS 4']) {
      expect(parsePredecessors(bad)).toEqual([{ raw: bad, error: 'bad' }]);
    }
    expect(links('3 SS + 2')).toEqual([{ predId: 3, type: 'SS', lag: 2 }]);
    expect(links('3 + 2d')).toEqual([{ predId: 3, type: 'FS', lag: 2 }]);
  });

  it(`a lag beyond ${MAX_DAYS} working days is invalid`, () => {
    expect(links(`3+${MAX_DAYS}, 4SS-${MAX_DAYS}`)).toEqual([
      { predId: 3, type: 'FS', lag: MAX_DAYS },
      { predId: 4, type: 'SS', lag: -MAX_DAYS },
    ]);
    for (const bad of [`3+${MAX_DAYS + 1}`, `4SS-${MAX_DAYS + 1}`, '3FS+100000000', '3+99999999999999999999']) {
      expect(parsePredecessors(bad)).toEqual([{ raw: bad, error: 'bad' }]);
    }
  });
});

describe('canonical output', () => {
  it('formats each link type', () => {
    expect(formatLink({ predId: 3, type: 'FS', lag: 0 })).toBe('3');
    expect(formatLink({ predId: 3, type: 'FS', lag: 2 })).toBe('3FS+2');
    expect(formatLink({ predId: 3, type: 'FS', lag: -2 })).toBe('3FS-2');
    expect(formatLink({ predId: 5, type: 'SS', lag: 0 })).toBe('5SS');
    expect(formatLink({ predId: 5, type: 'SS', lag: -1 })).toBe('5SS-1');
  });

  it("keeps the user's order, joined with ', '", () => {
    expect(
      formatLinks([
        { predId: 5, type: 'SS', lag: -1 },
        { predId: 3, type: 'FS', lag: 2 },
      ]),
    ).toBe('5SS-1, 3FS+2');
  });

  it('rewrites valid text in canonical form and records the change', () => {
    const r = run([makeTask(1, { plannedDuration: 1 }), makeTask(2, { plannedDuration: 1 }), makeTask(3, { predecessorsText: '2ss;1+2' })]);
    expect(taskOf(r, 3).predecessorsText).toBe('2SS, 1FS+2');
    expect(r.changes).toContainEqual(expect.objectContaining({ taskId: 3, field: 'Predecessors', from: '2ss;1+2', to: '2SS, 1FS+2' }));
    expect(r.changes.some((c) => c.field === 'Predecessors' && c.taskId !== 3)).toBe(false);
  });
});

describe('link errors (issue + token ignored; text written back unchanged)', () => {
  const base = () => [makeTask(1, { plannedDuration: 5 }), makeTask(2, { plannedDuration: 1 })];

  it('E_BAD_LINK keeps the valid tokens for calculation', () => {
    const r = run([...base(), makeTask(3, { predecessorsText: '1, abc', plannedDuration: 1 })]);
    expect(r.issues).toContainEqual(
      expect.objectContaining({ code: 'E_BAD_LINK', severity: 'error', taskId: 3, message: 'Task 3: "abc" is not valid predecessor notation' }),
    );
    expect(taskOf(r, 3).predecessorsText).toBe('1, abc');
    expect(taskOf(r, 3).links).toEqual([{ predId: 1, type: 'FS', lag: 0 }]);
    expect(taskOf(r, 3).plannedStart).toBe('2026-11-07');
  });

  it('E_UNSUPPORTED_LINK for FF/SF', () => {
    const r = run([...base(), makeTask(3, { predecessorsText: '1FF', plannedDuration: 1 })]);
    expect(issuesOf(r, 3)).toEqual(['E_UNSUPPORTED_LINK']);
    expect(r.issues[0]?.message).toBe('Task 3: FF/SF links are not supported yet');
    expect(taskOf(r, 3).predecessorsText).toBe('1FF');
    expect(taskOf(r, 3).plannedStart).toBe('2026-11-02'); // root: Project Start
  });

  it('E_MISSING_PRED offers "Remove link"', () => {
    const r = run([...base(), makeTask(3, { predecessorsText: '9', plannedDuration: 1 })]);
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'E_MISSING_PRED',
        message: 'Task 3: predecessor 9 does not exist',
        fix: { kind: 'removeLink', taskId: 3, predId: 9 },
      }),
    ]);
    expect(taskOf(r, 3).predecessorsText).toBe('9');
  });

  it('E_SELF_LINK offers "Remove link"', () => {
    const r = run([...base(), makeTask(3, { predecessorsText: '3', plannedDuration: 1 })]);
    expect(r.issues).toEqual([
      expect.objectContaining({ code: 'E_SELF_LINK', message: 'Task 3 cannot depend on itself', fix: { kind: 'removeLink', taskId: 3, predId: 3 } }),
    ]);
    expect(taskOf(r, 3).links).toEqual([]);
  });

  it('IDs separated only by a space: E_BAD_LINK, text kept; by a line break: two links in canonical form', () => {
    const spaced = run([...base(), makeTask(3, { predecessorsText: '1 2', plannedDuration: 1 })]);
    expect(spaced.issues).toEqual([expect.objectContaining({ code: 'E_BAD_LINK', taskId: 3, message: 'Task 3: "1 2" is not valid predecessor notation' })]);
    expect(taskOf(spaced, 3)).toMatchObject({ predecessorsText: '1 2', links: [] });
    expect(spaced.changes.some((c) => c.field === 'Predecessors')).toBe(false);

    const lines = run([...base(), makeTask(3, { predecessorsText: '1\n2', plannedDuration: 1 })]);
    expect(lines.issues).toEqual([]);
    expect(taskOf(lines, 3).links.map((l) => l.predId)).toEqual([1, 2]);
    expect(taskOf(lines, 3).predecessorsText).toBe('1, 2');
    expect(lines.changes).toContainEqual(expect.objectContaining({ taskId: 3, field: 'Predecessors', from: '1\n2', to: '1, 2', kind: 'corrected' }));
  });

  it('a huge lag is E_BAD_LINK, kept as typed, and never throws', () => {
    const r = run([...base(), makeTask(3, { predecessorsText: '1FS+100000000, 2', plannedDuration: 1 })]);
    expect(issuesOf(r, 3)).toEqual(['E_BAD_LINK']);
    expect(taskOf(r, 3)).toMatchObject({ predecessorsText: '1FS+100000000, 2', plannedStart: '2026-11-03' });
  });

  it('W_DUP_LINK keeps the first link to the same predecessor', () => {
    const r = run([...base(), makeTask(3, { predecessorsText: '1, 1SS+2', plannedDuration: 1 })]);
    expect(r.issues).toEqual([
      expect.objectContaining({ code: 'W_DUP_LINK', severity: 'warning', message: 'Task 3: predecessor 1 is listed more than once' }),
    ]);
    expect(taskOf(r, 3).links).toEqual([{ predId: 1, type: 'FS', lag: 0 }]);
    expect(taskOf(r, 3).predecessorsText).toBe('1, 1SS+2');
  });
});

describe('successors', () => {
  it("lists every task linking to T, formatted from that task's link, in row order", () => {
    const r = run([
      makeTask(1, { plannedDuration: 2 }),
      makeTask(4, { predecessorsText: '2, 1FS+1', plannedDuration: 1 }),
      makeTask(2, { predecessorsText: '1SS+2', plannedDuration: 1 }),
      makeTask(3, { predecessorsText: '1', plannedDuration: 1 }),
    ]);
    expect(taskOf(r, 1).successorsText).toBe('4FS+1, 2SS+2, 3');
    expect(taskOf(r, 2).successorsText).toBe('4');
    expect(taskOf(r, 3).successorsText).toBe('');
  });
});
