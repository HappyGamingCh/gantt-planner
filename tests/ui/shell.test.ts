import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAN_DATE_MAX, PLAN_DATE_MIN } from '../../src/engine/dates';
import { Dialog, focusedAction, type DialogAction } from '../../src/ui/common/Dialog';
import { GRID_ID, moveIndex, popupTakesEscape, restoreFocus } from '../../src/ui/common/focus';
import { ShortcutsDialog } from '../../src/ui/common/HelpDialogs';
import { Menu, MenuEntries, type MenuEntry } from '../../src/ui/common/Menu';
import { Popover } from '../../src/ui/common/Popover';
import { Segmented } from '../../src/ui/common/Segmented';
import { ToastHost, toastHeld, ToastView } from '../../src/ui/common/Toast';
import { settleStatusDate } from '../../src/ui/header/Header';

const noop = () => {};
const count = (html: string, part: string) => html.split(part).length - 1;

/** Markup of a dialog; React warns that its layout effects (showModal, focus) do nothing on the server. */
function dialogMarkup(element: ReactElement): string {
  const quiet = vi.spyOn(console, 'error').mockImplementation(noop);
  try {
    return renderToStaticMarkup(element);
  } finally {
    quiet.mockRestore();
  }
}

describe('dialog focus — SPEC §7.11, §10', () => {
  const cancel = { label: 'Cancel', onClick: noop, primary: true };

  it('confirms focus the safe primary action, never the destructive one listed first', () => {
    const conflict: DialogAction[] = [{ label: 'Reload file', onClick: noop }, { label: 'Overwrite', onClick: noop }, cancel];
    const discard: DialogAction[] = [{ label: 'Discard changes', onClick: noop }, cancel];
    const planMode: DialogAction[] = [{ label: 'Switch to Plan', onClick: noop }, { label: 'Stay in Track', onClick: noop, primary: true }];
    expect([focusedAction(conflict), focusedAction(discard), focusedAction(planMode)]).toEqual([2, 1, 1]);
  });

  it('an action marked `focus` wins over the primary one; no primary and no mark: none', () => {
    expect(focusedAction([{ label: 'Save a copy…', onClick: noop, primary: true }, { label: 'Cancel', onClick: noop, focus: true }])).toBe(1);
    expect(focusedAction([{ label: 'Keep', onClick: noop }])).toBe(-1);
  });

  it('marks the focused action in the markup and leaves React autoFocus out (it fires while the dialog is closed)', () => {
    const html = dialogMarkup(
      createElement(Dialog, { title: 'Delete tasks?', onCancel: noop, actions: [{ label: 'Delete', onClick: noop }, cancel], children: 'Their links will be removed.' }),
    );
    expect(html).toContain('<button type="button" class="btn">Delete</button>');
    expect(html).toContain('<button type="button" class="btn btn-primary" data-autofocus="">Cancel</button>');
    expect(html).not.toMatch(/\sautofocus/i);
  });

  describe('focus after a dialog closes', () => {
    // Just enough of the DOM for restoreFocus: elements that take focus, <body>, the grid.
    class El {
      isConnected = true;
      focus() {
        page.activeElement = this;
      }
    }
    const body = new El();
    const grid = new El();
    const page = { body, activeElement: body, getElementById: (id: string) => (id === GRID_ID ? grid : null) };
    beforeEach(() => {
      page.activeElement = body;
      vi.stubGlobal('HTMLElement', El);
      vi.stubGlobal('document', page);
      vi.stubGlobal('requestAnimationFrame', (run: () => void) => run());
    });
    afterEach(() => vi.unstubAllGlobals());
    const restore = (opener: El | null) => restoreFocus(opener as unknown as Element | null);

    it('goes back to the control that opened it', () => {
      const button = new El();
      restore(button);
      expect(page.activeElement).toBe(button);
    });

    it('opened with focus on <body>, or its opener is gone: the grid, not <body>', () => {
      restore(body);
      expect(page.activeElement).toBe(grid);
      page.activeElement = body;
      const gone = new El();
      gone.isConnected = false;
      restore(gone);
      expect(page.activeElement).toBe(grid);
    });

    it('leaves focus alone when something took it on purpose', () => {
      const field = new El();
      page.activeElement = field;
      restore(new El());
      expect(page.activeElement).toBe(field);
    });
  });
});

describe('Esc with a menu or popover open — SPEC §7.11', () => {
  const popup = {} as Node;
  const esc = { key: 'Escape', defaultPrevented: false };
  const dialog = (holdsPopup: boolean) => ({ contains: () => holdsPopup }) as unknown as Node;

  it('closes the menu or popover', () => {
    expect(popupTakesEscape(esc, popup, null)).toBe(true);
    expect(popupTakesEscape(esc, popup, dialog(true))).toBe(true); // one inside the open dialog
  });

  it('is the dialog’s when one opened on top of it (a shortcut pressed while it was open), so the dialog closes', () => {
    expect(popupTakesEscape(esc, popup, dialog(false))).toBe(false);
  });

  it('other keys, or an Esc something nearer already took, leave it open', () => {
    expect(popupTakesEscape({ key: 'Enter', defaultPrevented: false }, popup, null)).toBe(false);
    expect(popupTakesEscape({ key: 'Escape', defaultPrevented: true }, popup, null)).toBe(false);
  });
});

