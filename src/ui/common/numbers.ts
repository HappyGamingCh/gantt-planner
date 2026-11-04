// Typed numbers, checked before they are saved (SPEC §7.7, §7.9): the grid's Duration and Progress editors and the
// drawer's Duration field read them the same way. No DOM, so they are unit-tested.
import { MAX_DAYS } from '../../config';
import { DURATION_MESSAGE } from '../../store/rules';

/** A typed number: blank = no change; `error` keeps the editor open; `note` explains a rounding. */
export interface NumberInput {
  value?: number;
  error?: string;
  note?: string;
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  return NUMBER_RE.test(t) ? Number(t) : null;
}

/** Planned Duration (§4.3): whole working days 0–MAX_DAYS; a decimal is rounded, as when it is read from Excel (§4.7). */
export function parseDuration(text: string): NumberInput {
  if (text.trim() === '') return {};
  const n = parseNumber(text);
  if (n === null) return { error: 'Enter whole working days, e.g. 5' };
  if (n < 0) return { error: "Duration can't be negative" };
  const days = Math.round(n);
  if (days > MAX_DAYS) return { error: DURATION_MESSAGE }; // the store refuses it too: same words
  return { value: days, note: days !== n ? `Rounded to ${days} day${days === 1 ? '' : 's'} — whole working days only` : undefined };
}

/** Progress (§4.3): a whole percent 0–100; a decimal is rounded. */
export function parseProgress(text: string): NumberInput {
  if (text.trim() === '') return {};
  const n = parseNumber(text);
  if (n === null || n < 0 || n > 100) return { error: 'Enter a percent from 0 to 100' };
  return { value: Math.round(n) };
}
