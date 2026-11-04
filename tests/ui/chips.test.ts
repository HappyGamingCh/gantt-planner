import { describe, expect, it } from 'vitest';
import { RESOURCE_PALETTE } from '../../src/config';
import { avatarTone, luminance } from '../../src/ui/common/contrast';
import { fitChipCount, initials } from '../../src/ui/grid/chips';

describe('avatar initials — SPEC §7.7', () => {
  it('first letters of the first two words, else the first two characters', () => {
    expect(initials('Sunisa R.')).toBe('SR');
    expect(initials('Somchai')).toBe('SO');
    expect(initials('  ')).toBe('');
  });

  it('Thai: skips the leading vowels เ แ โ ใ ไ, so the initial is a consonant', () => {
    expect(initials('สมชาย ใจดี')).toBe('สจ');
    expect(initials('ไพโรจน์ แสงทอง')).toBe('พส');
    expect(initials('เกียรติ')).toBe('ก');
  });
});

describe('chips that fit — SPEC §7.7 "Show 2, then +N"', () => {
  // Measured tag widths at 12 px IBM Plex: ACME 41.7, Refracto 55.7, VesselCo 59.2, ValveCo 53.1, NDT 33.1, Inst 31.6,
  // ทีมเครื่องกล 63.4; "+1" 14.4. The Assigned cell has 100 px inside.
  it('shows two whole chips when both fit', () => {
    expect(fitChipCount([41.7, 33.1], 100)).toBe(2); // ACME, NDT
    expect(fitChipCount([31.6, 63.4], 100)).toBe(2); // Inst, ทีมเครื่องกล
    expect(fitChipCount([41.7, 55.7], 112)).toBe(2);
  });

  it('otherwise one chip and +N, instead of cutting every chip to one letter', () => {
    expect(fitChipCount([41.7, 55.7], 100)).toBe(1); // ACME +1
    expect(fitChipCount([59.2, 53.1], 112, { more: 14.4 })).toBe(1);
    expect(fitChipCount([55.7, 59.2, 53.1], 112, { more: 14.4 })).toBe(1); // Refracto +2
    expect(fitChipCount([22, 22, 22], 100, { more: 14.4 })).toBe(2); // avatars: 2, then +1
  });

  it('always shows the first chip, and nothing for no names', () => {
    expect(fitChipCount([150], 100)).toBe(1);
    expect(fitChipCount([], 100)).toBe(0);
  });
});

describe('avatar contrast — SPEC §10', () => {
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  it('the built-in palette keeps white initials on the darkened colour', () => {
    for (const color of RESOURCE_PALETTE) {
      expect(avatarTone(color)).toBe('dark-bg');
      expect(contrast(1, luminance(color, 0.8))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('light Excel colours switch to dark initials on the plain colour, at least 4.5:1', () => {
    const text = luminance('#0F172A'); // --text
    for (const color of ['#FFFF00', '#FFC000', '#92D050', '#00B0F0', '#00B050', '#A6A6A6', '#F4B084']) {
      expect(avatarTone(color)).toBe('light-bg');
      expect(contrast(luminance(color), text)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('a colour that is not #RRGGBB keeps the default', () => {
    expect(avatarTone('var(--idle)')).toBe('dark-bg');
  });
});
