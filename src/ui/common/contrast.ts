// Readable avatar initials on any resource colour (SPEC §4.4 Color, §10 contrast). Pure: no DOM.

/** WCAG relative luminance of `#RRGGBB`, with each channel scaled by `scale`. */
export function luminance(hex: string, scale = 1): number {
  const channel = (i: number) => {
    const c = (parseInt(hex.slice(i, i + 2), 16) / 255) * scale;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * Avatars draw white initials on the colour darkened 20 % (`dark-bg`). When that is under 4.5:1 (light colours
 * such as Excel's yellow or light green), they use the plain colour with dark text instead (`light-bg`).
 * Anything that isn't `#RRGGBB` (a palette token) keeps the default.
 */
export function avatarTone(hex: string): 'dark-bg' | 'light-bg' {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 'dark-bg';
  return 1.05 / (luminance(hex, 0.8) + 0.05) >= 4.5 ? 'dark-bg' : 'light-bg';
}
