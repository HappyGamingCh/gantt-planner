import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Plan } from '../../src/engine/types';
import { CalendarTab } from '../../src/ui/settings/CalendarTab';
import { ResourcesTab } from '../../src/ui/settings/ResourcesTab';
import { SettingsDialog } from '../../src/ui/settings/SettingsDialog';
import { resourceDrafts } from '../../src/store/settings';
import { makeProject, makeTask } from '../engine/helpers';

const noop = () => {};
const count = (html: string, part: string) => html.split(part).length - 1;

const plan: Plan = {
  project: makeProject({ mode: 'Track', workingDays: [1, 2, 3, 4, 5, 6] }),
  tasks: [makeTask(1, { assigned: ['ACME'] }), makeTask(2, { assigned: ['acme', 'NewCo'] })],
  resources: [{ name: 'ACME', type: 'Contractor', color: '#0D9488' }, { name: 'Spare' }],
  holidays: [
    { date: '2026-12-31', description: 'New Year’s Eve' },
    { date: '2026-12-06', description: '' },
  ],
};

/** Markup of the dialog; React warns that its layout effects (showModal, focus) do nothing on the server. */
function dialogMarkup(tab: 'general' | 'calendar' | 'resources') {
  const quiet = vi.spyOn(console, 'error').mockImplementation(noop);
  try {
    return renderToStaticMarkup(createElement(SettingsDialog, { plan, tab }));
  } finally {
    quiet.mockRestore();
  }
}

describe('Settings dialog — SPEC §7.14', () => {
  it('three tabs; the one it was opened on is selected and its panel shown', () => {
    const html = dialogMarkup('calendar');
    expect(html).toContain('<h2');
    expect(html).toContain('>Settings</h2>');
    expect(html).toMatch(/role="tablist" aria-label="Settings"/);
    expect(count(html, 'role="tab"')).toBe(3);
    expect(html).toMatch(/role="tab" class="settings-tab" aria-selected="true"[^>]*>Calendar<\/button>/);
    expect(html).toMatch(/role="tab" class="settings-tab" aria-selected="false"[^>]*tabindex="-1"[^>]*>General<\/button>/);
    expect(html).toContain('>Working days</legend>');
    expect(html).not.toContain('Project name');
    expect(dialogMarkup('general')).toContain('Project name');
  });

  it('Calendar: the days Monday first, ticked as the project works; the last ticked day can’t be unticked', () => {
    const html = renderToStaticMarkup(
      createElement(CalendarTab, { project: plan.project, workingDays: [1, 2, 3, 4, 5, 6], onWorkingDays: noop, holidays: plan.holidays, onHolidays: noop, holidaysLocked: false }),
    );
    const boxes = [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map(([tag]) => [/aria-label="(\w+)"/.exec(tag)![1], tag.includes('checked=""')]);
    expect(boxes).toEqual([
      ['Monday', true],
      ['Tuesday', true],
      ['Wednesday', true],
      ['Thursday', true],
      ['Friday', true],
      ['Saturday', true],
      ['Sunday', false],
    ]);
    expect(html).toContain('6 working days a week.');
    expect(html).toContain('>Holidays (2)</legend>');
    expect(html).toContain('>Sun 6 Dec 2026</span>'); // listed as given: the dialog sorts its draft
    expect(html).toContain('not a working day anyway');
    expect(html).toContain('aria-label="Remove holiday 31 Dec 2026"');
    expect(html).toContain('The baseline stays as it is'); // Track mode
    const one = renderToStaticMarkup(createElement(CalendarTab, { project: plan.project, workingDays: [3], onWorkingDays: noop, holidays: [], onHolidays: noop, holidaysLocked: false }));
    expect(one).toContain('<input type="checkbox" disabled="" aria-label="Wednesday" checked=""/>');
    expect(one).toContain('1 working day a week.');
  });

  it('Calendar: a Holidays sheet the app can’t write is read-only; unreadable Working Days are named', () => {
    const html = renderToStaticMarkup(
      createElement(CalendarTab, { project: plan.project, workingDays: [1, 2, 3, 4, 5], onWorkingDays: noop, holidays: [], onHolidays: noop, holidaysLocked: true, unreadDays: 'weekdays' }),
    );
    expect(html).toContain('no Date header in row 1');
    expect(html).not.toContain('>Add</button>');
    expect(html).toContain('Working Days (“weekdays”) couldn’t be read');
  });

  it('Resources: each with its color, type and tasks; a name in use can’t be removed', () => {
    const drafts = resourceDrafts(plan);
    const html = renderToStaticMarkup(createElement(ResourcesTab, { drafts, onDrafts: noop, tasks: plan.tasks, locked: false, showProblems: false, focus: null }));
    expect(html).toContain('>Resources (3)</legend>');
    expect(html).toContain('aria-label="Color of ACME: #0D9488"');
    expect(html).toContain('>2 tasks</span>'); // ACME, any case
    expect(html).toContain('>Unused</span>');
    expect(html).toMatch(/aria-label="Remove ACME" title="Used by 2 tasks: remove it from them first" aria-disabled="true"/);
    expect(html).toMatch(/aria-label="Remove Spare" title="Remove" aria-disabled="false"/);
    const bad = renderToStaticMarkup(createElement(ResourcesTab, { drafts: [...drafts, { id: 9, name: 'acme' }], onDrafts: noop, tasks: plan.tasks, locked: false, showProblems: true, focus: null }));
    expect(bad).toContain('aria-invalid="true"');
    expect(bad).toContain('Another resource has this name');
    expect(renderToStaticMarkup(createElement(ResourcesTab, { drafts, onDrafts: noop, tasks: plan.tasks, locked: true, showProblems: false, focus: null }))).toContain('no Name header in row 1');
  });
});