describe('arrow-key focus in menus and segmented controls — SPEC §10', () => {
  it('↓/→ next and ↑/← previous, wrapping; Home and End; from nothing focused', () => {
    expect([moveIndex('ArrowDown', 0, 3), moveIndex('ArrowRight', 2, 3), moveIndex('ArrowUp', 0, 3), moveIndex('ArrowLeft', 1, 3)]).toEqual([1, 0, 2, 0]);
    expect([moveIndex('Home', 2, 3), moveIndex('End', 0, 3)]).toEqual([0, 2]);
    expect([moveIndex('ArrowDown', -1, 3), moveIndex('ArrowUp', -1, 3)]).toEqual([0, 2]);
  });

  it('other keys and empty lists do nothing', () => {
    expect([moveIndex('Enter', 0, 3), moveIndex('a', 0, 3), moveIndex('ArrowDown', 0, 0)]).toEqual([null, null, null]);
  });
});

describe('menus — SPEC §7.4, §7.6', () => {
  it('choices are menuitemradio with aria-checked and a check icon, not a "✓" in the text', () => {
    const html = renderToStaticMarkup(
      createElement(MenuEntries, {
        items: [
          { label: 'Color by status', checked: false, onSelect: noop },
          { label: 'Color by assignee', checked: true, onSelect: noop },
        ],
        onPick: noop,
      }),
    );
    expect(count(html, 'role="menuitemradio"')).toBe(2);
    expect(html).toContain('aria-checked="false"');
    expect(html).toMatch(/aria-checked="true"[^>]*><span class="menu-lead" aria-hidden="true"><svg/);
    expect(html).not.toContain('✓');
    expect(count(html, 'tabindex="-1"')).toBe(2); // arrow keys move focus, Tab leaves the menu
  });

  it('actions are menuitems with icons, shortcut hints and separators; no leading column without icons', () => {
    const items: MenuEntry[] = [
      { label: 'Save as…', icon: createElement('svg'), shortcut: 'Ctrl+Shift+S', onSelect: noop },
      'separator',
      { label: 'About', icon: createElement('svg'), onSelect: noop },
    ];
    const html = renderToStaticMarkup(createElement(MenuEntries, { items, onPick: noop }));
    expect(count(html, 'role="menuitem"')).toBe(2);
    expect(html).not.toContain('aria-checked');
    expect(html).toContain('<div role="separator" class="menu-sep"></div>');
    expect(html).toContain('<span class="menu-shortcut">Ctrl+Shift+S</span>');
    const plain = renderToStaticMarkup(createElement(MenuEntries, { items: [{ label: 'New plan', onSelect: noop }], onPick: noop }));
    expect(plain).not.toContain('menu-lead');
  });
});

describe('segmented control — SPEC §7.4, §7.6', () => {
  const options = [
    { value: 'Plan', label: 'Plan' },
    { value: 'Track', label: 'Track' },
  ] as const;

  it('is one Tab stop: only the option that is on', () => {
    const html = renderToStaticMarkup(createElement(Segmented<'Plan' | 'Track'>, { label: 'Mode', options, value: 'Track', onChange: noop }));
    expect(html).toContain('role="radiogroup" aria-label="Mode"');
    expect(html).toContain('aria-checked="false" tabindex="-1">Plan<');
    expect(html).toContain('aria-checked="true" tabindex="0">Track<');
  });

  it('with no option on, the first one is the Tab stop', () => {
    const html = renderToStaticMarkup(createElement(Segmented<string>, { label: 'Look-ahead window', options: [...options], value: 'x', onChange: noop }));
    expect(html).toContain('tabindex="0">Plan<');
  });

  it('options can carry a tooltip and an icon before the label; the group a class and a caption', () => {
    const withIcons = [
      { value: 'Plan', label: 'Plan', title: 'Plan mode', icon: createElement('svg', { 'aria-hidden': 'true' }) },
      { value: 'Track', label: 'Track' },
    ] as const;
    const html = renderToStaticMarkup(
      createElement(Segmented<'Plan' | 'Track'>, { label: 'Mode', options: withIcons, value: 'Plan', onChange: noop, className: 'segmented segmented-mode', describedBy: 'mode-caption' }),
    );
    expect(html).toContain('<div class="segmented segmented-mode" role="radiogroup" aria-label="Mode" aria-describedby="mode-caption">');
    expect(html).toContain('title="Plan mode" role="radio" aria-checked="true" tabindex="0"><svg aria-hidden="true"></svg>Plan<');
    expect(html).toContain('aria-checked="false" tabindex="-1">Track<'); // no title: the markup the QA scripts read is unchanged
  });
});

