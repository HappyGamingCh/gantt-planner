import { describe, expect, it } from 'vitest';
import type { Dialog } from '../../src/store/store';
import { closeDrawer, drawerFocused, openDrawer, useStore } from '../../src/store/store';
import { fileShortcutsAllowed, shortcutKey, type ShortcutKey } from '../../src/ui/common/windowEvents';
import { flushPendingEdit, setPendingEdit } from '../../src/ui/grid/pendingEdit';

const ev = (key: string, code: string, mods: Partial<ShortcutKey> = {}): ShortcutKey => ({ key, code, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('shortcut keys on any keyboard layout — SPEC §7.12', () => {
  it('Latin layouts match the character typed', () => {
    expect(shortcutKey(ev('s', 'KeyS', { ctrlKey: true }))).toBe('s');
    expect(shortcutKey(ev('Z', 'KeyZ', { ctrlKey: true }))).toBe('z'); // Ctrl+Shift+Z
    expect(shortcutKey(ev('o', 'KeyS', { ctrlKey: true }))).toBe('o'); // Dvorak: the O character sits on the S key
    expect(shortcutKey(ev('Enter', 'Enter', { ctrlKey: true }))).toBe('enter');
    expect(shortcutKey(ev('Delete', 'Delete', { ctrlKey: true }))).toBe('delete');
  });

  it('the Thai layout: Ctrl+letter matches the physical key', () => {
    expect(shortcutKey(ev('ห', 'KeyS', { ctrlKey: true }))).toBe('s'); // Ctrl+S
    expect(shortcutKey(ev('ฆ', 'KeyS', { ctrlKey: true }))).toBe('s'); // Ctrl+Shift+S
    expect(shortcutKey(ev('น', 'KeyO', { ctrlKey: true }))).toBe('o');
    expect(shortcutKey(ev('ผ', 'KeyZ', { ctrlKey: true }))).toBe('z');
    expect(shortcutKey(ev('(', 'KeyZ', { ctrlKey: true }))).toBe('z'); // Ctrl+Shift+Z: Shift+Z types '('
    expect(shortcutKey(ev('ั', 'KeyY', { ctrlKey: true }))).toBe('y');
    expect(shortcutKey(ev('ส', 'KeyL', { ctrlKey: true }))).toBe('l');
  });

  it('without Ctrl, or with AltGr, the character typed counts: Thai ฝ is a letter, not /', () => {
    expect(shortcutKey(ev('ฝ', 'Slash'))).toBe('ฝ');
    expect(shortcutKey(ev('/', 'Digit2'))).toBe('/'); // Thai '/' sits on the 2 key
    expect(shortcutKey(ev('?', 'Slash'))).toBe('?');
    expect(shortcutKey(ev('ż', 'KeyZ', { ctrlKey: true, altKey: true }))).toBe('ż'); // Polish AltGr+Z is not undo
  });
});

describe('Ctrl+S / Ctrl+O over a dialog — SPEC §7.12', () => {
  it('do nothing over a form or a confirmation, so what it holds is not lost', () => {
    const blocked: Dialog[] = [
      { kind: 'projectSettings' },
      { kind: 'newPlan' },
      { kind: 'discard', then: () => {} },
      { kind: 'planMode' },
      { kind: 'delete', ids: [1], dependents: 1 },
      { kind: 'renumber' },
    ];
    expect(blocked.map(fileShortcutsAllowed)).toEqual(blocked.map(() => false));
  });

  it('act with no dialog, over the file dialogs (Save retries) and over help', () => {
    const allowed: (Dialog | null)[] = [
      null,
      { kind: 'conflict' },
      { kind: 'failed', detail: 'locked' },
      { kind: 'unreadable', detail: 'NotReadableError' },
      { kind: 'denied' },
      { kind: 'unsupported', parts: 'charts' },
      { kind: 'shortcuts' },
      { kind: 'about' },
      { kind: 'error', title: 'x', message: 'y' },
    ];
    expect(allowed.map(fileShortcutsAllowed)).toEqual(allowed.map(() => true));
  });
});

describe('finishing a popover editor before Save — §17 "Ctrl+S first finishes the edit in progress"', () => {
  it('runs the open editor’s finish once', () => {
    const done: string[] = [];
    setPendingEdit(() => done.push('assigned'));
    flushPendingEdit();
    flushPendingEdit();
    expect(done).toEqual(['assigned']);
  });

  it('an editor that closed takes its finish with it, and never removes a newer one', () => {
    const done: string[] = [];
    const first = setPendingEdit(() => done.push('first'));
    first();
    flushPendingEdit();
    expect(done).toEqual([]);
    const second = setPendingEdit(() => done.push('second'));
    first(); // an old cleanup running late
    flushPendingEdit();
    second();
    expect(done).toEqual(['second']);
  });
});

describe('task drawer focus — SPEC §7.9, §10', () => {
  const state = () => useStore.getState();

  it('takes the focus when opened from the keyboard only', () => {
    openDrawer(3);
    expect(state()).toMatchObject({ drawerId: 3, selection: [3], drawerFocus: false });
    openDrawer(4, { focus: true });
    expect(state()).toMatchObject({ drawerId: 4, drawerFocus: true });
    drawerFocused();
    expect(state().drawerFocus).toBe(false);
    openDrawer(4, { focus: true });
    closeDrawer();
    expect(state()).toMatchObject({ drawerId: null, drawerFocus: false });
  });
});
