// Pure parts of the assignee chips (SPEC §7.7): avatar initials and how many whole chips fit in the cell.

/** Thai leading vowels เ แ โ ใ ไ: written before the consonant they follow, so never an initial. */
const LEADING_VOWEL = /[เ-ไ]/;
const THAI = /[฀-๿]/;

/** First letter of a word, skipping a Thai leading vowel. */
const firstLetter = (word: string) => [...word].find((c) => !LEADING_VOWEL.test(c)) ?? '';

/** Avatar initials: first letters of the first two words, else the first two characters (a Thai word: its first consonant). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const [a, b] = words;
  if (a === undefined) return '';
  if (b !== undefined) return (firstLetter(a) + firstLetter(b)).toUpperCase();
  return THAI.test(a) ? firstLetter(a) : a.slice(0, 2).toUpperCase();
}

/**
 * How many chips to show (up to `max`, at least one when there are any): only chips that fit whole, plus the
 * "+N" when some are left out. Only a lone first chip may be cut with an ellipsis.
 */
export function fitChipCount(widths: readonly number[], budget: number, { gap = 4, more = 16, max = 2 }: { gap?: number; more?: number; max?: number } = {}): number {
  for (let k = Math.min(max, widths.length); k >= 2; k--) {
    const used = widths.slice(0, k).reduce((sum, w) => sum + w, 0) + gap * (k - 1) + (k < widths.length ? gap + more : 0);
    if (used <= budget) return k;
  }
  return Math.min(1, widths.length);
}
