import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModeSwitch } from '../../src/ui/header/Header';

const render = (mode: 'Plan' | 'Track') => renderToStaticMarkup(createElement(ModeSwitch, { mode }));

describe('header mode switch — SPEC §7.1, §7.4', () => {
  it('each option names its purpose in a tooltip and keeps its plain text (the icon is aria-hidden)', () => {
    const html = render('Track');
    expect(html).toContain('title="Plan mode: build and adjust the baseline (dates, durations, links)" role="radio" aria-checked="false"');
    expect(html).toContain('title="Track mode: update progress against the baseline" role="radio" aria-checked="true"');
    // QA reads the lit option's textContent: an svg (no text) and the label
    expect(html).toMatch(/aria-checked="true" tabindex="0"><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>Track<\/button>/);
  });

  it('Track: neutral switch and a "Baseline locked" caption the group points at', () => {
    const html = render('Track');
    expect(html).toContain('<div class="mode-switch mode-switch-track">');
    expect(html).toContain('<div class="segmented segmented-mode" role="radiogroup" aria-label="Mode" aria-describedby="mode-caption">');
    expect(html).toMatch(/<span id="mode-caption" class="mode-caption"><svg[^>]*>.*?<\/svg>Baseline locked<\/span>/);
  });

  it('Plan: the violet switch and an "Editing the baseline" pill', () => {
    const html = render('Plan');
    expect(html).toContain('<div class="mode-switch mode-switch-plan">');
    expect(html).toMatch(/aria-checked="true" tabindex="0"><svg[^>]*>.*?<\/svg>Plan<\/button>/);
    expect(html).toMatch(/<span id="mode-caption" class="mode-caption mode-caption-plan"><svg[^>]*>.*?<\/svg>Editing the baseline<\/span>/);
  });
});
