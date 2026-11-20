// Project › Working Days (SPEC §4.2, §4.7, §4.8): the weekdays a project works, as text in the Project sheet.
// Weekdays are numbered as Date.getUTCDay() does: 0 = Sunday … 6 = Saturday.

/** Short English names by weekday number. */
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Weekdays in the order the app lists them: the week starts on Monday (§7.2). */
export const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

/** Accepted names (lower case, without dots or a leading วัน) by weekday number. */
const NAMES: readonly (readonly string[])[] = [
  ['sun', 'sunday', 'su', 'อา', 'อาทิตย์'],
  ['mon', 'monday', 'mo', 'จ', 'จันทร์'],
  ['tue', 'tues', 'tuesday', 'tu', 'อ', 'อังคาร'],
  ['wed', 'weds', 'wednesday', 'we', 'พ', 'พุธ'],
  ['thu', 'thur', 'thurs', 'thursday', 'th', 'พฤ', 'พฤหัส', 'พฤหัสบดี'],
  ['fri', 'friday', 'fr', 'ศ', 'ศุกร์'],
  ['sat', 'saturday', 'sa', 'ส', 'เสาร์'],
];
const WEEKDAY_OF = new Map(NAMES.flatMap((names, day) => names.map((name) => [name, day] as const)));
const ALL = /^(all|all days|every ?day|everyday|ทุกวัน)$/;

const weekday = (word: string): number | undefined => WEEKDAY_OF.get(word.replace(/^วัน/, ''));

/**
 * The weekdays a non-blank Working Days text names, ascending, or null when it isn't a list of days (§4.7): names
 * in English or Thai, separated by `,` `;` `/` or spaces, ranges with `-` or `–` (`Sat-Tue` wraps past Sunday).
 */
export function parseWorkingDays(text: string): number[] | null {
  const s = text
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\./g, ' ') // "จ." / "Mon." — a dot ends an abbreviation, or separates "จ.อ.พ."
    .trim()
    .replace(/\s+/g, ' ');
  if (ALL.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  const tokens = s.replace(/\s*-\s*/g, '-').split(/[\s,;/]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const days = new Set<number>();
  for (const token of tokens) {
    const ends = token.split('-');
    if (ends.length > 2) return null;
    const first = weekday(ends[0]!);
    const last = weekday(ends.at(-1)!);
    if (first === undefined || last === undefined) return null;
    for (let d = first; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === last) break;
    }
  }
  return [...days].sort((a, b) => a - b);
}

/** The text Save writes for working days set in the app (§4.8): every day when undefined, Monday first. */
export function formatWorkingDays(days: readonly number[] | undefined): string {
  return WEEK_ORDER.filter((d) => days === undefined || days.includes(d))
    .map((d) => WEEKDAY_NAMES[d])
    .join(', ');
}
