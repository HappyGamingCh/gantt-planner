import { describe, expect, it, vi } from 'vitest';
import { swallowKey } from '../../src/ui/common/BusyOverlay';

// The "Opening <file>…" scrim over an open plan (SPEC §7.11): it takes no keys.
const key = (k: string, mods: { ctrlKey?: boolean; metaKey?: boolean } = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrlKey,
  metaKey: !!mods.metaKey,
  stopPropagation: vi.fn(),
  preventDefault: vi.fn(),
});

describe('keys under the opening scrim — SPEC §7.11', () => {
  it('no key reaches the grid or the shortcuts', () => {
    for (const e of [key('a'), key('Delete'), key('s', { ctrlKey: true })]) {
      swallowKey(e);
      expect(e.stopPropagation).toHaveBeenCalled();
    }
  });

  it('the browser’s own Ctrl/⌘ shortcuts (Save page as, Open file, Print) don’t run either; Tab stays put', () => {
    for (const e of [key('s', { ctrlKey: true }), key('o', { ctrlKey: true }), key('p', { metaKey: true }), key('Tab')]) {
      swallowKey(e);
      expect(e.preventDefault).toHaveBeenCalled();
    }
  });

  it('plain keys keep the browser’s default (F5 still reloads)', () => {
    const e = key('F5');
    swallowKey(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
