import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computePlan } from '../../src/engine/compute';
import { sampleData } from '../../src/sample/sampleData';
import { rowsOf, type AssigneeInfo } from '../../src/store/selectors';
import { AssigneeChips } from '../../src/ui/grid/cells';
import { OPTIONAL, visibleColumns } from '../../src/ui/grid/columns';

// Grid cell markup (SPEC §7.7). On the server the chip widths fall back to an estimate of 7 px per character.
const rows = rowsOf(sampleData, computePlan(sampleData));
const info = new Map<string, AssigneeInfo>([
  ['acme', { type: 'Contractor', color: '#2563EB' }],
  ['somchai', { type: 'Person', color: '#FFFF00' }],
  ['sunisa r.', { type: 'Person', color: '#2563EB' }],
]);
const chips = (names: string[], budget?: number) => renderToStaticMarkup(createElement(AssigneeChips, { names, info, budget }));

describe('grid cells — SPEC §7.7', () => {
  it('the New tag sits beside the name, outside its ellipsis, and the late dot before it', () => {
    const task = rows[0]!;
    const row = { task: { ...task.task, name: 'Replace gasket of upper manhole and torque bolts', isNewThisSession: true }, r: { ...task.r, status: 'Late' as const } };
    const html = renderToStaticMarkup(createElement('div', null, visibleColumns([])[1]!.render(row, info)));
    // The outline slot comes first; Grid.css shows it only while the plan has major tasks (§7.7).
    expect(html).toMatch(/^<div><span class="outline-slot" style="margin-left:0"><\/span><span class="late-dot" aria-label="Late"><\/span><span class="task-name" title="Replace gasket[^"]*">Replace gasket[^<]*<\/span><span class="new-tag" title="[^"]+">New<\/span><\/div>$/);
  });

  it('a major task: indented by its Level, a chevron, the name in semibold and its task count (§7.7)', () => {
    const task = rows[0]!;
    const row = { task: { ...task.task, name: 'Arch Panel' }, r: { ...task.r, level: 2, summary: { tasks: 5 } } };
    const html = renderToStaticMarkup(createElement('div', null, visibleColumns([])[1]!.render(row, info)));
    expect(html).toContain('<span class="outline-slot" style="margin-left:16px"><button type="button" class="outline-toggle"');
    expect(html).toContain('aria-expanded="true" aria-label="Collapse Arch Panel"');
    expect(html).toContain('<span class="task-name task-summary" title="Arch Panel">Arch Panel</span><span class="task-count" title="5 tasks">5</span>');
  });

  it('a linked Start leaves its tooltip to the cell (the reason depends on the mode)', () => {
    const linked = rows.find((row) => row.r.links.length > 0)!;
    const html = renderToStaticMarkup(createElement('div', null, OPTIONAL.find((c) => c.key === 'start')!.render(linked, info)));
    expect(html).toContain('class="linked"');
    expect(html).not.toContain('title=');
  });

  it('assignee chips: neutral tags with a colour swatch; only those that fit whole, then +N; every name in the tooltip', () => {
    // Estimates (text + 23 px of border, padding, swatch and gap): ACME 51 px, NDT 44 px, Refracto 79 px; the Assigned
    // cell has 104 px inside, so ACME + NDT (99 px with the 4 px gap) fit.
    expect(chips(['ACME', 'NDT'], 104)).toBe('<span class="chips" title="ACME, NDT"><span class="tag"><span class="tag-swatch" style="background:#2563EB" aria-hidden="true"></span><span class="tag-name">ACME</span></span><span class="tag"><span class="tag-swatch" style="background:var(--idle)" aria-hidden="true"></span><span class="tag-name">NDT</span></span></span>');
    expect(chips(['ACME', 'NDT'], 98)).toContain('<span class="tag-name">ACME</span></span><span class="chip-more">+1</span>');
    const two = chips(['ACME', 'Refracto'], 104);
    expect(two).toContain('>ACME</span></span><span class="chip-more">+1</span>');
    expect(two).not.toContain('>Refracto<');
    expect(chips(['ACME', 'Refracto', 'NDT'])).toContain('<span class="chip-more">+1</span>'); // no budget: 2, then +N
  });

  it('avatars: readable initials on a light resource colour', () => {
    const html = chips(['Somchai', 'Sunisa R.']);
    expect(html).toMatch(/<span class="avatar avatar-light"[^>]*style="background:#FFFF00">SO<\/span>/);
    expect(html).toMatch(/<span class="avatar"[^>]*style="background:color-mix\(in srgb, #2563EB 80%, black\)">SR<\/span>/);
  });
});