describe('popover — SPEC §7.6', () => {
  it('the button is named by what it shows, so the Filter count is read too; the label names the panel', () => {
    const html = renderToStaticMarkup(createElement(Popover, { label: 'Filter', button: 'Filter 2', children: 'panel' }));
    expect(html).toContain('<button type="button" class="btn" aria-haspopup="dialog" aria-expanded="false">Filter 2</button>');
    expect(html).not.toContain('aria-label');
  });

  it('quiet makes the trigger a ghost button (toolbar), as Menu does', () => {
    expect(renderToStaticMarkup(createElement(Popover, { label: 'Columns', button: 'Columns', children: 'panel', quiet: true }))).toContain('class="btn btn-quiet"');
    const menu = (props: { active?: boolean; quiet?: boolean }) => renderToStaticMarkup(createElement(Menu, { label: 'More', icon: null, items: [], ...props }));
    expect(menu({})).toContain('class="btn btn-icon"');
    expect(menu({ quiet: true })).toContain('class="btn btn-icon btn-quiet"');
    expect(menu({ quiet: true, active: true })).toContain('class="btn btn-icon btn-active"');
  });
});

describe('toasts — SPEC §7.11', () => {
  it('the polite live region is on the page before any toast, so the first message is announced', () => {
    expect(renderToStaticMarkup(createElement(ToastHost))).toBe('<div class="toast-region" role="status" aria-live="polite" aria-atomic="true"></div>');
  });

  it('a toast shows its message and action', () => {
    const html = renderToStaticMarkup(createElement(ToastView, { toast: { id: 1, message: 'Task deleted', action: { label: 'Undo', run: noop } }, onHold: noop }));
    expect(html).toContain('<span>Task deleted</span>');
    expect(html).toContain('>Undo</button>');
  });

  it('pointer and focus hold it each on their own: the pointer passing off it doesn’t let go of a focused Undo', () => {
    expect(toastHeld({ hover: null, focus: 7 }, 7)).toBe(true);
    expect(toastHeld({ hover: 7, focus: null }, 7)).toBe(true);
    expect(toastHeld({ hover: null, focus: null }, 7)).toBe(false);
    expect(toastHeld({ hover: 6, focus: 6 }, 7)).toBe(false); // held for the toast before: the new one still goes
  });
});

describe('status date in the header — SPEC §4.7, §7.4', () => {
  it('the half-typed years a date input reports on each key are never set, and say why', () => {
    for (const partial of ['0002-09-30', '0020-09-30', '0202-09-30']) expect(settleStatusDate(partial, '2026-09-30')).toEqual({ value: null, refused: true });
  });

  it('a whole date in 1950–2199 is set; outside it is refused', () => {
    expect(settleStatusDate('2027-09-30', '2026-09-30')).toEqual({ value: '2027-09-30', refused: false });
    expect(settleStatusDate(PLAN_DATE_MIN, '2026-09-30')).toEqual({ value: PLAN_DATE_MIN, refused: false });
    expect(settleStatusDate(PLAN_DATE_MAX, '2026-09-30')).toEqual({ value: PLAN_DATE_MAX, refused: false });
    expect(settleStatusDate('1949-12-31', '2026-09-30')).toEqual({ value: null, refused: true });
    expect(settleStatusDate('2569-09-30', '2026-09-30')).toEqual({ value: null, refused: true }); // Buddhist-era year
  });

  it('an unchanged or cleared field goes back quietly', () => {
    expect(settleStatusDate('2026-09-30', '2026-09-30')).toEqual({ value: null, refused: false });
    expect(settleStatusDate('', '2026-09-30')).toEqual({ value: null, refused: false });
  });
});

describe('keyboard shortcuts overlay — SPEC §7.12', () => {
  it('flows the keys, then Mouse, into the two balanced columns of a dialog whose body scrolls on a short screen', () => {
    const html = dialogMarkup(createElement(ShortcutsDialog));
    expect(html).toContain('class="dialog dialog-wide dialog-help"');
    const columns = html.slice(html.indexOf('shortcuts-cols'), html.indexOf('dialog-actions'));
    const [keys, mouse] = columns.split('<h3 class="shortcuts-head">Mouse</h3>');
    expect(count(keys ?? '', '<table class="shortcuts">')).toBe(1); // one table: the columns split it between rows
    expect(keys).toContain('<kbd>Ctrl+S</kbd>');
    expect(keys).toContain('<kbd>?</kbd>');
    expect(mouse).toMatch(/^<table class="shortcuts shortcuts-mouse"><tbody><tr><td>Ctrl\+click, Shift\+click<\/td>/);
    expect(mouse).toMatch(/<\/table><\/div><\/div><div class="$/); // Mouse inside the columns, not a full-width block below them
  });
});
