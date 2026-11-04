// Opening another workbook starts the main view afresh (SPEC §7.7): no active cell carried over from the last file,
// and the grid and the Gantt back at the first row. Mounted in a fake DOM (fakeDom.ts) so the Grid's own state and
// the panes' scroll offsets are real.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { findAll, fire, hasClass, installFakeDom, type FakeDocument, type FakeElement } from './fakeDom';

let doc: FakeDocument;
beforeAll(() => {
  doc = installFakeDom();
  vi.spyOn(console, 'error').mockImplementation(() => {}); // React's dev warnings about the fake DOM
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a new file resets the grid — SPEC §7.7', () => {
  it('opening file B after working in file A: no active cell, both panes at the top', async () => {
    // Imported once the fake DOM is in place: react-dom checks for a DOM when it loads.
    const { act, createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { useStore } = await import('../../src/store/store');
    const { discardChanges, openDropped, openSample } = await import('../../src/store/files');
    const { MainView } = await import('../../src/ui/main/MainView');

    const loaded = async (session: number) => {
      await vi.waitFor(() => expect(useStore.getState().session).toBeGreaterThan(session), { timeout: 10_000 });
      expect(useStore.getState().busy).toBeNull();
    };
    const all = (test: (el: FakeElement) => boolean) => findAll(doc.body, test);
    const pane = (name: string) => all(hasClass(name))[0]!;
    const rowOf = (cell: FakeElement) => cell.parentNode?.getAttribute('data-row');

    // File A: the sample, with the grid scrolled down and a cell on row 20 active.
    openSample();
    await loaded(0);
    const container = doc.body.appendChild(doc.createElement('div'));
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => root.render(createElement(MainView)));
    const row20 = all((el) => el.getAttribute('data-row') === '20')[0]!;
    await act(async () => void fire(row20.children[1]!, 'click'));
    expect(all(hasClass('cell-active')).map(rowOf)).toEqual(['20']);
    pane('pane-grid').scrollTop = 480;
    pane('pane-gantt').scrollTop = 480;

    // File B: messy.xlsx dropped on the window (answering "Discard changes" if file A had any).
    const before = useStore.getState().session;
    const bytes = readFileSync(new URL('../fixtures/messy.xlsx', import.meta.url));
    const drop = { items: [], files: [new File([bytes], 'messy.xlsx')] } as unknown as DataTransfer;
    await act(async () => {
      openDropped(drop);
      if (useStore.getState().dialog?.kind === 'discard') discardChanges();
      await loaded(before);
    });

    expect(useStore.getState().file?.name).toBe('messy.xlsx');
    expect(all((el) => el.getAttribute('role') === 'row').length).toBeGreaterThan(20); // file B's rows are on screen
    expect(all(hasClass('cell-active')).map(rowOf)).toEqual([]);
    expect(all((el) => el.hasAttribute('aria-activedescendant')).length).toBe(0);
    expect([pane('pane-grid').scrollTop, pane('pane-gantt').scrollTop]).toEqual([0, 0]);

    await act(async () => root.unmount());
  });
});
